import { totalmem } from 'node:os';
import { join } from 'node:path';

import type { BrowserSession } from '@conch/protocol';
import type { BrowserContext } from 'playwright-core';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';
import { BrowserProblemError, type StorageState } from './runtime';
import { siteOf } from './site';

/**
 * A browser per errand (ADR 0141). Every task, every helper, and a chat the
 * person gives one, gets a browser context of its own: cookies, storage and
 * tabs that no other chat or task shares, so errands running side by side
 * never fill each other's carts or sign each other out.
 *
 * Sign-ins are lent, never shared: a new errand starts with a copy of the
 * main browser's cookies and storage for exactly the sites the person always
 * allows (Settings › Browser), and later for a site the person allows in that
 * errand, by pressing Allow on its question. Never the whole jar, never from
 * the person's own Chrome, never back from the errand to the main browser.
 *
 * While it runs, what it holds is kept in memory and, sealed with this
 * computer's key (ADR 0025), in `browser.errands.secrets.json`, so a task
 * that's interrupted (Conch restarted, a crash, the cap made room) resumes in
 * the same session. A task that ends takes its session with it.
 */

const GiB = 1024 ** 3;

/** Errands with a browser open at once: about one per 2 GB, from 2 to 6. */
export function errandLimit(memory = totalmem()): number {
  return Math.max(2, Math.min(6, Math.floor(memory / (2 * GiB))));
}

/** Sessions kept for errands that aren't open now; the oldest go first. */
const KEPT = 40;
/** A session kept this long without being used is let go (its cookies are copies of sign-ins). */
const KEPT_MS = 14 * 24 * 60 * 60_000;
/** Snapshots after a page loads come at most this often. */
const SNAPSHOT_MS = 3_000;
/** A session bigger than this keeps its cookies only. */
const STATE_BYTES = 4 * 1024 * 1024;

const Cookie = z.object({
  name: z.string().max(4096),
  value: z.string().max(16_384),
  domain: z.string().max(253),
  path: z.string().max(4096),
  expires: z.number(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(['Strict', 'Lax', 'None']),
});
const Origin = z.object({
  origin: z.string().max(2048),
  localStorage: z.array(z.object({ name: z.string(), value: z.string() })).max(2000),
});
const State = z.object({
  cookies: z.array(Cookie).max(5000),
  origins: z.array(Origin).max(500),
});

const Errand = z.object({
  reason: z.enum(['task', 'asked']),
  /** Last used. */
  at: z.number(),
  /** Sites whose sign-in was lent to it. */
  shared: z.array(z.string().max(253)).max(100).default([]),
  /** What it held when it was last set aside or snapshotted. Never the agent's to read. */
  state: State.optional(),
});
type Errand = z.infer<typeof Errand>;

const ErrandsFile = z.object({
  version: z.literal(1).default(1),
  errands: z.record(z.string(), Errand).default({}),
});
type ErrandsFile = z.infer<typeof ErrandsFile>;

/** The sealed file's name: listed in `SEALED_FILES`, the backup manifest and `protect.ts`. */
export const ERRANDS_FILE = 'browser.errands.secrets.json';

/** A cookie's site: its domain, as the registrable domain a permission is for. */
function cookieSite(domain: string): string | undefined {
  const host = domain.replace(/^\./, '');
  return host ? siteOf(`https://${host.includes(':') ? `[${host}]` : host}/`) : undefined;
}

/**
 * Only the given sites' part of a storage state: their cookies (a cookie for
 * `.shop.example` belongs to `shop.example`), and the local storage of their
 * origins. Everything else stays where it was.
 */
export function loginsFor(state: StorageState, sites: Iterable<string>): StorageState {
  const allowed = new Set(sites);
  if (!allowed.size) return { cookies: [], origins: [] };
  const cookies = state.cookies.filter((c) => {
    const site = cookieSite(c.domain);
    return site !== undefined && allowed.has(site);
  });
  const origins = state.origins
    .filter((o) => {
      const site = siteOf(o.origin);
      return site !== undefined && allowed.has(site);
    })
    .map((o) => ({ origin: o.origin, localStorage: o.localStorage }));
  return { cookies, origins };
}

/** A state as it's kept: checked, and without anything Playwright may add beyond cookies and storage. */
function keepable(state: StorageState): z.infer<typeof State> | undefined {
  const parsed = State.safeParse({
    cookies: state.cookies,
    origins: state.origins.map((o) => ({ origin: o.origin, localStorage: o.localStorage })),
  });
  if (!parsed.success) {
    const cookies = State.shape.cookies.safeParse(state.cookies);
    return cookies.success ? { cookies: cookies.data, origins: [] } : undefined;
  }
  if (JSON.stringify(parsed.data).length > STATE_BYTES)
    return { cookies: parsed.data.cookies, origins: [] };
  return parsed.data;
}

/** The store under it: one sealed file for every errand's session. */
class ErrandStore {
  #mutex = new Mutex();
  #cache?: Promise<ErrandsFile>;
  #timer?: NodeJS.Timeout;

  constructor(
    private readonly home: string,
    private readonly heal?: Heal,
  ) {}

  get path(): string {
    return join(this.home, ERRANDS_FILE);
  }

  read(): Promise<ErrandsFile> {
    this.#cache ??= readStore(this.path, ErrandsFile, {
      onRepair: () => this.heal?.('browser', 'Started tasks’ browsers afresh. A copy is kept.'),
    }).then(
      (read) => read.value,
      // The key can't be had for a moment: start empty, and read again next time.
      () => {
        this.#cache = undefined;
        return ErrandsFile.parse({});
      },
    );
    return this.#cache;
  }

  /** Change it now (in memory), and write it soon. */
  async update(fn: (data: ErrandsFile) => void): Promise<void> {
    await this.#mutex.run(async () => {
      const data = await this.read();
      fn(data);
      this.#prune(data);
    });
    this.#schedule();
  }

  #prune(data: ErrandsFile): void {
    const now = Date.now();
    const entries = Object.entries(data.errands).sort(([, a], [, b]) => b.at - a.at);
    data.errands = Object.fromEntries(
      entries.flatMap(([id, e], i) => {
        if (i < KEPT && now - e.at < KEPT_MS) return [[id, e]];
        // Too old, or too many: the session goes. A chat keeps the person's choice.
        return e.reason === 'asked' ? [[id, { reason: e.reason, at: e.at, shared: [] }]] : [];
      }),
    );
  }

  #schedule(): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => void this.flush(), 300);
    this.#timer.unref();
  }

  async flush(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (!this.#cache) return;
    await this.#mutex.run(async () => writeJson(this.path, await this.read()));
  }

  async clear(): Promise<void> {
    await this.update((data) => {
      data.errands = {};
    });
    await this.flush();
  }
}

