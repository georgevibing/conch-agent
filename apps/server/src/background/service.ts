/**
 * Always on (ADR 0026): Conch starts when you log in and keeps running with
 * no window, so routines run on time and your phone and chat apps can reach
 * it whenever you're away.
 *
 * Turning it on from a Conch running in a Terminal window is a handover: the
 * computer starts the background Conch, which waits for this one's place
 * (`waitForTurn`); once it's seen waiting, this one says goodbye and stops,
 * and the page comes back on the new one by itself. When the background one
 * can't start, nothing stops: this one keeps going and says why.
 *
 * Turning it off never stops the Conch you're using: it just won't start by
 * itself next time. Quitting is its own button.
 */
import { chmod, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  BackgroundRunning,
  BackgroundStatus,
  DoctorItem,
  SetBackgroundResult,
} from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import { readJson, writeFileAtomic, writeJson } from '../lib/fs';
import {
  autostartBackend,
  hasSystemdUser,
  launchdBackend,
  systemdBackend,
  windowsBackend,
  type Backend,
  type Launcher,
} from './backends';
import {
  serviceLabel,
  shellLauncher,
  windowsHidden,
  windowsLauncher,
  type LaunchSpec,
} from './files';
import type { AfterLogout, KeepAwake } from './little';
import { iconIn, type Shortcut } from './shortcut';
import type { TrayService } from './tray';

/** How long a background Conch has to be seen waiting before this one hands over. */
const HANDOVER_WAIT_MS = 60_000;
const LOOK_EVERY_MS = 250;

export const backgroundDir = (home: string) => join(home, 'background');
export const logFile = (home: string) => join(home, 'logs', 'conch.log');
const waitingFile = (home: string) => join(backgroundDir(home), 'waiting.json');
export const shortcutDir = (home: string) => join(home, 'shortcut');

/** How the Conch answering now was started. */
export function runningAs(env: NodeJS.ProcessEnv = process.env): BackgroundRunning {
  if (env.CONCH_BACKGROUND === '1') return 'background';
  // Only with the app's channel open: a Conch started from the app's terminal isn't the app.
  if (env.CONCH_APP?.trim() && typeof process.send === 'function') return 'app';
  if (env.CONCH_SUPERVISED === '1') return 'window';
  return 'dev';
}

/**
 * The computer's own way of starting Conch at login, if there is one. The
 * desktop app opens a window, so on Linux it starts with the desktop
 * (autostart), never as a systemd service that has no desktop to show it on.
 */
export async function backendFor(
  home: string,
  platform: NodeJS.Platform = process.platform,
  { app = false }: { app?: boolean } = {},
): Promise<Backend | undefined> {
  const label = serviceLabel(home);
  if (platform === 'darwin') return launchdBackend(label);
  if (platform === 'win32') return windowsBackend(label);
  if (platform === 'linux')
    return !app && (await hasSystemdUser()) ? systemdBackend(label) : autostartBackend(label);
  return undefined;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The background Conch waiting for this one's place, if there is one. */
export async function waitingPid(home: string): Promise<number | undefined> {
  const record = await readJson<{ pid?: unknown }>(waitingFile(home)).catch(() => undefined);
  const pid = typeof record?.pid === 'number' ? record.pid : undefined;
  return pid && pid !== process.pid && alive(pid) ? pid : undefined;
}

/**
 * A background Conch that found another Conch in its place: say it's waiting,
 * then wait until that one stops (you closed the window, or it handed over).
 * Resolves when the place is free; the caller starts as usual.
 */
export async function waitForTurn(
  home: string,
  free: () => Promise<boolean>,
  options: { every?: number; signal?: AbortSignal } = {},
): Promise<void> {
  await mkdir(backgroundDir(home), { recursive: true, mode: 0o700 });
  await writeJson(waitingFile(home), { pid: process.pid, since: Date.now() });
  try {
    while (!(await free())) {
      if (options.signal?.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, options.every ?? 1_000));
    }
  } finally {
    await rm(waitingFile(home), { force: true });
  }
}

/** The last thing the launcher or Conch said in the log: why it didn't start. */
export async function lastWords(home: string, lines = 1): Promise<string | undefined> {
  const text = await readFile(logFile(home), 'utf8').catch(() => '');
  const said = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('---'))
    // The gateway's own log lines are JSON: what it said is their `msg`.
    .map((line) => {
      if (!line.startsWith('{')) return line;
      try {
        const msg = (JSON.parse(line) as { msg?: unknown }).msg;
        return typeof msg === 'string' ? msg : '';
      } catch {
        return line;
      }
    })
    .filter(Boolean);
  return said.slice(-lines).join('\n') || undefined;
}

