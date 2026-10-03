/**
 * Apps you make, share and add (ADR 0061): the one place that knows what's
 * added, what's being made, and what's on offer.
 *
 * - **Reading**: every app as `ConchApp`, and one sealed runtime per app,
 *   started when first used and stopped when it's removed or changes.
 * - **Making**: drafts in the workshop, checked with the quality bar, tried
 *   tool by tool, and offered as a card (`present`). The agent proposes;
 *   only the person's press on the card adds it (`acceptOffer`).
 * - **Adding from elsewhere**: a link, a file or the Open dialog, looked at
 *   first (`preview`), then added as exactly what was shown (`install`).
 * - **Updates**: apps from GitHub are looked at once a day; an update waits
 *   for a press.
 * - **Pages**: served sealed like an artifact's, calling only their own
 *   app's tools.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  APP_LIMITS,
  AppId,
  type AppCallResult,
  type AppCheckItem,
  type AppUpdateNotice,
  type CommunityResults,
  type ConchApp,
  type ConchAppChanges,
  type ConchAppCheck,
  type ConchAppDraft,
  type ConchAppFound,
  type ConchAppManifest,
  type ConchAppOffer,
  type ConchAppPreview,
  type ConchAppSource,
  type ConchAppTool,
  type ConversationEvent,
  type ConversationEventInput,
  type InstallAppBody,
  madeHere,
  type PreviewAppBody,
  type PublishState,
  type ServerEvent,
  type SkillSignature,
  type TaintSource,
} from '@conch/protocol';

import { frameDocument } from '../artifacts/frame';
import { describeTaint } from '../conversations/taint';
import { newId } from '../lib/ids';
import { Mutex, removeTree } from '../lib/fs';
import type { SkillRoot } from '../skills/store';
import type { ConchAppParts } from './deps';
import { ConchApps, defaultPolicy, inSentence, integrationIdOf } from './hosted';
import { PAGE_KIT_CSS } from './pagekit.generated';
import { type StarterSeed, starterFiles } from './starter';
import { type AppRecord, ConchAppStore, pathIn, writeFiles } from './store';
import {
  type AppCallOutcome,
  type AppFetcher,
  type AppFiles,
  type AppPackage,
  type AppRuntime,
  SourceError,
} from './types';
import { plainLine, safeSchema } from './words';
import { type DraftInfo, Workshop, WorkshopError } from './workshop';

export class ConchAppError extends Error {
  constructor(
    readonly code: 'not-found' | 'invalid' | 'changed' | 'conflict' | 'unavailable' | 'too-big',
    message: string,
  ) {
    super(message);
  }
}

export interface ConchAppServiceDeps {
  home: string;
  parts: ConchAppParts;
  emit: (event: ServerEvent) => void;
  /** A quiet "fixed on its own" note. */
  heal?: (message: string) => void;
  /** The chats cards live in. */
  chats: {
    events(id: string): Promise<readonly ConversationEvent[]>;
    /** Add a card's new state to a chat outside a turn (accepted later, from a route). */
    note(id: string, offer: ConchAppOffer): Promise<void>;
    exists(id: string): Promise<boolean>;
    /** What untrusted things a chat has read (ADR 0028). */
    taints?(id: string): Promise<readonly TaintSource[]>;
  };
  /** An app's skills came or went. */
  skillsChanged?: () => void;
  /** An app update was found or applied: Settings → Updates looks again. */
  updatesChanged?: () => void;
  /** The system's Open dialog for a `.conchapp` (`PickPurpose` `conch-app`). */
  pick?: () => Promise<string | undefined>;
  /** Tests: no timers. */
  manualChecks?: boolean;
  now?: () => number;
}

/** A package looked at, kept for half an hour (ADR 0061 §6). */
const PACKAGE_MS = 30 * 60_000;
const UPDATE_EVERY_MS = 24 * 60 * 60_000;
const FIRST_LOOK_MS = 2 * 60_000;
const TIDY_EVERY_MS = 6 * 60 * 60_000;

const SIG = 'conch-app.sig';

interface Found {
  pkg: AppPackage;
  found: ConchAppFound;
}

interface Package {
  at: number;
  source: ConchAppSource;
  apps: Map<string, Found>;
}

/** A tool as a card shows it: no schema, which only the model needs. */
const cardTool = ({ input: _input, ...tool }: ConchAppTool): ConchAppTool => tool;

/** A tool as an app's record keeps it: its input schema rebuilt from the allowlist (`safeSchema`). */
const storedTool = (tool: ConchAppTool): ConchAppTool => {
  const { input: raw, ...rest } = tool;
  const input = safeSchema(raw);
  return input ? { ...rest, input } : rest;
};

/** What changed from one version to the next, new reach first. */
export function changesOf(
  from: { manifest: ConchAppManifest; tools: readonly ConchAppTool[] },
  to: { manifest: ConchAppManifest; tools: readonly ConchAppTool[] },
): ConchAppChanges {
  const minus = <T>(a: readonly T[], b: readonly T[]) => a.filter((x) => !b.includes(x));
  const names = (tools: readonly ConchAppTool[]) => tools.map((t) => t.name);
  const before = new Map(from.tools.map((t) => [t.name, t]));
  return {
    from: from.manifest.version,
    to: to.manifest.version,
    reachesAdded: minus(to.manifest.reaches, from.manifest.reaches),
    reachesRemoved: minus(from.manifest.reaches, to.manifest.reaches),
    settingsAdded: minus(
      to.manifest.settings.map((s) => s.key),
      from.manifest.settings.map((s) => s.key),
    ),
    toolsAdded: minus(names(to.tools), names(from.tools)),
    toolsRemoved: minus(names(from.tools), names(to.tools)),
    toolsNowChange: to.tools
      .filter((t) => t.changes && before.get(t.name)?.changes === false)
      .map((t) => t.name),
    pagesAdded: minus(
      to.manifest.pages.map((p) => p.title),
      from.manifest.pages.map((p) => p.title),
    ),
  };
}

/** The newest state of each card in a chat's log. */
function offersIn(events: readonly ConversationEvent[]): Map<string, ConchAppOffer> {
  const out = new Map<string, ConchAppOffer>();
  for (const event of events)
    if (event.type === 'conch-app.offer') out.set(event.offer.offerId, event.offer);
  return out;
}

const problemText = (problems: readonly AppCheckItem[]) =>
  problems
    .slice(0, 5)
    .map((p) => `${p.file ? `${p.file}${p.line ? `:${p.line}` : ''}: ` : ''}${p.message}`)
    .join(' ');

/** The same place, identity by identity: a file is never the same as another. */
const sameSource = (a: ConchAppSource, b: ConchAppSource): boolean => {
  if (a.kind === 'made' && b.kind === 'made') {
    // Yours, untouched by anything from outside, on both sides; or changes to the same stranger's app.
    if (madeHere(a) && madeHere(b)) return true;
    return Boolean(
      a.basedOn &&
      b.basedOn &&
      !a.afterReading?.length &&
      !b.afterReading?.length &&
      sameSource(a.basedOn.source, b.basedOn.source),
    );
  }
  if (a.kind === 'github' && b.kind === 'github')
    return (
      a.owner.toLowerCase() === b.owner.toLowerCase() &&
      a.repo.toLowerCase() === b.repo.toLowerCase()
    );
  if (a.kind === 'link' && b.kind === 'link') return a.url === b.url;
  return false;
};

/**
 * The same hands: the same source and, for anything not made here, the
 * same signing key. Only then do the person's settings and keys carry over
 * to the new files, which could otherwise send them anywhere they reach.
 * An unsigned package from a link or a file never inherits them.
 */
export const sameHands = (
  existing: Pick<AppRecord, 'source' | 'signature'>,
  next: { source: ConchAppSource; signature: SkillSignature },
): boolean => {
  if (!sameSource(existing.source, next.source)) return false;
  if (next.source.kind === 'made') return true;
  const before = existing.signature.fingerprint;
  return (
    Boolean(before) && next.signature.state !== 'invalid' && before === next.signature.fingerprint
  );
};

/**
 * What may go out under the person's name: an app they made here. A change
 * to someone else's app is still that maker's, whatever was changed.
 */
const yours = (source: ConchAppSource) => source.kind === 'made' && !source.basedOn;

/** The words a card or a preview shows when an app replaces one from another maker. */
export const otherMakerWarning = (name: string) =>
  `This replaces ${name} from another maker; its settings, keys and data won’t carry over, so it starts fresh.`;

/** Files that should be there and aren't: what to do about it. */
const MISSING = 'Its files are missing. Open Settings → Health and press Repair everything.';

/** A workshop's refusal, in the service's own kind of error. */
function rethrow(error: unknown): never {
  if (error instanceof WorkshopError)
    throw new ConchAppError(error.code === 'too-big' ? 'too-big' : error.code, error.message);
  throw error;
}

/** Refuses every request: an app that's only being looked at fetches nothing. */
const noFetch: AppFetcher = async () => ({
  ok: false,
  status: 0,
  headers: {},
  body: '',
  refused: 'Nothing is fetched while an app is only being looked at.',
});