export interface ErrandsDeps {
  home: string;
  heal?: Heal;
  /**
   * A new context, seeded with `state` and contained (`BrowserRuntime.errandContext`).
   * `remote`: it's in a browser elsewhere.
   */
  open: (state?: StorageState) => Promise<{ context: BrowserContext; remote: boolean }>;
  /**
   * The main browser's cookies and storage, to lend from; undefined when there's
   * nothing to lend from (your own Chrome: Conch never copies its sign-ins).
   */
  main: () => Promise<StorageState | undefined>;
  /** The sites the person always allows (Settings › Browser): lent to every new errand. */
  trusted: () => Promise<string[]>;
  /** Someone is using this errand's browser now (driving, watching, a step): it isn't set aside for room. */
  busy: (conversationId: string) => boolean;
  /** Its context went away: forget its tab. `crashed`: not on purpose, so it may open again by itself. */
  closed: (conversationId: string, crashed: boolean) => void;
  /** How many may be open at once (tests); `errandLimit()` otherwise. */
  max?: number;
}

interface Live {
  context: BrowserContext;
  lastUsed: number;
  remote: boolean;
  timer?: NodeJS.Timeout;
}

export class Errands {
  readonly store: ErrandStore;
  readonly max: number;
  /** Which conversations have their own, known before the file is read (a task's turn says so). */
  #reasons = new Map<string, Errand['reason']>();
  #live = new Map<string, Live>();
  #opening = new Map<string, Promise<BrowserContext>>();
  /** Closed on purpose (ended, set aside): not a crash. */
  #closing = new Set<BrowserContext>();
  /** Went away by itself: said once it's open again. */
  #crashed = new Set<string>();
  /** One decision about room at a time. */
  #room = new Mutex();

  constructor(private readonly deps: ErrandsDeps) {
    this.store = new ErrandStore(deps.home, deps.heal);
    this.max = deps.max ?? errandLimit();
  }