export interface BackgroundDeps {
  home: string;
  /** Conch's own folder; without it there's nothing to start. */
  checkout?: string;
  /** How this Conch is running. */
  running: BackgroundRunning;
  since: number;
  /** The computer's way (undefined: none here). The mock engine's is pretend. */
  backend: Backend | undefined | Promise<Backend | undefined>;
  /** What only works while Conch runs, in a sentence (routines, chat apps). */
  needed?: () => Promise<string | undefined>;
  /** What goes into the launcher: Node, environment, PATH. */
  spec: Omit<LaunchSpec, 'checkout' | 'home' | 'log'>;
  platform?: NodeJS.Platform;
  /** This Conch stops (a handover): returns false when it can't. */
  handover: () => boolean;
  heal: (message: string) => void;
  /** Where Conch answers, for the app shortcut. */
  url: string;
  /** Conch as an app (Applications, the Start menu). Unset: none here. */
  shortcut?: Shortcut;
  /** Conch in the menu bar, tray or panel (ADR 0029). */
  tray?: TrayService;
  /** Whether Conch keeps running after logging out (ADR 0029). */
  afterLogout?: AfterLogout;
  /** A Mac kept awake while the background Conch runs (ADR 0029). */
  keepAwake?: {
    service: KeepAwake;
    wanted: () => Promise<boolean>;
    setWanted: (on: boolean) => Promise<void>;
  };
  /** For tests. */
  waitMs?: number;
}

export class BackgroundService {
  #changing?: Promise<SetBackgroundResult>;
  #problem?: { message: string; command?: string };

  constructor(private readonly deps: BackgroundDeps) {}

