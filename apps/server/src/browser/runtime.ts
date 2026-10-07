import { rm } from 'node:fs/promises';
import { platform } from 'node:os';
import { join } from 'node:path';

import type {
  BrowserBackendKind,
  BrowserCandidate,
  BrowserPhase,
  BrowserProblem,
} from '@conch/protocol';
import { chromium, type BrowserContext, type Page } from 'playwright-core';

import { run } from '../lib/proc';
import { attach, BACKEND_NAMES, OWNED, type Attached, type Fetcher } from './backends';
import type { BrowserGuard } from './guard';
import { InstallError, installChromium, missingLibraries, type InstallProgress } from './install';
import { findBrowsers, pickBrowser } from './locate';
import type { BrowserSecrets, BrowserStore } from './store';

/**
 * The browser process: finding one, starting it, keeping it contained, and
 * fixing what goes wrong on its own (ADR 0014, "Zero setup, and it fixes
 * itself"). Everything above this sees a `BrowserContext` that just works, or
 * a plain-words problem with one thing to do.
 */

export const VIEWPORT = { width: 1280, height: 800 };

/** How many healed notes Settings shows. */
const HEALED_KEPT = 8;

const LAUNCH_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-blink-features=AutomationControlled',
  // WebRTC could otherwise reveal or reach local network addresses.
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--force-webrtc-ip-handling-policy',
  '--disable-features=Translate,MediaRouter,OptimizationHints',
];

export class BrowserProblemError extends Error {
  constructor(readonly problem: BrowserProblem) {
    super(problem.message);
  }
}

/** A launch failed because another browser process still holds the profile. */
function profileInUse(message: string): boolean {
  return /ProcessSingleton|profile (?:appears to be |is )?in use|existing browser session|SingletonLock/i.test(
    message,
  );
}

const quotePs = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * Browser processes running on Conch's profile: left behind by an earlier
 * Conch that crashed, or started by hand. Found by their command line, which
 * names the profile folder.
 */
