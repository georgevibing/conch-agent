/**
 * A little computer (ADR 0029): Conch on a Mac mini in a cupboard, a
 * Raspberry Pi, a Linux box nobody logs in to.
 *
 * - **After logging out.** A Linux user's services stop at logout unless
 *   the user "lingers" (`loginctl enable-linger`, which systemd lets you set
 *   for yourself on most systems; otherwise it's one `sudo` command). A Mac
 *   and Windows stop everything at logout, so they say how to stay logged in.
 * - **Awake.** A Mac on mains power sleeps when idle, and routines and your
 *   phone can't reach it then. With "Keep this Mac awake" on, the background
 *   Conch holds `caffeinate -s` for as long as it runs (it ends with Conch).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { userInfo } from 'node:os';

import type { BackgroundStatus } from '@conch/protocol';

import { run, type RunResult } from '../lib/proc';

export type Exec = (file: string, args: string[]) => Promise<RunResult>;
const exec: Exec = (file, args) => run(file, args, { timeout: 10_000 });

type AfterLogoutState = NonNullable<BackgroundStatus['afterLogout']>;

export class AfterLogout {
  constructor(
    private readonly options: {
      platform?: NodeJS.Platform;
      exec?: Exec;
      user?: string;
      /** systemd runs Conch here (lingering only means something for it). */
      systemd: () => Promise<boolean>;
    },
  ) {}

  get #user() {
    return this.options.user ?? userInfo().username;
  }

  async status(): Promise<AfterLogoutState> {
    const platform = this.options.platform ?? process.platform;
    if (platform === 'darwin')
      return {
        state: 'unavailable',
        note: 'A Mac stops what you run when you log out. On a Mac that stays on, turn on automatic login in System Settings → Users & Groups, and lock the screen instead of logging out.',
      };
    if (platform === 'win32')
      return {
        state: 'unavailable',
        note: 'Windows stops what you run when you sign out. Lock the screen instead of signing out, and Conch keeps going.',
      };
    if (!(await this.options.systemd()))
      return {
        state: 'unavailable',
        note: 'This computer starts Conch with its desktop, so Conch stops when you log out.',
      };
    const result = await (this.options.exec ?? exec)('loginctl', [
      'show-user',
      this.#user,
      '--property=Linger',
    ]);
    if (result.code !== 0 && !/Linger=/.test(result.stdout))
      // Not logged in yet as far as logind knows, or no logind: same answer as "off".
      return { state: 'off', command: `sudo loginctl enable-linger ${this.#user}` };
    return /Linger=yes/.test(result.stdout) ? { state: 'on' } : { state: 'off' };
  }

  /** Turn it on (or off). Where it needs an administrator, says the one command to run. */
  async set(on: boolean): Promise<AfterLogoutState> {
    const before = await this.status();
    if (before.state === 'unavailable') return before;
    const result = await (this.options.exec ?? exec)('loginctl', [
      on ? 'enable-linger' : 'disable-linger',
      this.#user,
    ]);
    const after = await this.status();
    if (result.code !== 0 && after.state !== (on ? 'on' : 'off'))
      return {
        ...after,
        command: `sudo loginctl ${on ? 'enable-linger' : 'disable-linger'} ${this.#user}`,
        note: 'This computer asks for an administrator to change that. Run this once, then come back.',
      };
    return after;
  }
}

/** Holds a Mac awake (on mains power) for as long as this Conch runs. */
export class KeepAwake {
  #child?: ChildProcess;

  constructor(
    private readonly options: {
      platform?: NodeJS.Platform;
      start?: () => ChildProcess | undefined;
    } = {},
  ) {}

  get available() {
    return (this.options.platform ?? process.platform) === 'darwin';
  }

  get active() {
    return Boolean(this.#child && this.#child.exitCode === null && !this.#child.killed);
  }

  /** On while `on` and this is the background Conch; off otherwise. */
  apply(on: boolean) {
    if (!this.available) return;
    if (on && !this.active) {
      this.#child =
        this.options.start?.() ??
        // `-w` ends it with this process, whatever happens to us.
        spawn('/usr/bin/caffeinate', ['-s', '-w', String(process.pid)], { stdio: 'ignore' });
      this.#child.on('error', () => (this.#child = undefined));
      this.#child.unref?.();
    }
    if (!on && this.#child) {
      this.#child.kill();
      this.#child = undefined;
    }
  }
}

/** For the mock engine: a Linux box that lingers in memory, and a Mac that stays awake in name only. */
export function pretendLittle(): { afterLogout: AfterLogout; keepAwake: KeepAwake } {
  let linger = false;
  const afterLogout = new AfterLogout({
    platform: 'linux',
    user: 'ada',
    systemd: async () => true,
    exec: async (_file, args) => {
      if (args[0] === 'enable-linger') linger = true;
      if (args[0] === 'disable-linger') linger = false;
      return { stdout: `Linger=${linger ? 'yes' : 'no'}\n`, stderr: '', code: 0 };
    },
  });
  const keepAwake = new KeepAwake({
    platform: 'darwin',
    start: () => {
      const child = {
        exitCode: null,
        killed: false,
        kill: () => ((child.killed = true), true),
        on: () => child,
        unref: () => undefined,
      };
      return child as unknown as ChildProcess;
    },
  });
  return { afterLogout, keepAwake };
}