  /** The file the computer runs, written (again) for where Conch is now. */
  async #writeLauncher(): Promise<Launcher> {
    const { home, checkout } = this.deps;
    if (!checkout) throw new Error('Conch can’t find its own folder.');
    const dir = backgroundDir(home);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const spec: LaunchSpec = { ...this.deps.spec, checkout, home, log: logFile(home) };
    if ((this.deps.platform ?? process.platform) === 'win32') {
      const cmd = join(dir, 'conch.cmd');
      const vbs = join(dir, 'conch.vbs');
      await writeFileAtomic(cmd, windowsLauncher(spec), 0o700);
      await writeFileAtomic(vbs, windowsHidden(cmd), 0o700);
      return { path: vbs, log: spec.log };
    }
    // Named for what it is: macOS lists it under Login Items by this name.
    const path = join(dir, 'Conch');
    await writeFileAtomic(path, shellLauncher(spec), 0o700);
    await chmod(path, 0o700);
    return { path, log: spec.log };
  }

  async status(): Promise<BackgroundStatus> {
    const { checkout, running, since } = this.deps;
    const backend = await this.deps.backend;
    const needed = await this.deps.needed?.().catch(() => undefined);
    const where = this.deps.shortcut?.where();
    const shortcut =
      this.deps.shortcut && where && checkout && running !== 'dev'
        ? { installed: this.deps.shortcut.installed(), where }
        : undefined;
    const little = running === 'dev' ? {} : await this.#little();
    const base = {
      running,
      since,
      kind: backend?.kind,
      place: backend?.place,
      needed,
      shortcut,
      ...little,
    };
    if (!backend)
      return {
        ...base,
        supported: false,
        on: false,
        unsupported: 'This computer has no way for Conch to start by itself at login.',
      };
    const on = await backend.registered().catch(() => false);
    if (running === 'dev')
      return {
        ...base,
        supported: false,
        on,
        unsupported: 'Always on is for Conch itself (pnpm start), not a development server.',
      };
    if (!checkout)
      return {
        ...base,
        supported: false,
        on,
        unsupported: 'Conch can’t find its own folder, so it has nothing to start at login.',
      };
    const disabled = on ? await backend.disabled?.().catch(() => undefined) : undefined;
    return { ...base, supported: true, on, problem: disabled ?? this.#problem };
  }

  /** Conch in the menu bar on or off (it shows, or goes, now). */
  async setTray(on: boolean): Promise<BackgroundStatus> {
    await this.deps.tray?.set(on);
    return this.status();
  }

  /** Keep running after logging out (Linux lingering). */
  async setAfterLogout(on: boolean): Promise<BackgroundStatus> {
    const result = await this.deps.afterLogout?.set(on);
    const status = await this.status();
    return result ? { ...status, afterLogout: result } : status;
  }

  /** Keep this Mac awake while the background Conch runs. */
  async setKeepAwake(on: boolean): Promise<BackgroundStatus> {
    const awake = this.deps.keepAwake;
    if (awake) {
      await awake.setWanted(on);
      awake.service.apply(on && this.deps.running === 'background');
    }
    return this.status();
  }

  /** On start: hold the Mac awake if that's wanted and this is the background Conch. */
  async applyKeepAwake(): Promise<void> {
    const awake = this.deps.keepAwake;
    if (!awake?.service.available) return;
    awake.service.apply((await awake.wanted()) && this.deps.running === 'background');
  }

  /** The menu bar, after logging out, and staying awake: each only where it means something. */
  async #little(): Promise<Pick<BackgroundStatus, 'tray' | 'afterLogout' | 'keepAwake'>> {
    const { tray, afterLogout, keepAwake } = this.deps;
    const [trayStatus, logout, awake] = await Promise.all([
      tray?.status().catch(() => undefined),
      afterLogout?.status().catch(() => undefined),
      keepAwake?.service.available ? keepAwake.wanted().catch(() => false) : undefined,
    ]);
    return {
      ...(trayStatus && { tray: trayStatus }),
      ...(logout && { afterLogout: logout }),
      ...(awake !== undefined &&
        keepAwake && { keepAwake: { on: awake, active: keepAwake.service.active } }),
    };
  }

  #shortcutSpec() {
    const { home, checkout, url } = this.deps;
    if (!checkout) throw new Error('Conch can’t find its own folder.');
    return { ...this.deps.spec, checkout, home, log: logFile(home), url, icon: iconIn(checkout) };
  }

  /** Put Conch where people look for apps (or again, for where Conch is now). */
  async addShortcut(): Promise<BackgroundStatus> {
    if (!this.deps.shortcut)
      throw new Error('Conch can’t add itself to your apps on this computer.');
    await this.deps.shortcut.install(this.#shortcutSpec(), shortcutDir(this.deps.home));
    return this.status();
  }

  async removeShortcut(): Promise<void> {
    await this.deps.shortcut?.remove(shortcutDir(this.deps.home));
  }

  /** Turn Always on on or off. One change at a time; a second press gets the first's answer. */
  set(on: boolean): Promise<SetBackgroundResult> {
    this.#changing ??= (on ? this.#turnOn() : this.#turnOff()).finally(() => {
      this.#changing = undefined;
    });
    return this.#changing;
  }

  /**
   * Write the launcher, register it with the computer, and (unless this is
   * the background Conch) start it now. A background Conch that finds this
   * one open waits for its place. Throws a sentence when the computer says no.
   */
  async enable(): Promise<void> {
    const backend = await this.deps.backend;
    if (!backend) throw new Error('This computer has no way for Conch to start by itself.');
    const launcher = await this.#writeLauncher();
    await backend.install(launcher);
    // The background Conch is this one; the app keeps running when its window closes.
    if (this.deps.running === 'background' || this.deps.running === 'app') return;
    await rm(waitingFile(this.deps.home), { force: true });
    await backend.start(launcher);
  }

  async #turnOn(): Promise<SetBackgroundResult> {
    const { running, home } = this.deps;
    const backend = await this.deps.backend;
    const before = await this.status();
    if (!backend || !before.supported) return { status: before, handover: false };
    this.#problem = undefined;
    try {
      await this.enable();
    } catch (error) {
      this.#problem = {
        message: `Conch couldn’t set itself to start at login: ${(error as Error).message}`,
      };
      return { status: await this.status(), handover: false };
    }
    // Already the background one, or the app (it keeps running without its window): that's all.
    if (running === 'background' || running === 'app')
      return { status: await this.status(), handover: false };
    if (backend.kind === 'pretend') return { status: await this.status(), handover: false };
    // The background Conch says it's waiting for this one's place: hand over.
    const deadline = Date.now() + (this.deps.waitMs ?? HANDOVER_WAIT_MS);
    while (Date.now() < deadline) {
      if (await waitingPid(home)) {
        // Can't stop here (no window to leave): the background one takes over when this one ends.
        return { status: await this.status(), handover: this.deps.handover() };
      }
      await new Promise((resolve) => setTimeout(resolve, LOOK_EVERY_MS));
    }
    const said = await lastWords(home);
    this.#problem = {
      message: `Conch will start when you log in, but couldn’t start in the background just now${said ? `: “${said}”` : '.'} This window keeps it running meanwhile.`,
      command:
        (this.deps.platform ?? process.platform) === 'win32'
          ? `Get-Content -Tail 40 "${logFile(home)}"`
          : `tail -n 40 ${JSON.stringify(logFile(home))}`,
    };
    return { status: await this.status(), handover: false };
  }

  async #turnOff(): Promise<SetBackgroundResult> {
    const { running, home } = this.deps;
    const backend = await this.deps.backend;
    if (!backend) return { status: await this.status(), handover: false };
    this.#problem = undefined;
    // The one answering is never stopped by this; one waiting for its turn is.
    await backend.remove({ stop: running !== 'background' }).catch(() => undefined);
    const waiting = await waitingPid(home);
    if (waiting && running !== 'background') {
      try {
        process.kill(waiting, 'SIGTERM');
      } catch {
        // Already gone.
      }
    }
    // The one answering may need its launcher again after a crash, until you log out.
    if (running !== 'background') await rm(backgroundDir(home), { recursive: true, force: true });
    return { status: await this.status(), handover: false };
  }

  /**
   * On every start, and from Repair everything: when Always on is on, the
   * launcher and the computer's file match where Conch is now (Node moved,
   * the folder moved, a newer launcher). Says so once when it fixed one.
   */
  async heal(): Promise<'ok' | 'fixed' | 'off'> {
    const { checkout, running, shortcut } = this.deps;
    const backend = await this.deps.backend;
    if (!checkout || running === 'dev') return 'off';
    // The app keeps opening the Conch that's here, wherever it moved.
    if (shortcut?.installed()) {
      const changed = await shortcut
        .install(this.#shortcutSpec(), shortcutDir(this.deps.home))
        .catch(() => false);
      if (changed) this.deps.heal('The Conch app pointed at an old place, so Conch updated it.');
    }
    if (!backend) return 'off';
    if (!(await backend.registered().catch(() => false))) return 'off';
    const before = await this.#launcherText();
    const launcher = await this.#writeLauncher();
    const after = await this.#launcherText();
    const { changed } = await backend.install(launcher);
    if (before !== after || changed) {
      this.deps.heal(
        before === undefined
          ? 'Always on was missing the file that starts Conch at login, so Conch wrote it again.'
          : 'Something Conch uses to start at login had moved, so Conch updated how it starts.',
      );
      return 'fixed';
    }
    return 'ok';
  }

  async #launcherText(): Promise<string | undefined> {
    const dir = backgroundDir(this.deps.home);
    const name = (this.deps.platform ?? process.platform) === 'win32' ? 'conch.cmd' : 'Conch';
    return readFile(join(dir, name), 'utf8').catch(() => undefined);
  }

  /** Repair everything's look at Always on. */
  doctorCheck(): DoctorCheck {
    return {
      id: 'background',
      group: 'This computer',
      title: 'Always on',
      run: async ({ repair }) => {
        const item = (
          state: DoctorItem['state'],
          message: string,
          action?: DoctorItem['action'],
        ) => [
          { id: 'background', group: 'This computer', title: 'Always on', state, message, action },
        ];
        const status = await this.status();
        if (!status.supported)
          return item('off', status.unsupported ?? 'Always on isn’t available here.');
        if (status.on) {
          const healed = repair ? await this.heal() : 'ok';
          const now = await this.status();
          if (now.problem)
            return item(
              'needs-you',
              now.problem.message,
              now.problem.command
                ? { kind: 'command', label: 'Copy', command: now.problem.command }
                : { kind: 'open', label: 'Open Always on', place: 'health', focus: 'background' },
            );
          return healed === 'fixed'
            ? item('fixed', 'Conch updated how it starts at login.')
            : item('ok', 'Conch starts when you log in and keeps running.');
        }
        // Off is fine, unless something you set up only works while Conch runs.
        if (status.needed && status.running === 'window')
          return item('warning', status.needed, {
            kind: 'open',
            label: 'Keep Conch running',
            place: 'health',
            focus: 'background',
          });
        return item(
          'off',
          status.running === 'background'
            ? 'Conch is running now, and won’t start by itself at the next login.'
            : status.running === 'app'
              ? 'Conch runs until you quit the app.'
              : 'Conch runs while its window is open.',
        );
      },
    };
  }
}