  /** This conversation gets a browser of its own: a task's always, a chat's when the person asks. */
  async mark(conversationId: string, reason: Errand['reason']): Promise<void> {
    // A task stays a task: a chat's choice never takes its own away.
    if (this.#reasons.get(conversationId) === 'task') return;
    this.#reasons.set(conversationId, reason);
    await this.store.update((data) => {
      const before = data.errands[conversationId];
      if (before?.reason === 'task') return;
      data.errands[conversationId] = { shared: [], ...before, reason, at: Date.now() };
    });
  }

  /** Why this conversation has its own, if it does. */
  async reason(conversationId: string): Promise<Errand['reason'] | undefined> {
    const known = this.#reasons.get(conversationId);
    if (known) return known;
    const saved = (await this.store.read()).errands[conversationId]?.reason;
    if (saved) this.#reasons.set(conversationId, saved);
    return saved;
  }

  /** Its browser is open now. */
  live(conversationId: string): boolean {
    return this.#live.has(conversationId);
  }

  get open(): number {
    return this.#live.size;
  }

  /** One is open in a browser elsewhere (a context of the main one's): that browser stays while it is. */
  get remote(): boolean {
    return [...this.#live.values()].some((l) => l.remote);
  }

  /** What the panel says about it: its own, and the sites it's signed in to with your sign-in. */
  async info(conversationId: string): Promise<BrowserSession | undefined> {
    const reason = await this.reason(conversationId);
    if (!reason) return undefined;
    const shared = (await this.store.read()).errands[conversationId]?.shared ?? [];
    return { own: true, reason, signedIn: [...shared] };
  }

  /**
   * The errand's context, opening it if needed: as it was (an interrupted
   * task, a crash), or new, with the sign-ins of the sites the person always
   * allows. When as many are open as this computer keeps, the one used least
   * recently that nobody is using is set aside for it (it comes back as it
   * was); when all are in use, it says so in words a model can act on.
   */
  async context(conversationId: string): Promise<BrowserContext> {
    const live = this.#live.get(conversationId);
    if (live) {
      live.lastUsed = Date.now();
      return live.context;
    }
    let opening = this.#opening.get(conversationId);
    if (!opening) {
      opening = this.#open(conversationId).finally(() => this.#opening.delete(conversationId));
      this.#opening.set(conversationId, opening);
    }
    return opening;
  }

  async #open(conversationId: string): Promise<BrowserContext> {
    await this.#room.run(async () => {
      if (this.#live.size + this.#opening.size - 1 < this.max) return;
      const idle = [...this.#live.entries()]
        .filter(([id]) => !this.deps.busy(id))
        .sort(([, a], [, b]) => a.lastUsed - b.lastUsed)[0];
      if (!idle)
        throw new BrowserProblemError({
          message: `${this.max} tasks are using a browser of their own at once, as many as this computer keeps. Wait a minute (one finishes, or stops using it) and try again.`,
          action: 'retry',
        });
      await this.park(idle[0]);
    });
    const saved = (await this.store.read()).errands[conversationId];
    let state = saved?.state;
    let shared = saved?.shared ?? [];
    if (!state) {
      // New: only the sites the person always allows, from the main browser.
      const trusted = await this.deps.trusted().catch(() => []);
      const main = trusted.length ? await this.deps.main().catch(() => undefined) : undefined;
      if (main) {
        state = loginsFor(main, trusted);
        shared = [...new Set(state.cookies.map((c) => cookieSite(c.domain)).filter(Boolean))]
          .filter((s): s is string => typeof s === 'string')
          .sort();
      }
    }
    const { context, remote } = await this.deps.open(state);
    const entry: Live = { context, lastUsed: Date.now(), remote };
    this.#live.set(conversationId, entry);
    context.on('close', () => {
      if (this.#live.get(conversationId) !== entry) return;
      clearTimeout(entry.timer);
      this.#live.delete(conversationId);
      const crashed = !this.#closing.delete(context);
      if (crashed) this.#crashed.add(conversationId);
      this.deps.closed(conversationId, crashed);
    });
    const reason = (await this.reason(conversationId)) ?? 'task';
    await this.store.update((data) => {
      data.errands[conversationId] = {
        ...data.errands[conversationId],
        reason,
        at: Date.now(),
        shared,
        ...(state && { state: keepable(state) }),
      };
    });
    if (this.#crashed.delete(conversationId))
      this.deps.heal?.('browser', 'Reopened a task’s browser as it was');
    return context;
  }

  /** A page loaded: keep what it holds now, soon (so a crash or a restart comes back to it). */
  changed(conversationId: string): void {
    const live = this.#live.get(conversationId);
    if (!live || live.timer) return;
    live.lastUsed = Date.now();
    live.timer = setTimeout(() => {
      live.timer = undefined;
      void this.#snapshot(conversationId);
    }, SNAPSHOT_MS);
    live.timer.unref();
  }

  async #snapshot(conversationId: string): Promise<void> {
    const live = this.#live.get(conversationId);
    if (!live) return;
    const state = await live.context.storageState().catch(() => undefined);
    if (!state || this.#live.get(conversationId) !== live) return;
    const kept = keepable(state);
    await this.store.update((data) => {
      const before = data.errands[conversationId];
      if (!before) return;
      data.errands[conversationId] = { ...before, at: Date.now(), ...(kept && { state: kept }) };
    });
  }

  /**
   * Lend one site's sign-in to an open errand: the person allowed it there
   * (ADR 0141). Its cookies, from the main browser; nothing when there's
   * nothing to lend from. Returns whether anything was lent.
   */
  async share(conversationId: string, site: string): Promise<boolean> {
    const live = this.#live.get(conversationId);
    if (!live) return false;
    const saved = (await this.store.read()).errands[conversationId];
    if (saved?.shared.includes(site)) return false;
    const main = await this.deps.main().catch(() => undefined);
    if (!main) return false;
    const { cookies } = loginsFor(main, [site]);
    if (!cookies.length) return false;
    await live.context.addCookies(cookies);
    await this.store.update((data) => {
      const before = data.errands[conversationId];
      if (!before) return;
      before.shared = [...new Set([...before.shared, site])].sort();
    });
    void this.#snapshot(conversationId);
    return true;
  }

  /**
   * The person stopped always allowing a site: errands that were lent its
   * sign-in give it back (its cookies go), open or set aside.
   */
  async revoke(site: string): Promise<void> {
    const data = await this.store.read();
    for (const [id, errand] of Object.entries(data.errands)) {
      if (!errand.shared.includes(site)) continue;
      const live = this.#live.get(id);
      if (live) {
        const cookies = (await live.context.cookies().catch(() => [])).filter(
          (c) => cookieSite(c.domain) === site,
        );
        for (const c of cookies)
          await live.context
            .clearCookies({ name: c.name, domain: c.domain, path: c.path })
            .catch(() => undefined);
      }
    }
    await this.store.update((d) => {
      for (const errand of Object.values(d.errands)) {
        if (!errand.shared.includes(site)) continue;
        errand.shared = errand.shared.filter((s) => s !== site);
        if (errand.state)
          errand.state = {
            ...errand.state,
            cookies: errand.state.cookies.filter((c) => cookieSite(c.domain) !== site),
          };
      }
    });
  }

  async #close(conversationId: string): Promise<void> {
    const live = this.#live.get(conversationId);
    if (!live) return;
    clearTimeout(live.timer);
    this.#closing.add(live.context);
    // Its tab goes first, so its pages closing aren't taken for tabs closed.
    this.#live.delete(conversationId);
    this.deps.closed(conversationId, false);
    await live.context.close().catch(() => undefined);
    this.#closing.delete(live.context);
  }

  /**
   * Set it aside: keep what it holds (sealed) and close it. It opens again as
   * it was: an interrupted task's Resume, or when there's room again.
   */
  async park(conversationId: string): Promise<void> {
    if (!this.#live.has(conversationId)) return;
    await this.#snapshot(conversationId);
    await this.#close(conversationId);
  }

  /** It's done (finished, stopped, deleted, or back to the main browser): close it and forget it. */
  async end(conversationId: string): Promise<void> {
    await this.#close(conversationId);
    this.#reasons.delete(conversationId);
    await this.store.update((data) => {
      data.errands = Object.fromEntries(
        Object.entries(data.errands).filter(([id]) => id !== conversationId),
      );
    });
  }

  /** Shutting down or repairing: every open one is set aside, to come back as it was. */
  async parkAll(): Promise<void> {
    await Promise.all([...this.#live.keys()].map((id) => this.park(id)));
    await this.store.flush();
  }

  /** Signed out of everything: every errand's session goes too. */
  async wipe(): Promise<void> {
    await Promise.all([...this.#live.keys()].map((id) => this.#close(id)));
    this.#reasons.clear();
    await this.store.clear();
  }

  /** Set aside the ones nobody has used for `idleMs` (the browser's idle rule). */
  async sweep(idleMs: number): Promise<void> {
    const now = Date.now();
    for (const [id, live] of [...this.#live.entries()])
      if (now - live.lastUsed > idleMs && !this.deps.busy(id)) await this.park(id);
  }
}