export class ConchAppService {
  readonly store: ConchAppStore;
  readonly workshop: Workshop;
  readonly hosted: ConchApps;
  /** Each app's runtime as it starts: set at once, so two callers get one runtime. */
  #runtimes = new Map<string, Promise<AppRuntime>>();
  /** The runtimes that did start, to stop. */
  #started = new Map<string, AppRuntime>();
  /** A change to an app in progress (install, go back, settings, removal): one at a time per app. */
  #writes = new Map<string, Promise<unknown>>();
  #drafts = new Map<string, { hash: string; runtime: AppRuntime }>();
  #failures = new Map<string, string>();
  #missing = new Map<string, string[]>();
  #packages = new Map<string, Package>();
  /** Updates found, as downloaded: the press installs exactly these. */
  #updates = new Map<string, { pkg: AppPackage; source: ConchAppSource }>();
  #installing = new Mutex();
  #timers: NodeJS.Timeout[] = [];
  #loaded?: Promise<void>;

  constructor(private readonly deps: ConchAppServiceDeps) {
    this.store = new ConchAppStore(deps.home, (area, message) => deps.heal?.(message));
    this.workshop = new Workshop(deps.home);
    this.hosted = new ConchApps({
      records: () => this.store.peek(),
      missing: (id) => this.#missing.get(id) ?? [],
      failure: (id) => this.#failures.get(id),
      patch: (id, fn) => this.store.patch(id, fn),
      setSettings: (id, values) => this.setSettings(id, values),
      remove: (id, options) => this.remove(id, options),
      checkRuntime: (id) => this.checkRuntime(id),
      call: (id, tool, input, signal) => this.#call(id, tool, input, signal),
      used: (id) => this.#used(id),
      changed: (id) => this.#changed(id),
    });
  }

