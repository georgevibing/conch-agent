/**
 * The pulse (ADR 0056): a loop in the gateway that asks each When-routine's
 * source whether anything new happened, with no model call. Only something
 * new starts a run. It keeps each thing to once (across restarts), turns a
 * burst into one run, holds runs to four an hour, checks "only if…" with a
 * small model first, and says how each source is doing.
 */
import type { TaintSource, Trigger, TriggerKind, WatchState } from '@conch/protocol';

import { Mutex } from '../../lib/fs';
import { MAX_CHAIN } from './finished';
import type { Judge } from './onlyif';
import type { PendingHappening, SeenFile, WhenStore } from './store';
import {
  SourceError,
  type Happening,
  type PulseSpend,
  type SourceContext,
  type TriggerSource,
  type WatchHandle,
} from './types';

/** How often the pulse beats. Each source sets its own pace on top. */
export const BEAT_MS = 15_000;
/** Event runs per routine in an hour; more waits and goes together. */
export const RUNS_PER_HOUR = 4;
/** Only-if checks per routine in an hour; past that, events go through unchecked. */
export const CHECKS_PER_HOUR = 10;
/** What one routine may have waiting; the oldest go first when there's more. */
const MAX_PENDING = 50;
/** A look that takes longer than this has failed. */
const CHECK_TIMEOUT_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;
/** A failure that usually passes becomes a problem after this long (unless the source says). */
const PATIENCE_MS = 30 * 60_000;
const HOUR = 60 * 60_000;

export type Sources = { [K in TriggerKind]?: TriggerSource<K> };

export interface PulseRoutine {
  id: string;
  title: string;
  status: string;
  when: Trigger;
  onlyIf?: string;
}

/** What a run started by the pulse is given. */
export interface FiredBatch {
  happenings: Happening[];
  /** The only-if couldn't be checked for some of them (they went anyway). */
  unchecked: boolean;
  /** The only-if said yes. */
  matched: boolean;
  taint: TaintSource;
  chain?: string[];
}

/** `held`: a spending guard (ADR 0057) says not yet, and why. */
export type FireResult = 'started' | 'busy' | 'not-ready' | 'gone' | { held: string };

export interface PulseDeps {
  store: WhenStore;
  sources: Sources;
  /** Every When-routine, active or not. */
  routines: () => Promise<PulseRoutine[]>;
  /** Start a run with what happened. `busy`/`not-ready` keep it waiting. */
  fire: (routineId: string, batch: FiredBatch) => Promise<FireResult>;
  judge?: Judge;
  /** Routine spending limits plug in here (ADR 0056 § Spending). */
  spend?: PulseSpend;
  now?: () => number;
  /** A source that works again after failing (a “Fixed on its own” note). */
  onHeal?: (message: string) => void;
  /** A routine's watch state changed: show it. */
  onChange?: (routineId: string) => void;
  beatMs?: number;
}

interface Live {
  key: string;
  routine: PulseRoutine;
  source: TriggerSource;
  handle?: WatchHandle;
  next: number;
  checking?: Promise<void>;
  /** Why it's waiting to run, in words, while it is. */
  holding?: string;
  /** When it last looked (kept in memory: a look that found nothing writes nothing). */
  checkedAt?: number;
}

const keyOf = (r: PulseRoutine) => JSON.stringify([r.when, r.onlyIf ?? '']);

export class Pulse {
  #timer?: NodeJS.Timeout;
  #live = new Map<string, Live>();
  #locks = new Map<string, Mutex>();
  #stopped = true;
  #beating?: Promise<void>;

  constructor(private readonly deps: PulseDeps) {}

