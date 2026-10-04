import { readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

import type { BrowserBackendKind } from '@conch/protocol';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';

import { BrowserProblemError } from './runtime';
import type { BrowserSecrets } from './store';

/**
 * Where the browser runs, other than Conch's own (ADR 0080): the person's own
 * Chrome, a browser in the cloud, or any browser at a DevTools address. Each
 * is reached the same way (the DevTools protocol), so everything above this
 * sees a `BrowserContext` like the local one, plus two facts that change how
 * it's handled: whether the browser is shared with the person, and whether
 * its window may be resized.
 */

export interface Attached {
  context: BrowserContext;
  /** Said in the panel and the settings: "Your Chrome", "Browserbase". */
  name: string;
  /**
   * The person's own browser: Conch touches only the tabs it opened, keeps
   * them in its own window, contains each of its pages rather than the whole
   * browser, never resizes anything, and never closes the browser.
   */
  shared: boolean;
  /** Let go: close Conch's own pages and disconnect (a cloud session ends with it). */
  release(): Promise<void>;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface AttachDeps {
  secrets: BrowserSecrets;
  fetch?: Fetcher;
  /** Where Chrome keeps its profiles (tests hand in their own). */
  chromeDirs?: () => string[];
  /** How long Chrome's own "Allow remote debugging?" may wait for the person. */
  consentMs?: number;
}

export const BACKEND_NAMES: Record<BrowserBackendKind, string> = {
  local: 'Conch’s browser',
  chrome: 'Your Chrome',
  browserbase: 'Browserbase',
  steel: 'Steel',
  cdp: 'Your browser address',
};

/** Chrome's profile folders on this computer, stable first. */
export function chromeUserDataDirs(): string[] {
  const home = homedir();
  const os = platform();
  if (os === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    return ['Chrome', 'Chrome Beta', 'Chrome Dev', 'Chrome SxS'].map((n) =>
      join(local, 'Google', n, 'User Data'),
    );
  }
  if (os === 'darwin') {
    const support = join(home, 'Library', 'Application Support', 'Google');
    return ['Chrome', 'Chrome Beta', 'Chrome Dev', 'Chrome Canary'].map((n) => join(support, n));
  }
  const config = process.env.XDG_CONFIG_HOME ?? join(home, '.config');
  return ['google-chrome', 'google-chrome-beta', 'google-chrome-unstable'].map((n) =>
    join(config, n),
  );
}

/**
 * Where a Chrome that allows remote debugging listens: it writes the port and
 * the browser's path into `DevToolsActivePort` in its profile folder. Only
 * ever this computer's loopback, whatever the file says.
 */
export async function chromeAddress(dirs: readonly string[]): Promise<string | undefined> {
  for (const dir of dirs) {
    const text = await readFile(join(dir, 'DevToolsActivePort'), 'utf8').catch(() => undefined);
    if (!text) continue;
    const [portLine, pathLine] = text.split(/\r?\n/);
    const port = Number(portLine?.trim());
    const path = pathLine?.trim() ?? '';
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) continue;
    if (!/^\/devtools\/browser\/[A-Za-z0-9-]{1,80}$/.test(path)) continue;
    if (!(await listening(port))) continue;
    return `ws://127.0.0.1:${port}${path}`;
  }
  return undefined;
}

/** Something answers on this loopback port. */
function listening(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** A DevTools address the person typed: ws(s) or http(s), and nothing that hides a password in it. */
export function checkAddress(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BrowserProblemError({
      message: 'That isn’t a browser address. It starts with ws://, wss://, http:// or https://.',
      action: 'settings',
    });
  }
  if (!['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol))
    throw new BrowserProblemError({
      message: 'That isn’t a browser address. It starts with ws://, wss://, http:// or https://.',
      action: 'settings',
    });
  return url.toString();
}

/** The host of a saved address, for the settings page (never its token). */
export function addressHost(address: string | undefined): string | undefined {
  if (!address) return undefined;
  try {
    return new URL(address).host;
  } catch {
    return undefined;
  }
}

async function over(address: string, timeout: number): Promise<Browser> {
  return chromium.connectOverCDP(address, { timeout });
}

function contextOf(browser: Browser): Promise<BrowserContext> {
  const existing = browser.contexts()[0];
  return existing ? Promise.resolve(existing) : browser.newContext();
}

/** Browserbase: a session made with the key, then its own DevTools address. */
async function browserbase(deps: AttachDeps): Promise<string> {
  const saved = (await deps.secrets.read()).browserbase;
  if (!saved?.key)
    throw new BrowserProblemError({
      message: 'Browserbase needs its API key: add it in Settings › Browser.',
      action: 'settings',
    });
  const res = await (deps.fetch ?? fetch)('https://api.browserbase.com/v1/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bb-api-key': saved.key },
    body: JSON.stringify(saved.project ? { projectId: saved.project } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403)
    throw new BrowserProblemError({
      message: 'Browserbase didn’t accept the API key. Check it in Settings › Browser.',
      action: 'settings',
    });
  if (res.status === 402 || res.status === 429)
    throw new BrowserProblemError({
      message: 'Browserbase says this account is out of browser time for now.',
      action: 'retry',
    });
  if (!res.ok)
    throw new BrowserProblemError({
      message: `Browserbase didn’t start a browser (it said ${res.status}).`,
      action: 'retry',
    });
  const body = (await res.json().catch(() => ({}))) as { connectUrl?: unknown };
  if (typeof body.connectUrl !== 'string' || !/^wss?:\/\//.test(body.connectUrl))
    throw new BrowserProblemError({
      message: 'Browserbase answered without a browser to connect to.',
      action: 'retry',
    });
  return body.connectUrl;
}

/** Steel: its DevTools address with the key; a session starts on connecting. */
async function steel(deps: AttachDeps): Promise<string> {
  const saved = (await deps.secrets.read()).steel;
  if (!saved?.key)
    throw new BrowserProblemError({
      message: 'Steel needs its API key: add it in Settings › Browser.',
      action: 'settings',
    });
  return `wss://connect.steel.dev?apiKey=${encodeURIComponent(saved.key)}`;
}

/** Connect to the chosen browser. Throws a plain-words problem when it can't. */
export async function attach(kind: BrowserBackendKind, deps: AttachDeps): Promise<Attached> {
  if (kind === 'local') throw new Error('The local browser is launched, not attached.');
  const name = BACKEND_NAMES[kind];
  let address: string;
  let timeout = 30_000;
  if (kind === 'chrome') {
    const found = await chromeAddress(deps.chromeDirs?.() ?? chromeUserDataDirs());
    if (!found)
      throw new BrowserProblemError({
        message:
          'Your Chrome isn’t open with remote debugging allowed. Open chrome://inspect/#remote-debugging in Chrome and turn it on.',
        action: 'settings',
      });
    address = found;
    // Chrome asks the person to allow it: give them time to press Allow.
    timeout = deps.consentMs ?? 90_000;
  } else if (kind === 'browserbase') {
    address = await browserbase(deps);
  } else if (kind === 'steel') {
    address = await steel(deps);
  } else {
    const saved = (await deps.secrets.read()).cdp?.address;
    if (!saved)
      throw new BrowserProblemError({
        message: 'There’s no browser address saved. Add it in Settings › Browser.',
        action: 'settings',
      });
    address = checkAddress(saved);
  }

  let browser: Browser;
  try {
    browser = await over(address, timeout);
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    throw new BrowserProblemError({
      message:
        kind === 'chrome'
          ? /timeout/i.test(message)
            ? 'Your Chrome didn’t let Conch in. When Chrome asks, press Allow.'
            : 'Conch couldn’t reach your Chrome. Make sure it’s open, with remote debugging allowed.'
          : `${name} didn’t answer.`,
      action: kind === 'chrome' ? 'settings' : 'retry',
    });
  }
  const context = await contextOf(browser);
  const shared = kind === 'chrome';
  return {
    context,
    name,
    shared,
    release: async () => {
      // Only what Conch opened goes; anyone else's tabs, and the browser, stay.
      const ours = context.pages().filter((p) => OWNED.has(p));
      await Promise.all(ours.map((p) => p.close().catch(() => undefined)));
      // A connected browser is only let go of, never closed.
      await browser.close().catch(() => undefined);
    },
  };
}

/** The pages Conch opened in a shared browser: the only ones it ever touches. */
export const OWNED = new WeakSet<object>();