  #now() {
    return (this.deps.now ?? Date.now)();
  }

  /** Read what's added, and heal what a crash left: an install cut short, a missing folder. */
  load(): Promise<void> {
    this.#loaded ??= (async () => {
      await this.store.read().catch(() => undefined);
      if (await this.store.sweep().catch(() => false))
        this.deps.heal?.('An app that was being added when Conch stopped was tidied away.');
      for (const app of this.store.peek()) await this.#heal(app).catch(() => undefined);
      await this.#refreshMissing();
    })();
    return this.#loaded;
  }

  start(): void {
    void this.load();
    if (this.deps.manualChecks) return;
    const first = setTimeout(() => void this.checkUpdates().catch(() => undefined), FIRST_LOOK_MS);
    const daily = setInterval(
      () => void this.checkUpdates().catch(() => undefined),
      UPDATE_EVERY_MS,
    );
    const tidy = setInterval(() => void this.tidy().catch(() => undefined), TIDY_EVERY_MS);
    for (const timer of [first, daily, tidy]) timer.unref();
    this.#timers.push(first, daily, tidy);
  }

  async stop(): Promise<void> {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers = [];
    await Promise.all(
      [...this.#started.values(), ...[...this.#drafts.values()].map((d) => d.runtime)].map((r) =>
        r.stop().catch(() => undefined),
      ),
    );
    this.#runtimes.clear();
    this.#started.clear();
    this.#drafts.clear();
  }

  /** Old drafts with no chat go. */
  async tidy(): Promise<number> {
    return this.workshop.tidy((id) => this.deps.chats.exists(id).catch(() => true));
  }

  // ── Reading ─────────────────────────────────────────────────────────────

  async list(): Promise<ConchApp[]> {
    await this.load();
    const secrets = await this.store
      .allSecrets()
      .catch(() => ({}) as Record<string, Record<string, string>>);
    return Promise.all(this.store.peek().map((app) => this.#toApp(app, secrets[app.id] ?? {})));
  }

  async get(id: string): Promise<ConchApp> {
    const app = await this.#record(id);
    return this.#toApp(app, await this.store.secrets(id).catch(() => ({})));
  }

  async #record(id: string): Promise<AppRecord> {
    await this.load();
    const app = AppId.safeParse(id).success ? await this.store.get(id) : undefined;
    if (!app) throw new ConchAppError('not-found', 'There’s no app with that id.');
    return app;
  }

  async #toApp(app: AppRecord, secrets: Record<string, string>): Promise<ConchApp> {
    const saved = app.manifest.settings
      .filter((s) => (s.secret ? secrets[s.key] : app.values[s.key]))
      .map((s) => s.key);
    return {
      id: app.id,
      integrationId: integrationIdOf(app.id),
      manifest: app.manifest,
      // With their input schemas: the app's page in Apps and every model read the same tools.
      tools: app.tools,
      source: app.source,
      signature: app.signature,
      hash: app.hash,
      addedAt: app.addedAt,
      updatedAt: app.updatedAt,
      versions: app.versions.map(({ version, at, hash }) => ({ version, at, hash })),
      ...(app.update && { update: app.update }),
      saved,
      values: Object.fromEntries(
        app.manifest.settings
          .filter((s) => !s.secret && app.values[s.key] !== undefined)
          .map((s) => [s.key, app.values[s.key] ?? '']),
      ),
      missing: this.#missingOf(app, secrets),
      dataBytes: await this.store.dataBytes(app.id).catch(() => 0),
      ...(app.conversationId && { conversationId: app.conversationId }),
      ...(app.draftId && { draftId: app.draftId }),
      pinned: app.pinned,
      ...(app.published && { published: app.published }),
    };
  }

  #missingOf(app: AppRecord, secrets: Record<string, string>): string[] {
    return app.manifest.settings
      .filter((s) => !s.optional && !(s.secret ? secrets[s.key] : app.values[s.key]))
      .map((s) => s.key);
  }

  async #refreshMissing() {
    const secrets = await this.store
      .allSecrets()
      .catch(() => ({}) as Record<string, Record<string, string>>);
    this.#missing = new Map(
      this.store.peek().map((app) => [app.id, this.#missingOf(app, secrets[app.id] ?? {})]),
    );
  }

  /** Something about an app changed: every open page and the Apps card hear of it. */
  async #changed(id?: string) {
    await this.#refreshMissing();
    this.deps.emit({ type: 'conch-apps.changed' });
    const app = id && this.store.peek().find((a) => a.id === id);
    if (app)
      this.deps.emit({ type: 'integration.changed', integration: this.hosted.toIntegration(app) });
    else if (id)
      this.deps.emit({ type: 'integration.deleted', integrationId: integrationIdOf(id) });
  }

  /** `current/` gone or not what was added: back from the pristine copy. True when it's fine now. */
  async #heal(app: AppRecord): Promise<boolean> {
    if (await this.store.hasCurrent(app.id)) return true;
    if (!(await this.store.restore(app.id, app.hash))) {
      this.#failures.set(
        app.id,
        `${app.manifest.name}’s files are missing, and there’s no copy to bring back. Remove it and add it again.`,
      );
      return false;
    }
    this.deps.heal?.(`${app.manifest.name}’s files were missing; Conch put them back.`);
    return true;
  }

  /** Why an app's tools couldn't start, when they couldn't. */
  failure(id: string): string | undefined {
    return this.#failures.get(id);
  }

  /** Whether an app's files are still exactly what was added. */
  async intact(id: string): Promise<boolean> {
    const app = await this.#record(id);
    if (!(await this.store.hasCurrent(id))) return false;
    const read = await this.deps.parts.readFolder(this.store.current(id)).catch(() => undefined);
    return read?.ok === true && read.app.hash === app.hash;
  }

  /** Its files back from the kept copy, when that copy is still what was added. */
  async repairFiles(id: string): Promise<boolean> {
    const app = await this.#record(id);
    const kept = await this.deps.parts
      .readFolder(this.store.kept(id, app.hash))
      .catch(() => undefined);
    if (!kept?.ok || kept.app.hash !== app.hash) return false;
    await this.#stop(id);
    if (!(await this.store.restore(id, app.hash))) return false;
    this.#failures.delete(id);
    await this.#changed(id);
    return this.intact(id);
  }

  /**
   * Change an app with nothing else changing it at once, and no runtime
   * starting on files that are being swapped (a runtime asked for meanwhile
   * waits for this to end).
   */
  #exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const before = this.#writes.get(id) ?? Promise.resolve();
    const run = before.catch(() => undefined).then(fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.#writes.set(id, tail);
    void tail.then(() => {
      if (this.#writes.get(id) === tail) this.#writes.delete(id);
    });
    return run;
  }

  /** One runtime per app, started when first used, once any change to it has finished. */
  runtimeFor(id: string): Promise<AppRuntime> {
    return this.#runtime(id, false);
  }

  /** `inside`: asked from within a change to this app, which mustn't wait for itself. */
  #runtime(id: string, inside: boolean): Promise<AppRuntime> {
    const held = this.#runtimes.get(id);
    if (held) return held;
    // Always after a turn of the loop, so the entry below is in place before it looks.
    const pending = (inside ? undefined : this.#writes.get(id)) ?? Promise.resolve();
    const slot: { token?: Promise<AppRuntime> } = {};
    const starting = (async () => {
      await pending;
      // Stopped or replaced while it waited: whatever is current now.
      if (!slot.token || this.#runtimes.get(id) !== slot.token) return this.#runtime(id, inside);
      return this.#start(id, slot.token);
    })();
    slot.token = starting;
    this.#runtimes.set(id, starting);
    starting.catch(() => {
      if (this.#runtimes.get(id) === starting) this.#runtimes.delete(id);
    });
    return starting;
  }

  async #start(id: string, token: Promise<AppRuntime>): Promise<AppRuntime> {
    const app = await this.#record(id);
    if (!(await this.#heal(app)))
      throw new ConchAppError('unavailable', this.#failures.get(id) ?? MISSING);
    await mkdir(this.store.dataDir(id), { recursive: true, mode: 0o700 });
    const runtime = this.deps.parts.runtime({
      appDir: this.store.current(id),
      dataDir: this.store.dataDir(id),
      manifest: app.manifest,
      // Read at start, so a changed setting is seen once the runtime starts again.
      settings: async () => {
        const record = (await this.store.get(id)) ?? app;
        return { ...record.values, ...(await this.store.secrets(id)) };
      },
      fetcher: this.deps.parts.fetcher,
      heal: (message) => this.deps.heal?.(message),
    });
    // Stopped while it was being made: never left running on files that changed.
    if (this.#runtimes.get(id) !== token) {
      await runtime.stop().catch(() => undefined);
      return this.#runtime(id, true);
    }
    this.#started.set(id, runtime);
    return runtime;
  }

  /** Stop an app's runtime and wait for it to end (its process lets go of its data folder). */
  async #stop(id: string) {
    this.#runtimes.delete(id);
    const runtime = this.#started.get(id);
    this.#started.delete(id);
    await runtime?.stop().catch(() => undefined);
  }

  #fail(id: string, error: unknown) {
    const name = this.store.peek().find((a) => a.id === id)?.manifest.name ?? 'This app';
    const why = error instanceof Error ? error.message.replace(/\s+/g, ' ').slice(0, 200) : '';
    this.#failures.set(
      id,
      `${name} couldn’t start${why ? `: ${why.replace(/\.$/, '')}` : ''}. Press Try again; if it keeps happening, change the app or add it again.`,
    );
  }

  /** Start an app's tools again and list them (its card's Try again). */
  async checkRuntime(id: string): Promise<void> {
    await this.#exclusive(id, () => this.#checkRuntime(id));
  }

  async #checkRuntime(id: string): Promise<void> {
    const app = await this.#record(id);
    await this.#stop(id);
    this.#failures.delete(id);
    try {
      const tools = await (await this.#runtime(id, true)).list();
      await this.store.patch(id, (record) => {
        record.tools = tools.map(storedTool);
      });
    } catch (error) {
      if (!this.#failures.has(id)) this.#fail(app.id, error);
    }
    await this.#changed(id);
  }

  async #call(
    id: string,
    tool: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AppCallOutcome> {
    try {
      const outcome = await (await this.runtimeFor(id)).call(tool, input, signal);
      if (this.#failures.delete(id)) await this.#changed(id);
      return outcome;
    } catch (error) {
      this.#fail(id, error);
      await this.#changed(id);
      return { ok: false, text: this.#failures.get(id) ?? 'It couldn’t start.' };
    }
  }

  async #used(id: string) {
    const last = this.store.peek().find((a) => a.id === id)?.lastUsedAt;
    // At most once a minute, so a busy turn doesn't rewrite the file for every call.
    if (last && this.#now() - last < 60_000) return;
    await this.store.patch(id, (app) => {
      app.lastUsedAt = this.#now();
    });
  }

  // ── Drafts ──────────────────────────────────────────────────────────────

  async #manifestOf(draftId: string): Promise<ConchAppManifest | undefined> {
    const files = await this.workshop.files(draftId).catch(() => undefined);
    const read = files && (await this.deps.parts.readFiles(files).catch(() => undefined));
    return read?.ok ? read.app.manifest : undefined;
  }

  /** A chat's draft: the one named, else its newest. */
  async draftFor(conversationId: string, draftId?: string): Promise<DraftInfo> {
    if (draftId) {
      const info = await this.workshop.info(draftId).catch(() => undefined);
      if (!info || info.conversationId !== conversationId)
        throw new ConchAppError(
          'not-found',
          'There’s no draft with that id in this chat. Call app_new to start one, or app_edit to change an app the person has.',
        );
      return info;
    }
    const [newest] = await this.workshop.ofChat(conversationId);
    if (!newest)
      throw new ConchAppError(
        'not-found',
        'No app is being made in this chat yet. Call app_new to start one, or app_edit to change an app the person has.',
      );
    return newest;
  }

  /** A draft as the protocol shows it. */
  async draft(info: DraftInfo): Promise<ConchAppDraft> {
    const files = await this.workshop.files(info.id);
    const manifest = await this.#manifestOf(info.id);
    return {
      id: info.id,
      conversationId: info.conversationId,
      ...(info.appId && { appId: info.appId }),
      ...(manifest && { manifest }),
      files: [...files].map(([path, bytes]) => ({ path, bytes: bytes.length })),
      hash: this.deps.parts.appHash(files),
      ...(info.check && { check: info.check }),
      createdAt: info.createdAt,
      updatedAt: info.updatedAt,
    };
  }

  /**
   * Start an app in a chat from the starter. A chat has one draft per app:
   * asking again for the same app gives the one already there.
   */
  async newDraft(
    conversationId: string,
    seed: StarterSeed,
  ): Promise<{ draft: DraftInfo; files: Map<string, string>; reused: boolean }> {
    const files = starterFiles(seed);
    const id = (JSON.parse(files.get('conch-app.json') ?? '{}') as { id?: string }).id;
    for (const draft of await this.workshop.ofChat(conversationId)) {
      if (draft.appId) continue;
      if ((await this.#manifestOf(draft.id))?.id !== id) continue;
      const own = await this.workshop.files(draft.id);
      return {
        draft,
        files: new Map([...own].map(([path, bytes]) => [path, bytes.toString('utf8')])),
        reused: true,
      };
    }
    const draft = await this.workshop.create({
      conversationId,
      files: new Map([...files].map(([path, text]) => [path, Buffer.from(text, 'utf8')])),
    });
    return { draft, files, reused: false };
  }

  /** Change an app you have: its files, copied into a draft in this chat. */
  async editDraft(conversationId: string, appId: string): Promise<DraftInfo> {
    const app = await this.#record(appId);
    const existing = (await this.workshop.ofChat(conversationId)).find((d) => d.appId === app.id);
    if (existing) return existing;
    if (!(await this.#heal(app)))
      throw new ConchAppError(
        'unavailable',
        this.#failures.get(app.id) ?? 'Its files are missing.',
      );
    const read = await this.deps.parts.readFolder(this.store.current(app.id));
    if (!read.ok)
      throw new ConchAppError(
        'unavailable',
        `${app.manifest.name}’s files couldn’t be read: ${problemText(read.problems)}`,
      );
    const files = new Map([...read.app.files].filter(([path]) => path !== SIG));
    const draft = await this.workshop.create({ conversationId, appId: app.id, files });
    await this.store.patch(app.id, (record) => {
      record.draftId = draft.id;
    });
    this.deps.emit({ type: 'conch-apps.changed' });
    return draft;
  }

  async write(draftId: string, path: string, content: string): Promise<DraftInfo> {
    return this.workshop.write(draftId, path, content).catch(rethrow);
  }

  async read(draftId: string, path: string): Promise<string> {
    return this.workshop.read(draftId, path).catch(rethrow);
  }

  async removeFile(draftId: string, path: string): Promise<DraftInfo> {
    return this.workshop.remove(draftId, path).catch(rethrow);
  }

  async files(draftId: string): Promise<{ path: string; bytes: number }[]> {
    return [...(await this.workshop.files(draftId))].map(([path, bytes]) => ({
      path,
      bytes: bytes.length,
    }));
  }

  /** The draft's runtime, on its own files and scratch data; a new one when the files change. */
  #draftRuntime(draftId: string, app: AppPackage): AppRuntime {
    const held = this.#drafts.get(draftId);
    if (held?.hash === app.hash) return held.runtime;
    void held?.runtime.stop().catch(() => undefined);
    const runtime = this.deps.parts.runtime({
      appDir: this.workshop.filesDir(draftId),
      dataDir: this.workshop.dataDir(draftId),
      manifest: app.manifest,
      // A draft never gets the person's settings: what it's given, it could send anywhere it reaches.
      settings: async () => ({}),
      fetcher: this.deps.parts.fetcher,
      heal: (message) => this.deps.heal?.(message),
    });
    this.#drafts.set(draftId, { hash: app.hash, runtime });
    return runtime;
  }

  /** The quality bar, on the draft's newest files. */
  async check(draftId: string): Promise<ConchAppCheck> {
    const info = await this.workshop.info(draftId);
    const files = await this.workshop.files(draftId);
    const hash = this.deps.parts.appHash(files);
    await mkdir(this.workshop.dataDir(draftId), { recursive: true, mode: 0o700 });
    const check = await this.deps.parts.checkApp(files, {
      runtime: (app) => this.#draftRuntime(draftId, app),
      tried: info.tried[hash] ?? [],
    });
    await this.workshop.patch(draftId, (draft) => {
      draft.check = check;
    });
    return check;
  }

  /** Run one of the draft's tools on its scratch data; one that answers is tried for these files. */
  async tryTool(
    draftId: string,
    tool: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ outcome: AppCallOutcome; untried: string[]; tools: ConchAppTool[] }> {
    const files = await this.workshop.files(draftId);
    const read = await this.deps.parts.readFiles(files);
    if (!read.ok)
      throw new ConchAppError(
        'invalid',
        `The draft doesn’t read as an app yet: ${problemText(read.problems)} Fix that, then try again.`,
      );
    await mkdir(this.workshop.dataDir(draftId), { recursive: true, mode: 0o700 });
    const runtime = this.#draftRuntime(draftId, read.app);
    let tools: ConchAppTool[];
    try {
      tools = await runtime.list();
    } catch (error) {
      throw new ConchAppError(
        'invalid',
        `The tools module didn’t start: ${error instanceof Error ? error.message : 'it failed'}. Run app_check to see why.`,
      );
    }
    if (!tools.some((t) => t.name === tool))
      throw new ConchAppError(
        'invalid',
        `The draft has no tool called “${tool}”. Its tools are: ${tools.map((t) => t.name).join(', ') || 'none'}.`,
      );
    let outcome: AppCallOutcome;
    try {
      outcome = await runtime.call(tool, input, signal);
    } catch (error) {
      outcome = { ok: false, text: error instanceof Error ? error.message : 'It failed.' };
    }
    const info = await this.workshop.patch(draftId, (draft) => {
      if (!outcome.ok) return;
      const tried = new Set(draft.tried[read.app.hash] ?? []);
      tried.add(tool);
      // Only the newest files matter; what was tried on older ones is forgotten.
      draft.tried = { [read.app.hash]: [...tried] };
    });
    const tried = info.tried[read.app.hash] ?? [];
    return { outcome, tools, untried: tools.map((t) => t.name).filter((t) => !tried.includes(t)) };
  }

  /**
   * Offer the draft as a card under the reply. Only files that passed the
   * check, with every tool tried, can be offered; earlier cards for the
   * same draft become history.
   */
  async present(
    ctx: { conversationId: string; append: (event: ConversationEventInput) => void },
    draftId: string,
    summary?: string,
  ): Promise<ConchAppOffer> {
    const info = await this.draftFor(ctx.conversationId, draftId);
    const files = await this.workshop.files(info.id);
    const hash = this.deps.parts.appHash(files);
    const check = info.check;
    if (!check || check.hash !== hash)
      throw new ConchAppError(
        'invalid',
        'The files changed since the last app_check. Run app_check, try any tool it lists with app_try, then app_present.',
      );
    if (check.problems.length)
      throw new ConchAppError(
        'invalid',
        `The last app_check found problems: ${problemText(check.problems)} Fix them, run app_check again, then app_present.`,
      );
    const tried = info.tried[hash] ?? [];
    const untried = check.tools.map((t) => t.name).filter((t) => !tried.includes(t));
    if (untried.length)
      throw new ConchAppError(
        'invalid',
        `Try every tool with app_try first. Still to try: ${untried.join(', ')}. Then run app_check again.`,
      );
    if (!check.ok)
      throw new ConchAppError(
        'invalid',
        'The last app_check didn’t pass. Run app_check again and do what it says, then app_present.',
      );
    const read = await this.deps.parts.readFiles(files);
    if (!read.ok)
      throw new ConchAppError(
        'invalid',
        `The draft doesn’t read as an app: ${problemText(read.problems)}`,
      );
    const { manifest } = read.app;
    if (info.appId && info.appId !== manifest.id)
      throw new ConchAppError(
        'invalid',
        `This draft changes the app “${info.appId}”, so its id in conch-app.json must stay ${info.appId}.`,
      );
    await this.load();
    const installed = await this.store.get(manifest.id);
    const tools = check.tools.map(cardTool);
    // What the chat had read, and whose app this changes: such an app is treated as from outside.
    const seen = await this.deps.chats.taints?.(ctx.conversationId).catch(() => []);
    const before = info.appId ? await this.store.get(info.appId) : undefined;
    const basedOn =
      before?.source.kind === 'made'
        ? before.source.basedOn
        : before && { name: plainLine(before.manifest.name, 80), source: before.source };
    const afterReading = [
      ...new Set([
        ...(before?.source.kind === 'made' ? (before.source.afterReading ?? []) : []),
        ...(seen ?? []).map((t) => plainLine(t.label, 120)),
      ]),
    ].slice(0, 5);
    const source: ConchAppSource = {
      kind: 'made',
      conversationId: ctx.conversationId,
      ...(afterReading.length && { afterReading }),
      ...(basedOn && { basedOn }),
    };
    const signature: SkillSignature = { state: 'unsigned' };
    const offer: ConchAppOffer = {
      offerId: newId('capo'),
      action: installed ? 'update' : 'add',
      from: 'draft',
      draftId: info.id,
      hash,
      manifest,
      tools,
      source,
      signature,
      ...(installed && {
        changes: {
          ...changesOf(installed, { manifest, tools: check.tools }),
          ...(!sameHands(installed, { source, signature }) && { otherMaker: true }),
        },
      }),
      ...(summary && { summary: summary.slice(0, 300) }),
      state: 'ready',
    };
    const events = await this.deps.chats.events(ctx.conversationId).catch(() => []);
    for (const old of offersIn(events).values())
      if (old.draftId === info.id && old.state === 'ready')
        ctx.append({ type: 'conch-app.offer', offer: { ...old, state: 'stale' } });
    ctx.append({ type: 'conch-app.offer', offer });
    return offer;
  }

  // ── The card's press ────────────────────────────────────────────────────

  /** A card as it stands now in a chat's log. */
  async offerIn(conversationId: string, offerId: string): Promise<ConchAppOffer> {
    const events = await this.deps.chats.events(conversationId).catch(() => {
      throw new ConchAppError('not-found', 'That chat isn’t there any more.');
    });
    const offer = offersIn(events).get(offerId);
    if (!offer) throw new ConchAppError('not-found', 'That wasn’t offered in this chat.');
    return offer;
  }

  /** **Add to my apps** (or **Update**) on a card: exactly the files it showed, or nothing. */
  async acceptOffer(
    offerId: string,
    body: { conversationId: string; settings?: Record<string, string> },
  ): Promise<ConchApp> {
    return this.#installing.run(async () => {
      const offer = await this.offerIn(body.conversationId, offerId);
      if (offer.state === 'added' || offer.state === 'updated') return this.get(offer.manifest.id);
      if (offer.state === 'stale')
        throw new ConchAppError(
          'conflict',
          'A newer version was offered since. Use the newest card.',
        );
      if (offer.state !== 'ready')
        throw new ConchAppError('conflict', 'That card was put away. Ask for the app again.');
      const settings = this.#settingsFor(offer.manifest, body.settings ?? {});
      let pkg: AppPackage;
      let source: ConchAppSource = offer.source;
      if (offer.from === 'draft') {
        const info = offer.draftId
          ? await this.workshop.info(offer.draftId).catch(() => undefined)
          : undefined;
        if (!info || info.conversationId !== body.conversationId)
          throw new ConchAppError(
            'not-found',
            'The app being made isn’t there any more. Ask for it again.',
          );
        const files = await this.workshop.files(info.id);
        if (this.deps.parts.appHash(files) !== offer.hash)
          return this.#changedSince(body.conversationId, offer);
        const read = await this.deps.parts.readFiles(files);
        if (
          !read.ok ||
          read.app.hash !== offer.hash ||
          info.check?.hash !== offer.hash ||
          !info.check.ok
        )
          return this.#changedSince(body.conversationId, offer);
        pkg = read.app;
      } else {
        const held = offer.packageId ? this.#package(offer.packageId) : undefined;
        const found = held?.apps.get(offer.manifest.id);
        if (!held || !found)
          throw new ConchAppError(
            'changed',
            'It’s been more than half an hour since this card was made. Ask for the app again.',
          );
        if (found.pkg.hash !== offer.hash) return this.#changedSince(body.conversationId, offer);
        if (found.found.problems.length)
          throw new ConchAppError('invalid', problemText(found.found.problems));
        pkg = found.pkg;
        source = held.source;
      }
      let app: ConchApp;
      try {
        app = await this.#install({
          pkg,
          source,
          signature: offer.signature,
          tools: offer.tools,
          made: offer.from === 'draft',
          conversationId: body.conversationId,
          settings,
        });
      } catch (error) {
        await this.deps.chats
          .note(body.conversationId, {
            ...offer,
            state: 'failed',
            message: 'It couldn’t be added. Ask for it again, or try once more.',
          })
          .catch(() => undefined);
        throw error;
      }
      if (offer.from === 'draft' && offer.draftId)
        await this.workshop
          .patch(offer.draftId, (draft) => {
            draft.appId = pkg.manifest.id;
          })
          .catch(() => undefined);
      await this.deps.chats.note(body.conversationId, {
        ...offer,
        tools: app.tools.map(cardTool),
        state: offer.action === 'update' ? 'updated' : 'added',
      });
      return app;
    });
  }

  async #changedSince(conversationId: string, offer: ConchAppOffer): Promise<never> {
    const message = 'It changed since you saw it; ask for the card again.';
    await this.deps.chats
      .note(conversationId, { ...offer, state: 'failed', message })
      .catch(() => undefined);
    throw new ConchAppError('changed', message);
  }

  /** **Not now** on a card. */
  async declineOffer(offerId: string, body: { conversationId: string }): Promise<void> {
    const offer = await this.offerIn(body.conversationId, offerId);
    if (offer.state !== 'ready') return;
    await this.deps.chats.note(body.conversationId, { ...offer, state: 'declined' });
  }

  /** The settings typed into a card or a preview: each one the app declares, secret ones apart. */
  #settingsFor(
    manifest: ConchAppManifest,
    values: Record<string, string>,
  ): { secret: Record<string, string>; plain: Record<string, string> } {
    const secret: Record<string, string> = {};
    const plain: Record<string, string> = {};
    for (const [key, raw] of Object.entries(values)) {
      const setting = manifest.settings.find((s) => s.key === key);
      if (!setting)
        throw new ConchAppError('invalid', `${manifest.name} has no setting called “${key}”.`);
      const value = raw.trim();
      if (setting.secret) secret[key] = value;
      else plain[key] = value;
    }
    return { secret, plain };
  }

  /**
   * Put an app in place: its files (the version before kept for Go back),
   * its settings, its policy, then its tools as its runtime lists them.
   */
  #install(input: Parameters<ConchAppService['installNow']>[0]): Promise<ConchApp> {
    return this.#exclusive(input.pkg.manifest.id, () => this.installNow(input));
  }

  /** `#install`, inside the app's own lock. Only for `#install`. */
  private async installNow(input: {
    pkg: AppPackage;
    source: ConchAppSource;
    signature: SkillSignature;
    tools: ConchAppTool[];
    made: boolean;
    conversationId?: string;
    settings: { secret: Record<string, string>; plain: Record<string, string> };
  }): Promise<ConchApp> {
    await this.load();
    const { pkg, source, signature, made } = input;
    const { manifest } = pkg;
    const id = manifest.id;
    const existing = await this.store.get(id);
    // Settings and keys carry over only in the same hands (the same source and signer).
    const keep = existing ? sameHands(existing, { source, signature }) : false;
    const hadSkills = existing ? await this.#hasSkills(id) : false;
    await this.#stop(id);
    this.#updates.delete(id);
    await this.store.place(id, pkg.files, pkg.hash);
    // Its data carries over only in the same hands, like its keys: what one maker's app
    // kept for you is never handed to another's (before any runtime starts on it).
    if (existing) {
      if (!keep) await this.store.wipeData(id);
    } else {
      const owner = await this.store.keptData(id);
      const same =
        owner &&
        sameHands(
          {
            source: owner.source,
            signature: owner.fingerprint
              ? { state: 'untrusted', fingerprint: owner.fingerprint }
              : { state: 'unsigned' },
          },
          { source, signature },
        );
      if (!same) await this.store.wipeData(id);
      if (owner) await this.store.setKeptData(id, undefined);
    }
    await mkdir(this.store.dataDir(id), { recursive: true, mode: 0o700 });
    // Secrets for settings it no longer declares go; new ones are kept sealed.
    const declared = new Set(manifest.settings.map((s) => s.key));
    const kept =
      existing && keep
        ? Object.fromEntries(
            Object.entries(await this.store.secrets(id).catch(() => ({}))).filter(
              ([key]) => declared.has(key) && manifest.settings.find((s) => s.key === key)?.secret,
            ),
          )
        : {};
    await this.store.setSecrets(id, undefined);
    const secrets = { ...kept, ...input.settings.secret };
    if (Object.values(secrets).some(Boolean)) await this.store.setSecrets(id, secrets);
    const now = this.#now();
    const tools = input.tools.map(storedTool);
    const record: AppRecord = existing
      ? {
          ...existing,
          manifest,
          tools,
          source,
          signature,
          hash: pkg.hash,
          // Another maker's versions are never offered for Go back: they could run with your keys.
          versions: !keep
            ? []
            : existing.hash === pkg.hash
              ? existing.versions
              : [
                  {
                    version: existing.manifest.version,
                    at: existing.updatedAt,
                    hash: existing.hash,
                    source: existing.source,
                    signature: existing.signature,
                  },
                  ...existing.versions.filter(
                    (v) => v.hash !== pkg.hash && v.hash !== existing.hash,
                  ),
                ].slice(0, APP_LIMITS.keep),
          updatedAt: now,
          update: undefined,
          updateHash: undefined,
          values: Object.fromEntries(
            Object.entries({ ...(keep ? existing.values : {}), ...input.settings.plain }).filter(
              ([key, value]) => declared.has(key) && value !== '',
            ),
          ),
          // Someone else's app in place of yours starts again at its own default policy.
          policy: keep ? existing.policy : defaultPolicy({ source }),
          toolPolicies: keep
            ? Object.fromEntries(
                Object.entries(existing.toolPolicies).filter(([name]) =>
                  tools.some((t) => t.name === name),
                ),
              )
            : {},
          draftId: undefined,
          ...(input.conversationId && { conversationId: input.conversationId }),
        }
      : {
          id,
          manifest,
          tools,
          source,
          signature,
          hash: pkg.hash,
          versions: [],
          addedAt: now,
          updatedAt: now,
          ...(input.conversationId && made && { conversationId: input.conversationId }),
          pinned: manifest.pages.length > 0,
          enabled: true,
          policy: defaultPolicy({ source }),
          toolPolicies: {},
          values: Object.fromEntries(
            Object.entries(input.settings.plain).filter(([, value]) => value !== ''),
          ),
        };
    await this.store.update((apps) => [...apps.filter((a) => a.id !== id), record]);
    // Whatever started on the files before they were in place goes again.
    await this.#stop(id);
    await this.store.prune(id, [record.hash, ...record.versions.map((v) => v.hash)]);
    this.#failures.delete(id);
    // Its tools as its runtime lists them now.
    try {
      const listed = await (await this.#runtime(id, true)).list();
      await this.store.patch(id, (app) => {
        app.tools = listed.map(storedTool);
      });
    } catch (error) {
      this.#fail(id, error);
    }
    if (hadSkills || (await this.#hasSkills(id))) this.deps.skillsChanged?.();
    await this.#changed(id);
    if (existing?.update) this.deps.updatesChanged?.();
    return this.get(id);
  }

  async #hasSkills(id: string) {
    return stat(join(this.store.current(id), 'skills')).then(
      (s) => s.isDirectory(),
      () => false,
    );
  }

  // ── Adding from elsewhere ───────────────────────────────────────────────

  #package(packageId: string): Package | undefined {
    const now = this.#now();
    for (const [id, held] of this.#packages)
      if (now - held.at > PACKAGE_MS) this.#packages.delete(id);
    return this.#packages.get(packageId);
  }

  /**
   * What a link, a file or the Open dialog holds, looked at with the quality
   * bar's safety half and its signature, beside what you already have.
   * Undefined: the Open dialog was cancelled.
   */
  async preview(input: PreviewAppBody | { pick: true }): Promise<ConchAppPreview | undefined> {
    await this.load();
    let archive: Buffer;
    let path: string | undefined;
    let source: ConchAppSource;
    if ('link' in input) {
      try {
        const fetched = await this.deps.parts.sources.fetch(input.link);
        archive = fetched.archive;
        path = fetched.path;
        source =
          fetched.source.kind === 'github'
            ? {
                kind: 'github',
                owner: fetched.source.owner,
                repo: fetched.source.repo,
                url: fetched.source.url,
                ...(fetched.source.path && { path: fetched.source.path }),
                ...(fetched.source.ref && { ref: fetched.source.ref }),
                ...(fetched.source.commit && { commit: fetched.source.commit }),
              }
            : { kind: 'link', url: fetched.source.url };
      } catch (error) {
        if (error instanceof SourceError)
          throw new ConchAppError(
            error.code === 'too-big'
              ? 'too-big'
              : error.code === 'not-a-link' || error.code === 'not-found'
                ? 'invalid'
                : 'unavailable',
            error.message,
          );
        throw error;
      }
    } else if ('file' in input) {
      archive = Buffer.from(input.file, 'base64');
      source = { kind: 'file', name: basename(input.name).slice(0, 200) || 'app.conchapp' };
    } else {
      const chosen = await this.deps.pick?.();
      if (!chosen) return undefined;
      const info = await stat(chosen).catch(() => undefined);
      if (!info?.isFile())
        throw new ConchAppError('invalid', 'That isn’t a .conchapp file. Choose the file again.');
      if (info.size > APP_LIMITS.download)
        throw new ConchAppError(
          'too-big',
          'That file is over 10 MB, which is more than an app can be.',
        );
      archive = await readFile(chosen);
      source = { kind: 'file', name: basename(chosen).slice(0, 200) };
    }
    if (archive.length > APP_LIMITS.download)
      throw new ConchAppError(
        'too-big',
        'That file is over 10 MB, which is more than an app can be.',
      );
    const reads = await this.deps.parts
      .findApps(archive, path ? { path } : undefined)
      .catch((error: unknown) => {
        throw new ConchAppError(
          'invalid',
          `It couldn’t be opened as a Conch app: ${error instanceof Error ? error.message : 'it isn’t one'}.`,
        );
      });
    const apps = new Map<string, Found>();
    const problems: AppCheckItem[] = [];
    for (const read of reads) {
      if (!read.ok) {
        problems.push(...read.problems);
        continue;
      }
      if (apps.has(read.app.manifest.id)) continue;
      apps.set(read.app.manifest.id, await this.#look(read.app, source));
    }
    if (!apps.size)
      throw new ConchAppError(
        'invalid',
        problems.length
          ? `There’s no Conch app it can add: ${problemText(problems)}`
          : 'There’s no Conch app in it: no conch-app.json at its top or up to three folders down.',
      );
    const packageId = newId('cpkg');
    this.#package(packageId);
    this.#packages.set(packageId, { at: this.#now(), source, apps });
    return { packageId, source, apps: [...apps.values()].map((a) => a.found) };
  }

  /** One package looked at: its safety, its signature, and how it differs from what you have. */
  async #look(pkg: AppPackage, source: ConchAppSource): Promise<Found> {
    const dir = await this.store.scratch();
    const runtimes: AppRuntime[] = [];
    try {
      await writeFiles(join(dir, 'files'), pkg.files);
      await mkdir(join(dir, 'data'), { recursive: true, mode: 0o700 });
      const check = await this.deps.parts.checkApp(pkg.files, {
        safetyOnly: true,
        runtime: (app) => {
          const runtime = this.deps.parts.runtime({
            appDir: join(dir, 'files'),
            dataDir: join(dir, 'data'),
            manifest: app.manifest,
            settings: async () => ({}),
            fetcher: noFetch,
          });
          runtimes.push(runtime);
          return runtime;
        },
      });
      const signature = await this.deps.parts.verifyApp(pkg, this.deps.home);
      const installed = await this.store.get(pkg.manifest.id);
      const problems = [...check.problems];
      if (signature.state === 'invalid')
        problems.push({
          message: `${signature.problem ?? 'Its signature doesn’t hold'}: what’s in it isn’t what was signed, so it can’t be added.`,
        });
      const otherMaker = installed ? !sameHands(installed, { source, signature }) : false;
      return {
        pkg,
        found: {
          manifest: pkg.manifest,
          tools: check.tools.map(cardTool),
          signature,
          hash: pkg.hash,
          problems,
          ...(otherMaker &&
            installed && { warnings: [{ message: otherMakerWarning(installed.manifest.name) }] }),
          ...(installed && {
            installed: installed.manifest.version,
            changes: {
              ...changesOf(installed, { manifest: pkg.manifest, tools: check.tools }),
              ...(otherMaker && { otherMaker }),
            },
          }),
        },
      };
    } finally {
      await Promise.all(runtimes.map((r) => r.stop().catch(() => undefined)));
      await removeTree(dir).catch(() => undefined);
    }
  }

  /**
   * Show a package's app as a card in a chat (`app_get`): from a link, never
   * the person's press. Undefined when the package has none that can be added.
   */
  async offerPackage(
    ctx: { conversationId: string; append: (event: ConversationEventInput) => void },
    preview: ConchAppPreview,
    appId?: string,
  ): Promise<ConchAppOffer | undefined> {
    const found = preview.apps.find((a) => (appId ? a.manifest.id === appId : !a.problems.length));
    if (!found || found.problems.length) return undefined;
    const offer: ConchAppOffer = {
      offerId: newId('capo'),
      action: found.installed ? 'update' : 'add',
      from: 'package',
      packageId: preview.packageId,
      hash: found.hash,
      manifest: found.manifest,
      tools: found.tools,
      source: preview.source,
      signature: found.signature,
      ...(found.changes && { changes: found.changes }),
      state: 'ready',
    };
    ctx.append({ type: 'conch-app.offer', offer });
    return offer;
  }

  /** **Add to my apps** on a preview in Apps: exactly what was shown. */
  async install(body: InstallAppBody): Promise<ConchApp> {
    return this.#installing.run(async () => {
      const held = this.#package(body.packageId);
      if (!held)
        throw new ConchAppError(
          'changed',
          'It’s been more than half an hour since you looked at it. Look at the link or file again.',
        );
      const found = held.apps.get(body.appId);
      if (!found) throw new ConchAppError('not-found', 'That app isn’t in what you looked at.');
      if (found.pkg.hash !== body.hash)
        throw new ConchAppError('changed', 'It changed since you saw it; look at it again.');
      if (found.found.problems.length)
        throw new ConchAppError('invalid', problemText(found.found.problems));
      return this.#install({
        pkg: found.pkg,
        source: held.source,
        signature: found.found.signature,
        tools: found.found.tools,
        made: false,
        settings: this.#settingsFor(found.pkg.manifest, body.settings),
      });
    });
  }

  // ── Updates ─────────────────────────────────────────────────────────────

  /** Look where each app from GitHub came from for a newer version. */
  async checkUpdates(): Promise<void> {
    await this.load();
    let found = false;
    for (const app of this.store.peek()) {
      if (app.source.kind !== 'github') continue;
      const latest = await this.deps.parts.sources
        .latest({
          owner: app.source.owner,
          repo: app.source.repo,
          ...(app.source.ref && { ref: app.source.ref }),
        })
        .catch(() => undefined);
      if (!latest) continue;
      const same = latest.commit
        ? latest.commit === app.source.commit
        : latest.ref === app.source.ref;
      if (same) continue;
      if (await this.#findUpdate(app).catch(() => false)) found = true;
    }
    if (found) {
      this.deps.emit({ type: 'conch-apps.changed' });
      this.deps.updatesChanged?.();
    }
  }

  /** What's where an app came from now, downloaded and read. Nothing is written, nothing runs. */
  async #fetchUpdate(
    app: AppRecord,
  ): Promise<{ pkg: AppPackage; source: ConchAppSource } | undefined> {
    if (app.source.kind !== 'github') return undefined;
    const fetched = await this.deps.parts.sources.fetch(app.source.url);
    const reads = await this.deps.parts.findApps(fetched.archive, {
      ...((fetched.path ?? app.source.path) && { path: fetched.path ?? app.source.path }),
    });
    const read = reads.find((r) => r.ok && r.app.manifest.id === app.id);
    if (!read?.ok) return undefined;
    const source: ConchAppSource =
      fetched.source.kind === 'github'
        ? {
            ...app.source,
            ...(fetched.source.ref && { ref: fetched.source.ref }),
            ...(fetched.source.commit && { commit: fetched.source.commit }),
          }
        : app.source;
    return { pkg: read.app, source };
  }

  /**
   * The quality bar's safety half without running anything: the tools
   * module is scanned as text, never loaded. A stranger's code runs only
   * once the person opens the update (ADR 0061 §9).
   */
  async #staticProblems(pkg: AppPackage): Promise<AppCheckItem[]> {
    const { tools: _tools, ...manifest } = pkg.manifest;
    const files = new Map(pkg.files);
    files.set('conch-app.json', Buffer.from(JSON.stringify(manifest)));
    const check = await this.deps.parts.checkApp(files, {
      safetyOnly: true,
      runtime: () => {
        throw new Error('Nothing runs before you look at it.');
      },
    });
    return check.problems;
  }

  /** Note a newer version as an app's update: static looks only, so nothing it holds runs. */
  async #announce(
    app: AppRecord,
    held: { pkg: AppPackage; source: ConchAppSource },
  ): Promise<boolean> {
    if ((await this.#staticProblems(held.pkg)).length) return false;
    const signature = await this.deps.parts.verifyApp(held.pkg, this.deps.home);
    if (signature.state === 'invalid') return false;
    const sameSigner =
      Boolean(app.signature.fingerprint) && signature.fingerprint === app.signature.fingerprint;
    this.#updates.set(app.id, held);
    await this.store.patch(app.id, (record) => {
      record.update = {
        version: held.pkg.manifest.version,
        foundAt: this.#now(),
        signature,
        sameSigner,
        // Its tools are known once it's opened; until then, what its manifest says.
        changes: changesOf(app, { manifest: held.pkg.manifest, tools: app.tools }),
      };
      record.updateHash = held.pkg.hash;
    });
    return true;
  }

  /** Download where an app came from; a different, safe version waits as its update. */
  async #findUpdate(app: AppRecord): Promise<boolean> {
    const held = await this.#fetchUpdate(app);
    if (!held) return false;
    if (held.pkg.hash === app.hash) {
      // The same files at a newer commit: nothing to offer, only where it's been seen.
      await this.store.patch(app.id, (record) => {
        record.source = held.source;
      });
      return false;
    }
    return this.#announce(app, held);
  }

  /**
   * The update waiting for an app, as its page shows it before **Update**:
   * here, and only here, its tools load — in a throwaway runtime that
   * fetches nothing and has none of your settings.
   */
  async updatePreview(id: string): Promise<ConchAppFound> {
    const app = await this.#record(id);
    if (!app.update || !app.updateHash)
      throw new ConchAppError('not-found', 'There’s no update waiting for it.');
    let held = this.#updates.get(id);
    if (!held) {
      // After a restart the download is gone: fetched again, and what's there now is what's shown.
      held = await this.#fetchUpdate(app).catch(() => undefined);
      if (!held || held.pkg.hash === app.hash)
        throw new ConchAppError('changed', 'The update isn’t there any more. Look again later.');
      if (held.pkg.hash !== app.updateHash && !(await this.#announce(app, held)))
        throw new ConchAppError('changed', 'The update changed and can’t be added as it is now.');
      this.#updates.set(id, held);
    }
    const { found } = await this.#look(held.pkg, held.source);
    return found;
  }

  /**
   * **Update**: the person's press, carrying the hash of the version they
   * looked at. Exactly those files, with a signature read from them now.
   */
  async applyUpdate(id: string, hash: string): Promise<ConchApp> {
    return this.#installing.run(async () => {
      const app = await this.#record(id);
      if (!app.update) throw new ConchAppError('not-found', 'There’s no update waiting for it.');
      // Never fetched again here: a press installs what was held for the preview, or nothing.
      const held = this.#updates.get(id);
      if (!held || held.pkg.hash !== hash || app.updateHash !== hash)
        throw new ConchAppError('changed', 'A newer version arrived since you looked; look again.');
      const { found } = await this.#look(held.pkg, held.source);
      if (found.problems.length) throw new ConchAppError('invalid', problemText(found.problems));
      return this.#install({
        pkg: held.pkg,
        source: held.source,
        signature: found.signature,
        tools: found.tools,
        made: false,
        settings: { secret: {}, plain: {} },
      });
    });
  }
  /** Apps with an update waiting, for Settings → Updates. */
  updateNotices(): AppUpdateNotice[] {
    return this.store.peek().flatMap((app) =>
      app.update
        ? [
            {
              appId: app.id,
              name: app.manifest.name,
              installed: app.manifest.version,
              latest: app.update.version,
              sameSigner: app.update.sameSigner,
              reachesAdded: app.update.changes.reachesAdded,
            },
          ]
        : [],
    );
  }

  // ── The rest ────────────────────────────────────────────────────────────

  /** **Go back** to a kept version. */
  async rollback(id: string, version: string): Promise<ConchApp> {
    return this.#installing.run(() =>
      this.#exclusive(id, async () => {
        const app = await this.#record(id);
        const target = app.versions.find((v) => v.version === version);
        if (!target) throw new ConchAppError('not-found', 'That version isn’t kept any more.');
        const read = await this.deps.parts.readFolder(this.store.kept(id, target.hash));
        if (!read.ok || read.app.hash !== target.hash)
          throw new ConchAppError(
            'unavailable',
            'The copy of that version isn’t what was kept, so Conch won’t go back to it.',
          );
        // Kept versions are the same hands' by construction; checked again all the same.
        const hands = {
          source: target.source ?? app.source,
          signature: target.signature ?? app.signature,
        };
        const keep = sameHands(app, hands);
        await this.#stop(id);
        await this.store.restore(id, target.hash);
        if (!keep) {
          await this.store.setSecrets(id, undefined);
          await this.store.wipeData(id);
          await mkdir(this.store.dataDir(id), { recursive: true, mode: 0o700 });
        }
        await this.store.patch(id, (record) => {
          record.versions = keep
            ? [
                {
                  version: record.manifest.version,
                  at: record.updatedAt,
                  hash: record.hash,
                  source: record.source,
                  signature: record.signature,
                },
                ...record.versions.filter((v) => v.hash !== target.hash),
              ].slice(0, APP_LIMITS.keep)
            : [];
          record.manifest = read.app.manifest;
          record.hash = target.hash;
          record.updatedAt = this.#now();
          if (!keep) {
            record.source = hands.source;
            record.signature = hands.signature;
            record.values = {};
            record.policy = defaultPolicy(hands);
            record.toolPolicies = {};
          }
        });
        await this.store.prune(id, [
          target.hash,
          ...((await this.store.get(id))?.versions.map((v) => v.hash) ?? []),
        ]);
        await this.#checkRuntime(id);
        this.deps.skillsChanged?.();
        return this.get(id);
      }),
    );
  }

  /** Remove an app; its data goes too unless it's kept. */
  async remove(id: string, options: { keepData: boolean }): Promise<void> {
    await this.#installing.run(() =>
      this.#exclusive(id, async () => {
        const app = await this.#record(id);
        const hadSkills = await this.#hasSkills(id);
        await this.#stop(id);
        this.#updates.delete(id);
        this.#failures.delete(id);
        await this.store.removeFiles(id, options.keepData);
        await this.store.setSecrets(id, undefined);
        // Whose data stays, so it's given back only to the same hands.
        await this.store.setKeptData(
          id,
          options.keepData
            ? {
                source: app.source,
                ...(app.signature.fingerprint && { fingerprint: app.signature.fingerprint }),
              }
            : undefined,
        );
        await this.store.update((apps) => apps.filter((a) => a.id !== app.id));
        if (hadSkills) this.deps.skillsChanged?.();
        await this.#changed(id);
        if (app.update) this.deps.updatesChanged?.();
      }),
    );
  }

  /** The person's settings for an app. A secret one is never sent back; `''` clears one. */
  async setSettings(id: string, values: Record<string, string>): Promise<ConchApp> {
    return this.#exclusive(id, () => this.#setSettings(id, values));
  }

  async #setSettings(id: string, values: Record<string, string>): Promise<ConchApp> {
    const app = await this.#record(id);
    const { secret, plain } = this.#settingsFor(app.manifest, values);
    if (Object.keys(secret).length) await this.store.setSecrets(id, secret);
    await this.store.patch(id, (record) => {
      record.values = Object.fromEntries(
        Object.entries({ ...record.values, ...plain }).filter(([, value]) => value !== ''),
      );
    });
    // The runtime reads settings when it starts.
    await this.#stop(id);
    await this.#changed(id);
    return this.get(id);
  }

  async setPinned(id: string, pinned: boolean): Promise<ConchApp> {
    await this.#record(id);
    await this.store.patch(id, (record) => {
      record.pinned = pinned;
    });
    await this.#changed(id);
    return this.get(id);
  }

  /** The app's current files, exactly as they were added (with the signature they came with). */
  async #added(id: string): Promise<{ app: AppRecord; read: AppPackage }> {
    const app = await this.#record(id);
    if (!(await this.#heal(app)))
      throw new ConchAppError('unavailable', this.#failures.get(id) ?? 'Its files are missing.');
    const read = await this.deps.parts.readFolder(this.store.current(id));
    if (!read.ok)
      throw new ConchAppError(
        'unavailable',
        `Its files couldn’t be read: ${problemText(read.problems)}`,
      );
    if (read.app.hash !== app.hash)
      throw new ConchAppError(
        'unavailable',
        'Its files aren’t what was added. Open Settings → Health and press Repair, then try again.',
      );
    return { app, read: read.app };
  }

  /** An app made here, signed with the person's key: only what they made is vouched for as theirs. */
  async #signed(id: string): Promise<{ app: AppRecord; files: AppFiles }> {
    const { app, read } = await this.#added(id);
    if (!yours(app.source))
      throw new ConchAppError(
        'invalid',
        'Only apps you made can be published as yours. Share the address you added it from instead.',
      );
    try {
      return { app, files: await this.deps.parts.signApp(read, this.deps.home) };
    } catch (error) {
      throw new ConchAppError(
        'unavailable',
        `It couldn’t be signed with your key: ${error instanceof Error ? error.message : 'try again'}.`,
      );
    }
  }

  /**
   * **Save as a file**: `<id>.conchapp`. One you made is signed with your
   * key; anyone else's goes as it was added, with its own signature if it
   * had one, so it still says who really made it.
   */
  async exportFile(id: string): Promise<{ name: string; bytes: Buffer }> {
    const app = await this.#record(id);
    const files = yours(app.source)
      ? (await this.#signed(id)).files
      : (await this.#added(id)).read.files;
    return { name: `${app.id}.conchapp`, bytes: await this.deps.parts.packApp(files) };
  }

  /** **Publish on GitHub**: only an app you made, signed first, then GitHub's own program. */
  async publish(id: string): Promise<PublishState> {
    const { app, files } = await this.#signed(id);
    const sig = files.get(SIG);
    if (sig) await writeFile(pathIn(this.store.current(id), SIG), sig);
    const state = await this.deps.parts.publisher.publish({
      id: app.id,
      dir: this.store.current(id),
      manifest: app.manifest,
    });
    await this.#published(id, state);
    return state;
  }

  async publishState(id: string): Promise<PublishState> {
    await this.#record(id);
    const state = this.deps.parts.publisher.state(id);
    await this.#published(id, state);
    return state;
  }

  async #published(id: string, state: PublishState) {
    if (state.state !== 'published') return;
    const app = this.store.peek().find((a) => a.id === id);
    if (app?.published === state.url) return;
    await this.store.patch(id, (record) => {
      record.published = state.url;
    });
    await this.#changed(id);
  }

  /** **From the community**, with the apps you already have marked. */
  async community(query: string): Promise<CommunityResults> {
    await this.load();
    const found = await this.deps.parts.sources.search(query.trim().slice(0, 100)).catch(() => ({
      repos: [],
      limited: false,
      offline: true,
    }));
    const have = new Set(
      this.store
        .peek()
        .flatMap((a) =>
          a.source.kind === 'github' ? [`${a.source.owner}/${a.source.repo}`.toLowerCase()] : [],
        ),
    );
    return {
      apps: found.repos.map((repo) => ({
        owner: repo.owner,
        repo: repo.repo,
        description: repo.description.slice(0, 400),
        stars: Math.max(0, Math.floor(repo.stars)),
        ...(repo.updatedAt && { updatedAt: repo.updatedAt }),
        url: repo.url,
        installed: have.has(`${repo.owner}/${repo.repo}`.toLowerCase()),
      })),
      limited: found.limited,
      offline: found.offline,
    };
  }

  /** Your apps whose name, tagline or description has these words. */
  /**
   * Apps you have but switched off, for the map of what Conch can turn on
   * (ADR 0060 §1): the assistant may offer one back when it would help.
   * Their words may be someone else's, so each is one plain line.
   */
  async offerable(): Promise<
    { id: string; name: string; tagline: string; description: string; featured: false }[]
  > {
    const [cards, apps] = await Promise.all([this.hosted.list(), this.list()]);
    return cards
      .filter((card) => card.enabled === false && card.conchApp)
      .flatMap((card) => {
        const app = apps.find((a) => a.id === card.conchApp);
        if (!app) return [];
        const tagline = plainLine(app.manifest.tagline, 80);
        return [
          {
            id: card.id,
            name: plainLine(app.manifest.name, 40),
            tagline,
            description: plainLine(app.manifest.description || tagline, 300),
            featured: false as const,
          },
        ];
      });
  }

  async findMine(query: string): Promise<AppRecord[]> {
    await this.load();
    const words = query
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2);
    return this.store.peek().filter((app) => {
      const text =
        `${app.manifest.name} ${app.manifest.tagline} ${app.manifest.description}`.toLowerCase();
      return !words.length || words.some((w) => text.includes(w));
    });
  }

  // ── Pages ───────────────────────────────────────────────────────────────

  /** Where a page's app is: one you have, or a draft. */
  async #pageSource(ref: { appId: string } | { draftId: string }) {
    if ('appId' in ref) {
      const app = await this.#record(ref.appId);
      if (!(await this.#heal(app)))
        throw new ConchAppError(
          'unavailable',
          this.#failures.get(app.id) ?? 'Its files are missing.',
        );
      return { manifest: app.manifest, dir: this.store.current(app.id) };
    }
    await this.workshop.info(ref.draftId).catch(() => {
      throw new ConchAppError('not-found', 'That draft isn’t there any more.');
    });
    const manifest = await this.#manifestOf(ref.draftId);
    if (!manifest)
      throw new ConchAppError(
        'invalid',
        'The draft doesn’t read as an app yet, so its pages can’t open.',
      );
    return { manifest, dir: this.workshop.filesDir(ref.draftId) };
  }

  /** A page's HTML, as the app has it. */
  async page(
    ref: { appId: string } | { draftId: string },
    pageId: string,
  ): Promise<{ title: string; content: string }> {
    const { manifest, dir } = await this.#pageSource(ref);
    const page = manifest.pages.find((p) => p.id === pageId);
    if (!page)
      throw new ConchAppError('not-found', `${manifest.name} has no page called “${pageId}”.`);
    const content = await readFile(pathIn(dir, page.file), 'utf8').catch(() => {
      throw new ConchAppError(
        'not-found',
        `${manifest.name}’s page “${page.title}” is missing its file.`,
      );
    });
    return { title: page.title, content };
  }

  /** A page as its sealed frame serves it: the page kit, the accent, and `conch.call`. */
  async pageDocument(
    ref: { appId: string } | { draftId: string },
    pageId: string,
    options: { theme: 'light' | 'dark'; accent?: string; parentOrigin: string },
  ): Promise<{ document: string; content: string }> {
    const { title, content } = await this.page(ref, pageId);
    return {
      content,
      document: frameDocument(content, {
        title,
        theme: options.theme,
        parentOrigin: options.parentOrigin,
        kit: PAGE_KIT_CSS,
        ...(options.accent && { accent: options.accent }),
        calls: true,
      }),
    };
  }

  /**
   * A page calling a tool (`conch.call`). Only its own app's tools; a tool
   * that's off stays off; a change goes only with the person's press.
   */
  async callFromPage(
    ref: { appId: string } | { draftId: string },
    tool: string,
    input: Record<string, unknown>,
    confirmed: boolean,
  ): Promise<AppCallResult> {
    if ('appId' in ref) {
      const app = await this.#record(ref.appId);
      const known = app.tools.find((t) => t.name === tool);
      if (!known)
        return {
          ok: false,
          reason: 'error',
          message: `${app.manifest.name} has no tool called “${tool}”.`,
        };
      if (!app.enabled)
        return { ok: false, reason: 'off', message: `${app.manifest.name} is turned off in Apps.` };
      if (app.toolPolicies[tool] === 'off')
        return {
          ok: false,
          reason: 'off',
          message: `${known.title || tool} is turned off in Apps.`,
        };
      if (known.changes && !confirmed)
        return {
          ok: false,
          reason: 'confirm',
          message: `${app.manifest.name} wants to ${inSentence(known.title || tool)}.`,
        };
      if (this.#missing.get(app.id)?.length)
        return {
          ok: false,
          reason: 'missing-settings',
          message: `${app.manifest.name} needs its settings first. Open it in Apps to add them.`,
        };
      const outcome = await this.#call(app.id, tool, input);
      if (outcome.ok) void this.#used(app.id).catch(() => undefined);
      return outcome.ok
        ? {
            ok: true,
            text: outcome.text,
            ...(outcome.json !== undefined && { json: outcome.json }),
          }
        : { ok: false, reason: 'error', message: outcome.text };
    }
    const info = await this.workshop.info(ref.draftId).catch(() => {
      throw new ConchAppError('not-found', 'That draft isn’t there any more.');
    });
    const files = await this.workshop.files(ref.draftId);
    const read = await this.deps.parts.readFiles(files);
    if (!read.ok)
      return { ok: false, reason: 'error', message: 'The draft doesn’t read as an app yet.' };
    const runtime = this.#draftRuntime(ref.draftId, read.app);
    const known = (await runtime.list().catch(() => [])).find((t) => t.name === tool);
    if (!known)
      return {
        ok: false,
        reason: 'error',
        message: `${read.app.manifest.name} has no tool called “${tool}”.`,
      };
    // No person has seen a draft's websites yet: after its chat read something from
    // outside, anything that could send there waits for a yes (ADR 0028).
    const { reaches } = read.app.manifest;
    if (!confirmed && reaches.length) {
      const taints = (await this.deps.chats.taints?.(info.conversationId).catch(() => [])) ?? [];
      if (taints.length)
        return {
          ok: false,
          reason: 'confirm',
          message: `${describeTaint(taints)} ${read.app.manifest.name} would send to ${reaches.join(', ')}. Allow it?`,
        };
    }
    if (known.changes && !confirmed)
      return {
        ok: false,
        reason: 'confirm',
        message: `${read.app.manifest.name} wants to ${inSentence(known.title || tool)}.`,
      };
    await mkdir(this.workshop.dataDir(ref.draftId), { recursive: true, mode: 0o700 });
    const outcome = await runtime.call(tool, input).catch((error: unknown): AppCallOutcome => ({
      ok: false,
      text: error instanceof Error ? error.message : 'It failed.',
    }));
    return outcome.ok
      ? { ok: true, text: outcome.text, ...(outcome.json !== undefined && { json: outcome.json }) }
      : { ok: false, reason: 'error', message: outcome.text };
  }

  // ── Whole Conch ─────────────────────────────────────────────────────────

  /** Each app's skills, read-only, where Skills reads them (ADR 0061 §2). */
  skillRoots(): SkillRoot[] {
    return this.store.peek().map((app) => ({
      source: 'app',
      label: app.manifest.name,
      dir: join(this.store.current(app.id), 'skills'),
      depth: 1,
      // Made here: used by itself. Anyone else's: only when you ask for it.
      mode: madeHere(app.source) ? 'auto' : 'manual',
      idPrefix: `app_${app.id.replaceAll('-', '_')}`,
    }));
  }

  /** The keys your apps keep, for Passwords: names only until revealed. */
  async systemKeys(): Promise<{ appId: string; name: string; label: string; value: string }[]> {
    await this.load();
    const secrets = await this.store
      .allSecrets()
      .catch(() => ({}) as Record<string, Record<string, string>>);
    return this.store.peek().flatMap((app) =>
      app.manifest.settings.flatMap((setting) => {
        const value = setting.secret ? secrets[app.id]?.[setting.key] : undefined;
        return value
          ? [{ appId: app.id, name: app.manifest.name, label: setting.label, value }]
          : [];
      }),
    );
  }
}