  get #now() {
    return this.deps.now?.() ?? Date.now();
  }

  #lock(id: string) {
    let lock = this.#locks.get(id);
    if (!lock) this.#locks.set(id, (lock = new Mutex()));
    return lock;
  }

  source(kind: TriggerKind): TriggerSource | undefined {
    return this.deps.sources[kind] as TriggerSource | undefined;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  async start() {
    if (!this.#stopped) return;
    this.#stopped = false;
    await this.beat();
  }

  stop() {
    this.#stopped = true;
    clearTimeout(this.#timer);
    for (const live of this.#live.values()) live.handle?.stop();
    this.#live.clear();
  }

  /** One beat: follow what's on, look where it's time, start what's waiting. */
  beat(): Promise<void> {
    this.#beating ??= this.#beat().finally(() => {
      this.#beating = undefined;
      if (this.#stopped) return;
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => void this.beat(), this.deps.beatMs ?? BEAT_MS);
      this.#timer.unref?.();
    });
    return this.#beating;
  }

  async #beat() {
    await this.sync();
    const now = this.#now;
    const looks: Promise<void>[] = [];
    for (const [id, live] of this.#live) {
      if (live.source.check && !live.checking && live.next <= now)
        looks.push(this.#check(id, live));
    }
    await Promise.all(looks);
    for (const id of this.#live.keys()) await this.#drain(id).catch(() => undefined);
  }

  /** Follow the routines as they are now: start what's on, stop what isn't. */
  async sync() {
    const all = await this.deps.routines().catch(() => [] as PulseRoutine[]);
    const active = new Map(all.filter((r) => r.status === 'active').map((r) => [r.id, r]));
    for (const [id, live] of this.#live) {
      const now = active.get(id);
      if (!now || keyOf(now) !== live.key) {
        live.handle?.stop();
        this.#live.delete(id);
      } else live.routine = now;
    }
    for (const [id, routine] of active) {
      if (this.#live.has(id) || this.#stopped) continue;
      const source = this.source(routine.when.kind);
      if (!source) continue;
      const seen = await this.deps.store.updateSeen(id, (s) => {
        s.since ??= this.#now;
      });
      const live: Live = { key: keyOf(routine), routine, source, next: this.#now };
      this.#live.set(id, live);
      if (source.watch) {
        live.handle = source.watch(
          {
            routineId: id,
            title: routine.title,
            trigger: routine.when as never,
            since: seen.since ?? this.#now,
            state: seen.source,
          },
          (happenings) => void this.arrive(id, happenings),
          (error) => void this.#report(id, error),
        );
      }
    }
  }

  // ── Looking ────────────────────────────────────────────────────────────

  /** Look now, whatever the pace (Repair everything, a source that may be back). */
  async lookNow(id?: string) {
    await this.sync();
    const ids = id ? [id] : [...this.#live.keys()];
    await Promise.all(
      ids.map((i) => {
        const live = this.#live.get(i);
        if (!live?.source.check) return Promise.resolve();
        return live.checking ?? this.#check(i, live);
      }),
    );
  }

  #check(id: string, live: Live): Promise<void> {
    const run = async () => {
      const seen = await this.deps.store.seen(id);
      const signal = AbortSignal.timeout(CHECK_TIMEOUT_MS);
      const ctx: SourceContext = {
        routineId: id,
        title: live.routine.title,
        trigger: live.routine.when,
        since: seen.since ?? this.#now,
        state: structuredClone(seen.source),
        now: this.#now,
        signal,
      };
      const every = live.source.every?.(live.routine.when as never) ?? 5 * 60_000;
      try {
        const result = await Promise.race([
          (live.source.check as NonNullable<TriggerSource['check']>)(ctx),
          new Promise<never>((_, reject) =>
            signal.addEventListener('abort', () =>
              reject(new SourceError('retry', 'It took too long to answer.')),
            ),
          ),
        ]);
        live.next = this.#now + (result.again ?? every);
        live.checkedAt = this.#now;
        await this.#report(id, undefined);
        const state = result.state ?? ctx.state;
        // Nothing new and nothing to keep: no write at all.
        if (result.happenings.length || JSON.stringify(state) !== JSON.stringify(seen.source))
          await this.arrive(id, result.happenings, state);
      } catch (error) {
        const failure =
          error instanceof SourceError
            ? error
            : signal.aborted
              ? new SourceError('retry', 'It took too long to answer.')
              : new SourceError('retry', 'Something went wrong while looking. Conch tries again.');
        const count = (seen.failing?.count ?? 0) + 1;
        const wait = Math.min(
          Math.max(every, 60_000) * 2 ** Math.min(count - 1, 10),
          MAX_BACKOFF_MS,
        );
        live.next = this.#now + wait;
        await this.#report(id, failure);
      }
    };
    live.checking = run().finally(() => (live.checking = undefined));
    return live.checking;
  }

  /** A source's health: failing (and why), or fine again. */
  async #report(id: string, error: SourceError | undefined) {
    const before = (await this.deps.store.seen(id)).failing;
    if (!error && !before) return;
    const live = this.#live.get(id);
    const after = await this.deps.store.updateSeen(id, (s) => {
      if (!error) {
        delete s.failing;
        return;
      }
      s.failing = {
        since: s.failing?.since ?? this.#now,
        count: (s.failing?.count ?? 0) + 1,
        kind: error.kind,
        message: error.message.slice(0, 300),
        ...(error.fix && { fix: error.fix }),
      };
    });
    if (!error && before && live) {
      const lasted = this.#now - before.since;
      const patience = live.source.patience ?? PATIENCE_MS;
      if (
        before.kind === 'needs-you' ||
        lasted >= Math.min(patience, PATIENCE_MS) ||
        before.count >= 3
      )
        this.deps.onHeal?.(`“${live.routine.title}” can look again, and is watching as before.`);
    }
    if (Boolean(before) !== Boolean(after.failing) || before?.message !== after.failing?.message)
      this.deps.onChange?.(id);
  }

  // ── What happened ──────────────────────────────────────────────────────

  /** New things from a source: each once, checked against “only if”, then waiting to run. */
  arrive(id: string, happenings: Happening[], sourceState?: Record<string, unknown>) {
    return this.#lock(id).run(async () => {
      const live = this.#live.get(id);
      const fresh: Happening[] = [];
      await this.deps.store.updateSeen(id, (s) => {
        s.since ??= this.#now;
        if (sourceState) {
          s.source = sourceState;
          s.checkedAt = this.#now;
        }
        const known = new Set(s.seen);
        for (const h of happenings) {
          if (known.has(h.id)) continue;
          known.add(h.id);
          s.seen.push(h.id);
          fresh.push(h);
        }
        if (fresh.length) {
          s.noticed += fresh.length;
          s.lastNoticedAt = this.#now;
        }
      });
      if (!fresh.length || !live) return;
      const routine = live.routine;
      const keep: PendingHappening[] = [];
      let passed = 0;
      for (const h of fresh) {
        // A chain that's long, or comes back to this routine, stops here.
        if (h.chain && (h.chain.includes(id) || h.chain.length >= MAX_CHAIN)) {
          passed++;
          continue;
        }
        const verdict = routine.onlyIf ? await this.#judge(id, routine.onlyIf, h) : 'yes';
        if (verdict === 'no') {
          passed++;
          continue;
        }
        keep.push({
          id: h.id,
          at: h.at,
          label: h.label,
          detail: h.detail,
          ...(h.link && { link: h.link }),
          ...(h.chain && { chain: h.chain }),
          ...(routine.onlyIf && verdict === 'unsure' && { unchecked: true }),
        });
      }
      await this.deps.store.updateSeen(id, (s) => {
        s.passed += passed;
        s.pending = [...s.pending, ...keep].slice(-MAX_PENDING);
      });
      this.deps.onChange?.(id);
      if (keep.length) await this.#drainLocked(id);
    });
  }

  async #judge(id: string, condition: string, h: Happening): Promise<'yes' | 'no' | 'unsure'> {
    if (!this.deps.judge) return 'unsure';
    const seen = await this.deps.store.seen(id);
    const recent = seen.judged.filter((t) => this.#now - t < HOUR);
    if (recent.length >= CHECKS_PER_HOUR) return 'unsure';
    if (this.deps.spend && !(await this.deps.spend.allow(id).catch(() => true))) return 'unsure';
    await this.deps.store.updateSeen(id, (s) => {
      s.judged = [...s.judged.filter((t) => this.#now - t < HOUR), this.#now];
    });
    const { verdict, usage, model } = await this.deps
      .judge(condition, h, AbortSignal.timeout(45_000))
      .catch(() => ({ verdict: 'unsure' as const, usage: undefined, model: undefined }));
    this.deps.spend?.record(id, usage, model);
    return verdict;
  }

  #drain(id: string) {
    return this.#lock(id).run(() => this.#drainLocked(id));
  }

  /** Start a run with everything waiting, if this hour allows and a run can start. */
  async #drainLocked(id: string) {
    const live = this.#live.get(id);
    if (!live) return;
    const seen = await this.deps.store.seen(id);
    if (!seen.pending.length) return;
    const fired = seen.fired.filter((t) => this.#now - t < HOUR);
    const hold = (why: string | undefined) => {
      if (live.holding === why) return;
      live.holding = why;
      this.deps.onChange?.(id);
    };
    if (fired.length >= RUNS_PER_HOUR)
      return hold(
        `It has run ${RUNS_PER_HOUR} times this hour; what came since goes in its next run.`,
      );
    if (this.deps.spend && !(await this.deps.spend.allow(id).catch(() => true)))
      return hold('Waiting: routines have reached their spending limit for now.');
    const batch = seen.pending;
    const chain = batch.find((h) => h.chain)?.chain;
    const result = await this.deps
      .fire(id, {
        happenings: batch.map(({ unchecked: _u, ...h }) => h),
        unchecked: batch.some((h) => h.unchecked),
        matched: Boolean(live.routine.onlyIf) && batch.every((h) => !h.unchecked),
        taint: live.source.taint(live.routine.when as never),
        ...(chain && { chain }),
      })
      .catch(() => 'busy' as const);
    if (typeof result === 'object') return hold(result.held);
    if (result === 'busy') return hold('Waiting for a moment when it can run.');
    if (result === 'not-ready') return hold('Waiting for its provider to be ready.');
    const sent = new Set(batch.map((h) => h.id));
    await this.deps.store.updateSeen(id, (s) => {
      s.pending = s.pending.filter((h) => !sent.has(h.id));
      if (result === 'started') {
        s.fired = [...fired, this.#now];
        s.woke += 1;
      }
    });
    live.holding = undefined;
    this.deps.onChange?.(id);
  }

  // ── How it's doing ─────────────────────────────────────────────────────

  /** A routine's watch state, for its card, detail and Repair everything. */
  async state(routine: PulseRoutine): Promise<WatchState> {
    const seen: SeenFile = await this.deps.store.seen(routine.id).catch(
      () =>
        ({
          seen: [],
          pending: [],
          fired: [],
          judged: [],
          source: {},
          noticed: 0,
          woke: 0,
          passed: 0,
        }) as SeenFile,
    );
    const counts = {
      noticed: seen.noticed,
      woke: seen.woke,
      passed: seen.passed,
      waiting: seen.pending.length,
      ...(seen.lastNoticedAt && { lastNoticedAt: seen.lastNoticedAt }),
      ...(seen.checkedAt && { checkedAt: seen.checkedAt }),
    };
    if (routine.status !== 'active') return { state: 'off', ...counts };
    const failing = seen.failing;
    const source = this.source(routine.when.kind);
    const holding = this.#live.get(routine.id)?.holding;
    if (failing?.kind === 'needs-you')
      return {
        state: 'needs-you',
        message: failing.message,
        ...(failing.fix && { fix: failing.fix }),
        ...counts,
      };
    if (failing && this.#now - failing.since >= (source?.patience ?? PATIENCE_MS))
      return { state: 'trouble', message: failing.message, ...counts };
    const live = this.#live.get(routine.id);
    const checkedAt = live?.checkedAt ?? seen.checkedAt;
    return {
      state: 'watching',
      ...counts,
      ...(checkedAt && { checkedAt }),
      ...(holding && seen.pending.length > 0 ? { message: holding } : {}),
    };
  }

  /** Forget what it saw (a new trigger, turned on again): it starts from now. */
  async reset(id: string) {
    this.#live.get(id)?.handle?.stop();
    this.#live.delete(id);
    await this.deps.store.reset(id);
  }
}
