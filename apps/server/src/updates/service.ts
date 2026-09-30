/**
 * Updates for Conch and the programs it uses (ADR 0019).
 *
 * Quiet by design. Conch looks once a day in the background (never while
 * it's starting up), remembers what it found in `~/.conch/updates.json`, and
 * says so in a few plain words; nothing waits on a look. Updating is one
 * press: programs one at a time through `Setup.update`, Conch itself through
 * its checkout, then a restart. With automatic updates on, programs update
 * overnight while nothing is running — Conch itself always asks, since it
 * restarts.
 */
import { join } from 'node:path';

import {
  ConchUpdate,
  type ProgramUpdate,
  type UpdateProgress,
  type UpdatesStatus,
} from '@conch/protocol';
import { z } from 'zod';

import { writeJson } from '../lib/fs';
import { readStore } from '../lib/recover';
import type { LatestLookup, NeedSpec, Setup } from '../setup/needs';
import type { ConchCheckout, ConchResult, UpdateProgressReport } from './conch';
import { DAY, MINUTE, firstLook, lookDue, nextLook, overnight } from './schedule';
import { compareVersions, isNewer } from './version';

const Program = z.object({
  installed: z.string(),
  latest: z.string().optional(),
  canUpdate: z.boolean().default(false),
  checkedAt: z.number(),
  updated: z.object({ at: z.number(), from: z.string() }).optional(),
  /** The version an automatic update last tried: a failing one isn't retried every night. */
  autoTried: z.string().optional(),
});
type Program = z.infer<typeof Program>;

const ConchCache = z.object({
  head: z.string().optional(),
  branch: z.string().optional(),
  behind: z.number().int().min(0).default(0),
  improvements: z.number().int().min(0).default(0),
  whatsNew: z.array(z.string()).default([]),
  checkedAt: z.number().optional(),
  problem: z.string().optional(),
  blocked: z.object({ reason: z.string(), command: z.string().optional() }).optional(),
});

const Cache = z.object({
  /** Program updates install by themselves overnight. */
  auto: z.boolean().default(false),
  checkedAt: z.number().optional(),
  nextCheckAt: z.number().optional(),
  conch: ConchCache.prefault({}),
  programs: z.record(z.string(), Program).default({}),
  outcome: ConchUpdate.shape.outcome,
});
type Cache = z.infer<typeof Cache>;

/** How long an outcome stays in view ("Updated yesterday", "went back to the version you had"). */
const OUTCOME_FOR_MS = 3 * DAY;
/** How often the clock looks at what's due. */
const TICK_MS = 5 * MINUTE;

export class UpdatesError extends Error {
  constructor(
    readonly code: 'not-found' | 'busy' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

export interface UpdatesDeps {
  home: string;
  /** Finds, versions and updates the programs (`KNOWN_NEEDS`). */
  setup: Setup;
  specs: ReadonlyMap<string, NeedSpec>;
  lookup: LatestLookup;
  /** Conch's own checkout, when it runs from one it can update. */
  conch?: ConchCheckout;
  /** `SERVER_VERSION`. */
  version: string;
  bootId: string;
  emit: (status: UpdatesStatus) => void;
  /** A "fixed on its own"-style note, for an automatic update. */
  heal: (message: string) => void;
  /** A chat or routine is working: automatic updates and Conch's own wait. */
  busy: () => boolean;
  /** A program was updated: whatever uses it looks again (a provider, integrations). */
  landed: (id: string) => Promise<void>;
  restartable: () => boolean;
  restart: () => boolean;
  /** Look by itself once a day (off for tests and the mock engine). */
  schedule?: boolean;
  now?: () => number;
  random?: () => number;
  /** Time for the page to show "Updating Conch…" before the gateway goes. */
  restartDelayMs?: number;
}

interface Job {
  state: 'queued' | 'updating';
  progress?: UpdateProgress;
}

export class UpdatesService {
  #cache: Cache = Cache.parse({});
  #loaded?: Promise<void>;
  #saving: Promise<void> = Promise.resolve();
  #checking?: Promise<void>;
  #conchJob?: UpdateProgressReport;
  /** The commit Conch started from: another one in its folder means a restart finishes an update. */
  #bootHead?: string;
  #jobs = new Map<string, Job>();
  #problems = new Map<string, string>();
  #queue: Promise<void> = Promise.resolve();
  #earliest = Number.POSITIVE_INFINITY;
  #timer?: NodeJS.Timeout;
  #stopped = false;

  constructor(private readonly deps: UpdatesDeps) {}

  #now(): number {
    return (this.deps.now ?? Date.now)();
  }

  #path(): string {
    return join(this.deps.home, 'updates.json');
  }

