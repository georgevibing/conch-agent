import { rm } from 'node:fs/promises';
import { platform } from 'node:os';
import { join } from 'node:path';

import type { BrowserCandidate, BrowserPhase, BrowserProblem } from '@conch/protocol';
import { chromium, type BrowserContext } from 'playwright-core';

import { run } from '../lib/proc';
import type { BrowserGuard } from './guard';
import { InstallError, installChromium, missingLibraries, type InstallProgress } from './install';
import { findBrowsers, pickBrowser } from './locate';
import type { BrowserStore } from './store';

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
}

export class BrowserRuntime {
  phase: BrowserPhase = 'off';
  problem?: BrowserProblem;
  install?: InstallProgress;
  running?: { name: string; id: string; version?: string };
  healed: { at: number; message: string }[] = [];
  #context?: BrowserContext;
  #starting?: Promise<BrowserContext>;
  #stopping = false;

  constructor(private readonly deps: RuntimeDeps) {}

  candidates(): BrowserCandidate[] {
    return this.deps.locate?.() ?? findBrowsers({ downloaded: downloadedPath });
  }

  get alive(): boolean {
    return Boolean(this.#context);
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
            this.heal(`${first.name} wouldn’t start, so Conch is using ${candidate.name}.`);
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
          this.heal('None of the installed browsers would start, so Conch downloaded Chromium.');
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

  #ready(context: BrowserContext, candidate: BrowserCandidate): BrowserContext {
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
      if (!expected) this.heal('The browser closed unexpectedly; it’ll start again when needed.');
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
    this.heal('There was no browser on this computer, so Conch downloaded Chromium.');
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
      this.heal(
        'A browser left over from an earlier session was holding things up; Conch closed it.',
      );
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
  async #contain(context: BrowserContext): Promise<void> {
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
      await context.close();
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
      this.heal('Repaired: the browser starts cleanly again.');
    } catch {
      // `problem` says what's left.
    }
  }

  /** Sign out of everything: close the browser and delete its profile. */
  async wipe(): Promise<void> {
    await this.stop();
    await killOrphans(this.deps.store.profileDir).catch(() => undefined);
    await rm(this.deps.store.profileDir, { recursive: true, force: true, maxRetries: 5 });
    this.heal('Signed out of every site: the browser starts fresh next time.');
  }
}