async function orphans(profileDir: string): Promise<number[]> {
  if (platform() === 'win32') {
    const { stdout } = await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains(${quotePs(profileDir)}) -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { $_.ProcessId }`,
      ],
      { timeout: 20_000 },
    );
    return stdout
      .split(/\s+/)
      .map(Number)
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  }
  const { stdout } = await run('ps', ['-axo', 'pid=,command='], { timeout: 10_000 });
  const pids: number[] = [];
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match?.[1] && match[2]?.includes(`--user-data-dir=${profileDir}`))
      pids.push(Number(match[1]));
  }
  return pids.filter((pid) => pid !== process.pid);
}

/** Ends the processes holding Conch's profile. Returns how many there were. */
async function killOrphans(profileDir: string): Promise<number> {
  const pids = await orphans(profileDir).catch(() => []);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  if (pids.length) await new Promise((resolve) => setTimeout(resolve, 400));
  return pids.length;
}

async function clearLocks(profileDir: string): Promise<void> {
  await Promise.all(
    ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile'].map((name) =>
      rm(join(profileDir, name), { force: true }).catch(() => undefined),
    ),
  );
}

/** Where Playwright keeps (or would keep) the Chromium it downloads. */
function downloadedPath(): string | undefined {
  try {
    return chromium.executablePath();
  } catch {
    return undefined;
  }
}

export interface RuntimeDeps {
  store: BrowserStore;
  guard: BrowserGuard;
  /** Something about the runtime changed (phase, progress, healed…). */
  onChange: () => void;
  /** The browser went away (closed, crashed); tabs must be forgotten. */
  onClosed: () => void;
  /** The page shown instead of anything the guard blocks. */
  blockedPage: (message: string, url: string) => string;
  /** Where to look for browsers (tests hand in their own). */
  locate?: () => BrowserCandidate[];
  /** Keys and addresses for browsers elsewhere (ADR 0080). */
  secrets?: BrowserSecrets;
  /** Where Chrome keeps its profiles (tests hand in their own). */
  chromeDirs?: () => string[];
  fetch?: Fetcher;
}

/** What runs: Conch's own browser here, or one it attached to (ADR 0080). */
export interface RunningBackend {
  kind: BrowserBackendKind;
  name: string;
  /** The person's own browser: only Conch's pages are touched, and nothing is resized. */
  shared: boolean;
}

/**
 * A small badge on every page Conch drives in your own Chrome, so it's never
 * a secret which tabs are Conch's. Runs in the page (serialised, so it stays
 * self-contained); hidden from the accessibility tree, so the agent never
 * reads it, and it never takes a click.
 */
export function conchBadge(): void {
  interface El {
    id: string;
    textContent: string | null;
    style: Record<string, string>;
    setAttribute(name: string, value: string): void;
  }
  const doc = (
    globalThis as unknown as {
      document?: {
        documentElement: { appendChild(node: El): void } | null;
        getElementById(id: string): El | null;
        createElement(tag: string): El;
        readyState: string;
        addEventListener(event: string, run: () => void): void;
      };
    }
  ).document;
  if (!doc) return;
  const add = () => {
    if (!doc.documentElement || doc.getElementById('__conch_badge')) return;
    const el = doc.createElement('div');
    el.id = '__conch_badge';
    el.textContent = 'Conch is using this tab';
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'fixed',
      zIndex: '2147483647',
      right: '12px',
      bottom: '12px',
      padding: '6px 10px',
      borderRadius: '999px',
      font: '600 12px system-ui, sans-serif',
      color: '#fff',
      background: 'rgba(76, 58, 130, 0.94)',
      pointerEvents: 'none',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
    });
    doc.documentElement.appendChild(el);
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', add);
  else add();
}

export class BrowserRuntime {
  phase: BrowserPhase = 'off';
  problem?: BrowserProblem;
  install?: InstallProgress;
  running?: { name: string; id: string; version?: string };
  healed: { at: number; message: string }[] = [];
  /** Why the chosen browser isn't the one running: Conch's own carries on meanwhile. */
  fellBack?: string;
  backend: RunningBackend = { kind: 'local', name: BACKEND_NAMES.local, shared: false };
  #context?: BrowserContext;
  #attached?: Attached;
  #starting?: Promise<BrowserContext>;
  #stopping = false;

  constructor(private readonly deps: RuntimeDeps) {}

  candidates(): BrowserCandidate[] {
    return this.deps.locate?.() ?? findBrowsers({ downloaded: downloadedPath });
  }

  get alive(): boolean {
    return Boolean(this.#context);
  }

  /** Closing on purpose (idle, settings, shutting down), not crashing. */
  get stopping(): boolean {
    return this.#stopping;
  }

  /** Note something Conch fixed on its own. Shown as reassurance in Settings. */
  heal(message: string): void {
    this.healed = [{ at: Date.now(), message }, ...this.healed].slice(0, HEALED_KEPT);
    this.deps.onChange();
  }

  #set(phase: BrowserPhase, problem?: BrowserProblem): void {
    this.phase = phase;
    this.problem = problem;
    if (phase !== 'installing') this.install = undefined;
    this.deps.onChange();
  }

  /** The running browser, starting (or installing) it if needed. One start at a time. */
  context(): Promise<BrowserContext> {
    if (this.#context) return Promise.resolve(this.#context);
    this.#starting ??= this.#start().finally(() => {
      this.#starting = undefined;
    });
    return this.#starting;
  }

  async #start(): Promise<BrowserContext> {
    this.#set('starting');
    try {
      const settings = await this.deps.store.settings();
      if (settings.backend !== 'local' && this.deps.secrets) {
        const name = BACKEND_NAMES[settings.backend];
        try {
          const attached = await attach(settings.backend, {
            secrets: this.deps.secrets,
            fetch: this.deps.fetch,
            chromeDirs: this.deps.chromeDirs,
          });
          return this.#readyAttached(attached, settings.backend);
        } catch (error) {
          // Down, or not allowed yet: Conch's own browser carries on meanwhile.
          const why =
            error instanceof BrowserProblemError ? error.problem.message : `${name} didn’t answer.`;
          this.fellBack = `${why} Until then, Conch uses its own browser.`;
          this.heal(`Used Conch’s own browser. ${name} couldn’t be reached.`);
        }
      } else {
        this.fellBack = undefined;
      }
      let candidates = this.candidates();
      if (candidates.length === 0) {
        await this.#install();
        candidates = this.candidates();
      }
      const first = pickBrowser(candidates, settings.preferred);
      if (!first) {
        throw new BrowserProblemError({
          message: 'There’s no browser on this computer, and Conch couldn’t download one.',
          action: 'install',
        });
      }
      const order = [first, ...candidates.filter((c) => c !== first)];
      let lastError: unknown;
      for (const candidate of order) {
        try {
          const context = await this.#launchHealing(candidate);
          if (candidate !== first) {
            this.heal(`Switched to ${candidate.name}. ${first.name} wouldn’t start.`);
          }
          return this.#ready(context, candidate);
        } catch (error) {
          lastError = error;
          const libs = missingLibraries(String((error as Error).message));
          if (libs) {
            throw new BrowserProblemError({ message: libs.message, command: libs.command });
          }
        }
      }
      // Every installed browser refused. A fresh Chromium is the last resort.
      if (!order.some((c) => c.id === 'downloaded')) {
        await this.#install();
        const downloaded = this.candidates().find((c) => c.id === 'downloaded');
        if (downloaded) {
          const context = await this.#launchHealing(downloaded);
          this.heal('Downloaded Chromium. No installed browser would start.');
          return this.#ready(context, downloaded);
        }
      }
      throw lastError instanceof BrowserProblemError
        ? lastError
        : new BrowserProblemError({
            message: `The browser wouldn’t start: ${String((lastError as Error)?.message ?? lastError).split('\n')[0]}`,
            action: 'repair',
          });
    } catch (error) {
      const problem =
        error instanceof BrowserProblemError
          ? error.problem
          : error instanceof InstallError
            ? { message: error.message, command: error.command, action: 'install' as const }
            : { message: String((error as Error).message), action: 'repair' as const };
      this.#set('problem', problem);
      throw new BrowserProblemError(problem);
    }
  }

  async #readyAttached(attached: Attached, kind: BrowserBackendKind): Promise<BrowserContext> {
    const { context } = attached;
    // Your own Chrome is contained page by page (only Conch's pages); a browser
    // of Conch's own elsewhere, as a whole, like the one here.
    if (!attached.shared) await this.#contain(context);
    this.#context = context;
    this.#attached = attached;
    this.fellBack = undefined;
    this.backend = { kind, name: attached.name, shared: attached.shared };
    this.running = { name: attached.name, id: kind, version: context.browser()?.version() };
    const gone = () => {
      if (this.#context !== context) return;
      this.#context = undefined;
      this.#attached = undefined;
      this.running = undefined;
      const expected = this.#stopping;
      this.#set('off');
      this.deps.onClosed();
      if (!expected) this.heal(`Let go of ${attached.name}. It reconnects when needed.`);
    };
    context.on('close', gone);
    context.browser()?.on('disconnected', gone);
    this.#set('running');
    return context;
  }

  /**
   * A new page for a chat. In your own Chrome it's marked as Conch's (only
   * those are ever touched), wears a badge, and goes past the guard on its own.
   */
  async newPage(context: BrowserContext): Promise<Page> {
    const page = await context.newPage();
    await this.adopt(page);
    return page;
  }

  /**
   * A page that's Conch's in a browser it attached to: a new tab, or one a page
   * of Conch's opened. Closed when Conch lets go; in your own Chrome, also
   * contained and marked.
   */
  async adopt(page: Page): Promise<void> {
    if (!this.#attached || OWNED.has(page)) return;
    OWNED.add(page);
    if (!this.backend.shared) return;
    await this.#contain(page);
    await page.addInitScript(conchBadge).catch(() => undefined);
    await page.evaluate(conchBadge).catch(() => undefined);
  }

  #ready(context: BrowserContext, candidate: BrowserCandidate): BrowserContext {
    this.backend = { kind: 'local', name: BACKEND_NAMES.local, shared: false };
    this.#attached = undefined;
    this.#context = context;
    this.running = {
      name: candidate.name,
      id: candidate.id,
      version: context.browser()?.version(),
    };
    context.on('close', () => {
      if (this.#context !== context) return;
      this.#context = undefined;
      this.running = undefined;
      const expected = this.#stopping;
      this.#set('off');
      this.deps.onClosed();
      if (!expected) this.heal('The browser closed. It starts again when needed.');
    });
    this.#set('running');
    return context;
  }

  async #install(): Promise<void> {
    this.#set('installing');
    this.install = { percent: 0, label: 'Getting a browser ready…' };
    this.deps.onChange();
    await installChromium((progress) => {
      this.install = progress;
      this.deps.onChange();
    });
    this.heal('Downloaded a browser. There wasn’t one on this computer.');
    this.#set('starting');
  }

  async #launchHealing(candidate: BrowserCandidate): Promise<BrowserContext> {
    try {
      return await this.#launch(candidate);
    } catch (error) {
      // A browser still holding the profile makes a new one hand over and quit
      // (Windows: "browser has been closed"), or refuse (ProcessSingleton).
      // Don't guess from the message: look for the process itself.
      const killed = await killOrphans(this.deps.store.profileDir);
      if (!killed && !profileInUse(String((error as Error).message))) throw error;
      await clearLocks(this.deps.store.profileDir);
      const context = await this.#launch(candidate);
      this.heal('Closed a leftover browser');
      return context;
    }
  }

  async #launch(candidate: BrowserCandidate): Promise<BrowserContext> {
    const userAgent = await this.deps.store.userAgent(candidate.path);
    const context = await chromium.launchPersistentContext(this.deps.store.profileDir, {
      executablePath: candidate.path,
      headless: true,
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      serviceWorkers: 'block',
      acceptDownloads: true,
      userAgent,
      ignoreDefaultArgs: ['--enable-automation'],
      args: LAUNCH_ARGS,
      timeout: 30_000,
    });
    if (!userAgent) {
      // Learn what this browser says with a window, once; headless says "HeadlessChrome".
      const page = context.pages()[0] ?? (await context.newPage());
      const raw = String(await page.evaluate('navigator.userAgent').catch(() => ''));
      const real = raw.replace(/HeadlessChrome\//, 'Chrome/');
      if (real && real !== raw) {
        await this.deps.store.rememberUserAgent(candidate.path, real);
        await context.close();
        return this.#launch(candidate);
      }
    }
    await this.#contain(context);
    return context;
  }

  /** Every request and WebSocket goes past the guard (ADR 0014, "Containment"). */
  async #contain(target: BrowserContext | Page): Promise<void> {
    // A page routes just as a context does (your own Chrome: only Conch's pages).
    const context = target as BrowserContext;
    await context.route('**/*', async (route) => {
      const request = route.request();
      try {
        const verdict = await this.deps.guard.request(request.url());
        if (verdict.ok) return await route.continue();
        const frame = request.frame();
        const mainFrame = request.isNavigationRequest() && frame === frame.page().mainFrame();
        if (mainFrame) {
          return await route.fulfill({
            status: 403,
            contentType: 'text/html; charset=utf-8',
            body: this.deps.blockedPage(verdict.message, request.url()),
          });
        }
        return await route.abort('blockedbyclient');
      } catch {
        // The page went away mid-request.
      }
    });
    await context.routeWebSocket(
      () => true,
      async (ws) => {
        const verdict = await this.deps.guard
          .request(ws.url())
          .catch(() => ({ ok: false }) as const);
        if (verdict.ok) ws.connectToServer();
        else await ws.close({ code: 1008, reason: 'Blocked by Conch' });
      },
    );
  }

  /** Close the browser (idle, settings changed, shutting down). It starts again on demand. */
  async stop(): Promise<void> {
    const context = this.#context;
    if (!context) return;
    this.#stopping = true;
    try {
      // A browser Conch attached to is let go of, never closed.
      if (this.#attached) await this.#attached.release();
      else await context.close();
    } catch {
      // Already gone.
    } finally {
      this.#stopping = false;
    }
  }

  /** Try every fix: close, clear stale locks and leftover processes, start fresh. */
  async repair(): Promise<void> {
    this.#set('repairing');
    await this.stop();
    await killOrphans(this.deps.store.profileDir).catch(() => undefined);
    await clearLocks(this.deps.store.profileDir);
    this.deps.guard.reset();
    this.problem = undefined;
    try {
      await this.context();
      this.heal('Repaired the browser');
    } catch {
      // `problem` says what's left.
    }
  }

  /** Sign out of everything: close the browser and delete its profile. */
  async wipe(): Promise<void> {
    await this.stop();
    await killOrphans(this.deps.store.profileDir).catch(() => undefined);
    await rm(this.deps.store.profileDir, { recursive: true, force: true, maxRetries: 5 });
    this.heal('Signed out of every site. The browser starts fresh next time.');
  }
}