  #load(): Promise<void> {
    this.#loaded ??= readStore(this.#path(), Cache, {
      onRepair: () =>
        this.deps.heal('The list of updates couldn’t be read, so Conch started it again.'),
    })
      .then(({ value }) => void (this.#cache = value))
      .catch(() => undefined);
    return this.#loaded;
  }

  #save(): Promise<void> {
    this.#saving = this.#saving
      .then(() => writeJson(this.#path(), this.#cache))
      .catch(() => undefined);
    return this.#saving;
  }

  /** Tell the page where things stand, as they are this moment. */
  #emit(): void {
    try {
      this.deps.emit(this.#snapshot());
    } catch {
      // Telling the page is best effort.
    }
  }

  // ── What's waiting ──────────────────────────────────────────────────────

  async status(): Promise<UpdatesStatus> {
    await this.#load();
    return this.#snapshot();
  }

  #snapshot(): UpdatesStatus {
    const programs = [...this.deps.specs.values()].flatMap((spec): ProgramUpdate[] => {
      const known = this.#cache.programs[spec.id];
      // A program that can't say its version, or whose newest one Conch never learnt, isn't listed.
      if (!known?.latest || !spec.version) return [];
      const job = this.#jobs.get(spec.id);
      const problem = this.#problems.get(spec.id);
      return [
        {
          id: spec.id,
          name: spec.short,
          installed: known.installed,
          latest: known.latest,
          available: isNewer(known.latest, known.installed),
          canUpdate: known.canUpdate,
          download: spec.download?.[this.deps.setup.platform],
          state: job?.state ?? 'idle',
          ...(job?.progress && { progress: job.progress }),
          ...(problem && { problem }),
          ...(known.updated && { updated: known.updated }),
        },
      ];
    });
    return {
      conch: this.#conch(),
      programs,
      checking: Boolean(this.#checking),
      checkedAt: this.#cache.checkedAt,
      auto: this.#cache.auto,
      bootId: this.deps.bootId,
    };
  }

  #conch(): ConchUpdate {
    const version = this.deps.version;
    if (!this.deps.conch)
      return {
        checkable: false,
        version,
        behind: 0,
        improvements: 0,
        whatsNew: [],
        restartNeeded: false,
        problem:
          'Conch isn’t running from a folder it can update, so it can’t check for its own updates.',
      };
    const known = this.#cache.conch;
    const outcome = this.#cache.outcome;
    const job = this.#conchJob;
    return {
      checkable: true,
      version,
      ...(known.head && { commit: known.head.slice(0, 7) }),
      ...(known.branch && { branch: known.branch }),
      behind: known.behind,
      improvements: known.improvements,
      whatsNew: known.whatsNew,
      ...(known.checkedAt && { checkedAt: known.checkedAt }),
      ...(known.problem && { problem: known.problem }),
      ...(known.blocked && { blocked: known.blocked }),
      ...(job && { running: { ...job } }),
      restartNeeded: Boolean(this.#bootHead && known.head && this.#bootHead !== known.head),
      ...(outcome && this.#now() - outcome.at < OUTCOME_FOR_MS && { outcome }),
    };
  }

  // ── Looking ─────────────────────────────────────────────────────────────

  /** Look for updates now (single-flight). Resolves when the look is done. */
  check(): Promise<void> {
    if (!this.#checking) {
      this.#checking = this.#check().finally(() => {
        this.#checking = undefined;
        this.#emit();
      });
      this.#emit();
    }
    return this.#checking;
  }

  async #check(): Promise<void> {
    await this.#load();
    await Promise.all([this.#checkConch(true), this.#checkPrograms()]);
    const now = this.#now();
    this.#cache.checkedAt = now;
    this.#cache.nextCheckAt = nextLook(now, this.deps.random ?? Math.random);
    await this.#save();
  }

  async #checkConch(fetch: boolean): Promise<void> {
    const conch = this.deps.conch;
    if (!conch || this.#conchJob) return;
    const found = await conch.check({ fetch }).catch(() => undefined);
    if (!found) return;
    const before = this.#cache.conch;
    this.#cache.conch = {
      ...(found.head && { head: found.head }),
      ...(found.branch && { branch: found.branch }),
      behind: found.behind,
      improvements: found.improvements,
      whatsNew: found.whatsNew,
      checkedAt: found.fetched ? this.#now() : before.checkedAt,
      problem: found.problem ?? (fetch ? undefined : before.problem),
      ...(found.blocked && { blocked: found.blocked }),
    };
  }

  async #checkPrograms(): Promise<void> {
    const { setup, lookup } = this.deps;
    for (const spec of this.deps.specs.values()) {
      if (!spec.version || !spec.latest || this.#jobs.has(spec.id)) continue;
      const path = await setup.path(spec);
      const installed = path ? await spec.version(path).catch(() => undefined) : undefined;
      if (!path || !installed) {
        // Gone, or can't say its version any more: it drops off the list.
        this.#cache.programs = Object.fromEntries(
          Object.entries(this.#cache.programs).filter(([id]) => id !== spec.id),
        );
        continue;
      }
      const latest = await spec.latest(path, setup.platform, lookup).catch(() => undefined);
      const before = this.#cache.programs[spec.id];
      this.#cache.programs[spec.id] = {
        ...before,
        installed,
        // A lookup that failed (offline) leaves the last answer standing.
        latest: latest ?? before?.latest,
        canUpdate: await setup.canUpdate(spec).catch(() => false),
        checkedAt: this.#now(),
      };
    }
  }

  /**
   * Something Conch knows how to get was installed or updated (here, from
   * Repair, or from a provider's page): read its version again.
   */
  async landed(id: string): Promise<void> {
    const spec = this.deps.specs.get(id);
    if (!spec?.version || !spec.latest || this.#jobs.has(id)) return;
    await this.#load();
    const { setup, lookup } = this.deps;
    const path = await setup.path(spec);
    const installed = path ? await spec.version(path).catch(() => undefined) : undefined;
    if (!path || !installed) return;
    const before = this.#cache.programs[id];
    const now = this.#now();
    const moved = before && compareVersions(installed, before.installed) > 0;
    this.#cache.programs[id] = {
      ...before,
      installed,
      latest:
        before?.latest ?? (await spec.latest(path, setup.platform, lookup).catch(() => undefined)),
      canUpdate: await setup.canUpdate(spec).catch(() => false),
      checkedAt: now,
      ...(moved && { updated: { at: now, from: before.installed } }),
    };
    this.#problems.delete(id);
    await this.#save();
    this.#emit();
  }

  // ── Programs ────────────────────────────────────────────────────────────

  /** Update one program: queued behind any other, one at a time. Resolves once queued. */
  async updateProgram(id: string, options: { auto?: boolean } = {}): Promise<void> {
    await this.#load();
    const spec = this.deps.specs.get(id);
    if (!spec?.version || !this.#cache.programs[id])
      throw new UpdatesError('not-found', 'Nothing like that to update.');
    if (this.#jobs.has(id)) return;
    this.#problems.delete(id);
    this.#jobs.set(id, { state: 'queued' });
    this.#emit();
    this.#queue = this.#queue
      .then(() => this.#updateOne(spec, options.auto ?? false))
      .catch(() => undefined);
  }

  /** Every program with an update Conch can install, one after another. */
  async updateAll(): Promise<void> {
    for (const program of (await this.status()).programs)
      if (program.available && program.canUpdate && program.state === 'idle')
        await this.updateProgram(program.id);
  }

  /** Wait for queued program updates (tests, and the overnight run). */
  settled(): Promise<void> {
    return this.#queue;
  }

  async #updateOne(spec: NeedSpec, auto: boolean): Promise<void> {
    const job = this.#jobs.get(spec.id);
    const before = this.#cache.programs[spec.id];
    if (!job || !before) return;
    const { setup } = this.deps;
    job.state = 'updating';
    job.progress = { label: `Updating ${spec.short}…` };
    this.#emit();
    try {
      await setup.update(spec);
      // The installer's own progress, as it prints it.
      const poll = setInterval(() => void this.#readProgress(spec, job), 700);
      try {
        await setup.settled(spec.id);
      } finally {
        clearInterval(poll);
      }
      const [need] = (await setup.readiness([spec])).needs;
      const path = await setup.path(spec);
      const installed =
        path && spec.version ? await spec.version(path).catch(() => undefined) : undefined;
      const now = this.#now();
      if (installed && compareVersions(installed, before.installed) > 0) {
        this.#cache.programs[spec.id] = {
          ...before,
          installed,
          checkedAt: now,
          updated: { at: now, from: before.installed },
        };
        if (auto) this.deps.heal(`${spec.short} was updated to ${installed} overnight.`);
      } else
        this.#problems.set(
          spec.id,
          need?.message ??
            (installed
              ? `The update ran, but ${spec.short} is still ${installed}.`
              : `${spec.short} was updated, but Conch can’t find it now.`),
        );
      await this.#save();
      await this.deps.landed(spec.id).catch(() => undefined);
    } catch (error) {
      this.#problems.set(spec.id, (error as Error).message);
    } finally {
      this.#jobs.delete(spec.id);
      this.#emit();
    }
  }

  async #readProgress(spec: NeedSpec, job: Job): Promise<void> {
    const [need] = (await this.deps.setup.readiness([spec]).catch(() => undefined))?.needs ?? [];
    const progress = need?.progress;
    if (!progress) return;
    if (progress.label === job.progress?.label && progress.percent === job.progress.percent) return;
    job.progress = progress;
    this.#emit();
  }

  async setAuto(auto: boolean): Promise<UpdatesStatus> {
    await this.#load();
    this.#cache.auto = auto;
    await this.#save();
    this.#emit();
    return this.status();
  }

  // ── Conch itself ────────────────────────────────────────────────────────

  /**
   * Update Conch: resolves once started. Progress, and how it ended, arrive
   * with the status; when it worked, Conch starts itself again if it can.
   */
  async updateConch(): Promise<void> {
    await this.#load();
    const conch = this.deps.conch;
    if (!conch)
      throw new UpdatesError('unavailable', 'Conch isn’t running from a folder it can update.');
    if (this.#conchJob) return;
    if (this.deps.busy())
      throw new UpdatesError(
        'busy',
        'A chat is still working. Update Conch when it’s finished, so nothing is cut short.',
      );
    this.#conchJob = { phase: 'fetch', label: 'Getting the update', step: 1, steps: 3 };
    this.#cache.outcome = undefined;
    this.#emit();
    void this.#updateConch(conch);
  }

  async #updateConch(conch: ConchCheckout): Promise<void> {
    let result: ConchResult;
    try {
      result = await conch.update((progress) => {
        this.#conchJob = progress;
        this.#emit();
      });
    } catch (error) {
      result = {
        kind: 'failed',
        message: `Conch couldn’t update itself: ${(error as Error).message}`,
      };
    }
    const now = this.#now();
    switch (result.kind) {
      case 'updated': {
        this.#cache.conch = {
          ...this.#cache.conch,
          head: result.to,
          behind: 0,
          improvements: 0,
          whatsNew: [],
          blocked: undefined,
          problem: undefined,
          checkedAt: now,
        };
        this.#cache.outcome = {
          kind: 'updated',
          message: 'Conch was updated.',
          at: now,
          whatsNew: result.whatsNew,
        };
        const restarting = this.deps.restartable();
        if (!restarting) this.#conchJob = undefined;
        await this.#save();
        if (restarting) {
          this.#conchJob = {
            phase: 'restart',
            label: 'Updating Conch…',
            step: 3,
            steps: 3,
            percent: 100,
          };
          this.#emit();
          await new Promise((resolve) => setTimeout(resolve, this.deps.restartDelayMs ?? 1500));
          if (this.deps.restart()) return;
        }
        this.#conchJob = undefined;
        break;
      }
      case 'refused':
        this.#conchJob = undefined;
        this.#cache.conch.blocked = { reason: result.reason, command: result.command };
        break;
      case 'rolled-back':
      case 'failed':
        this.#conchJob = undefined;
        this.#cache.outcome = {
          kind: result.kind,
          message: result.message,
          at: now,
          whatsNew: [],
          ...('command' in result && result.command && { command: result.command }),
        };
        await this.#checkConch(false);
        break;
      case 'current':
        this.#conchJob = undefined;
        await this.#checkConch(false);
        break;
    }
    await this.#save();
    this.#emit();
  }

  // ── The clock ───────────────────────────────────────────────────────────

  /** Start looking by itself. What the last look found is read at once, without the network. */
  start(): void {
    this.#stopped = false;
    this.#earliest = firstLook(this.#now(), this.deps.random ?? Math.random);
    void this.#boot();
    if (this.deps.schedule !== false) this.#arm(MINUTE + 1_000);
  }

  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  async #boot(): Promise<void> {
    await this.#load();
    this.#bootHead = await this.deps.conch?.head().catch(() => undefined);
    // Where the folder is now against what the last fetch brought (an update may have just landed).
    await this.#checkConch(false);
    await this.#save();
    this.#emit();
  }

  #arm(ms: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      if (this.#stopped) return;
      void this.tick()
        .catch(() => undefined)
        .finally(() => this.#arm(TICK_MS));
    }, ms);
    this.#timer.unref();
  }

  /**
   * What's due now: the daily look, and (with automatic updates on, at
   * night, while nothing runs) the program updates it found.
   */
  async tick(now = this.#now()): Promise<void> {
    await this.#load();
    if (!this.#checking && lookDue(now, this.#earliest, this.#cache.nextCheckAt))
      await this.check();
    if (!this.#cache.auto || !overnight(now) || this.deps.busy() || this.#jobs.size) return;
    for (const program of (await this.status()).programs) {
      const known: Program | undefined = this.#cache.programs[program.id];
      if (!known || !program.available || !program.canUpdate || known.autoTried === program.latest)
        continue;
      this.#cache.programs[program.id] = { ...known, autoTried: program.latest };
      await this.updateProgram(program.id, { auto: true });
    }
    await this.#save();
  }
}
