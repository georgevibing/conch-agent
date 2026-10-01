/**
 * Your phone's secure address (ADR 0027): Conch over Tailscale, set up with
 * one press. `tailscale serve` gives this computer an HTTPS address only your
 * own devices can reach (`https://mac.tail1234.ts.net`), with a real
 * certificate, so nothing is opened to the internet. HTTPS is also what a
 * phone needs for an installed app, notifications and the microphone.
 *
 * Conch looks without changing anything (`status`), and turns the address on
 * when a person presses the button (`serve`). What only a person can do comes
 * back as one step: install Tailscale, sign in, allow HTTPS for the tailnet
 * (a page Tailscale names), or let Conch use Tailscale on Linux.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

import type { PhoneAddress } from '@conch/protocol';

import { run, type RunResult } from '../lib/proc';

export const TAILSCALE_BINARIES = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  '/usr/bin/tailscale',
  'C:\\Program Files\\Tailscale\\tailscale.exe',
];

export function tailscaleBinary(exists: (p: string) => boolean = existsSync): string | undefined {
  return TAILSCALE_BINARIES.find((p) => exists(p));
}

export type Exec = (file: string, args: string[], timeout?: number) => Promise<RunResult>;
const exec: Exec = (file, args, timeout = 5_000) => run(file, args, { timeout });

/** `tailscale serve status --json`: does any handler send this tailnet name to Conch's port? */
export function servesPort(json: string, port: number): boolean {
  let config: { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> };
  try {
    config = JSON.parse(json) as typeof config;
  } catch {
    return false;
  }
  return Object.values(config.Web ?? {}).some((site) =>
    Object.values(site.Handlers ?? {}).some((handler) => {
      const proxy = handler.Proxy ?? '';
      return new RegExp(`^(https?://)?(127\\.0\\.0\\.1|localhost|\\[::1\\])?:?${port}/?$`).test(
        proxy,
      );
    }),
  );
}

/** What `tailscale serve` said, as the step only a person can take (or nothing). */
export function serveProblem(output: string): PhoneAddress['problem'] {
  const enable = /(https:\/\/login\.tailscale\.com\/f\/[a-z]+\?[^\s"']+)/i.exec(output)?.[1];
  if (enable)
    return {
      kind: 'enable-https',
      message:
        'Tailscale needs your OK to give this computer a secure address. Open the page, press Enable, and Conch carries on by itself.',
      url: enable,
    };
  if (/operator|access denied|permission denied|must be root/i.test(output))
    return {
      kind: 'permission',
      message:
        'On Linux, Tailscale asks once that you let your own account set it up. Run this, then press Turn on again.',
      command: 'sudo tailscale set --operator=$USER',
    };
  if (/https.*(not enabled|disabled)|certificate|cert /i.test(output))
    return {
      kind: 'enable-https',
      message:
        'Turn on HTTPS certificates for your tailnet in Tailscale’s admin console (DNS → HTTPS Certificates), then press Turn on again.',
      url: 'https://login.tailscale.com/admin/dns',
    };
  return undefined;
}

export interface TailscaleDeps {
  port: () => number;
  binary?: () => string | undefined;
  exec?: Exec;
  spawn?: typeof spawn;
  /** The name changed (signed in, serve turned on): the gateway allows it as a Host. */
  onName?: (name: string | undefined, serving: boolean) => void;
}

export class Tailscale {
  #pending?: ChildProcess;
  #said = '';

  constructor(private readonly deps: TailscaleDeps) {}

  get #exec() {
    return this.deps.exec ?? exec;
  }

  /** Where it stands. Never prompts and never changes anything. */
  async status(): Promise<PhoneAddress> {
    const binary = (this.deps.binary ?? tailscaleBinary)();
    if (!binary) return { state: 'missing' };
    const result = await this.#exec(binary, ['status', '--json']);
    if (result.code !== 0 && !result.stdout.trim()) {
      // Installed, but its background service isn't running (the app is closed).
      return { state: 'stopped' };
    }
    let status: { BackendState?: string; Self?: { DNSName?: string } };
    try {
      status = JSON.parse(result.stdout) as typeof status;
    } catch {
      return { state: 'stopped' };
    }
    if (status.BackendState === 'NeedsLogin' || status.BackendState === 'NeedsMachineAuth')
      return { state: 'signed-out' };
    if (status.BackendState !== 'Running') return { state: 'stopped' };
    const name = status.Self?.DNSName?.replace(/\.$/, '').toLowerCase();
    const serve = await this.#exec(binary, ['serve', 'status', '--json']);
    const serving = serve.code === 0 && servesPort(serve.stdout, this.deps.port());
    this.deps.onName?.(name, serving);
    if (serving && name) return { state: 'ready', name, url: `https://${name}` };
    return {
      state: 'off',
      ...(name && { name }),
      ...(this.#pending && { waiting: true }),
      ...(this.#pending && this.#said && { problem: serveProblem(this.#said) }),
    };
  }

  /**
   * Turn the secure address on. When Tailscale first needs an OK on its own
   * page, `tailscale serve` waits for it: Conch leaves it waiting (up to ten
   * minutes), says which page, and the address comes on by itself once the
   * person has pressed Enable there.
   */
  async serve(): Promise<PhoneAddress> {
    const before = await this.status();
    if (before.state !== 'off') return before;
    const binary = (this.deps.binary ?? tailscaleBinary)();
    if (!binary) return { state: 'missing' };
    this.#pending?.kill();
    this.#said = '';
    const child = (this.deps.spawn ?? spawn)(binary, ['serve', '--bg', String(this.deps.port())], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.#pending = child;
    const done = new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code));
      child.on('error', () => resolve(1));
    });
    const read = (chunk: Buffer) => {
      this.#said = (this.#said + String(chunk)).slice(-4_000);
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    const timer = setTimeout(() => child.kill(), 10 * 60_000);
    timer.unref?.();
    void done.then(() => {
      clearTimeout(timer);
      if (this.#pending === child) this.#pending = undefined;
    });
    // Most of the time it's done in a moment; otherwise it said what it waits for.
    const settled = await Promise.race([
      done.then((code) => ({ code })),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4_000)),
    ]);
    const now = await this.status();
    if (now.state === 'ready') return now;
    const problem = serveProblem(this.#said);
    if (settled && settled.code !== 0)
      return {
        ...now,
        problem: problem ?? {
          kind: 'other',
          message: `Tailscale didn’t turn the address on: ${this.#said.trim().split('\n').pop() || 'it gave no reason'}`,
        },
      };
    return { ...now, waiting: true, ...(problem && { problem }) };
  }

  stop(): void {
    this.#pending?.kill();
  }
}
