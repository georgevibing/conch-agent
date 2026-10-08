/**
 * Each computer's own way of starting Conch at login (ADR 0026): launchd on a
 * Mac, a systemd user service on Linux (or the desktop's autostart where
 * there's no systemd), and the Run key on Windows. A backend only writes,
 * registers and reads its own file; `BackgroundService` decides when.
 *
 * Nothing here needs an administrator: every file is the person's own, under
 * their home folder or their part of the registry.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rm } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';

import type { BackgroundKind } from '@conch/protocol';

import { writeFileAtomic } from '../lib/fs';
import { run, type RunResult } from '../lib/proc';
import { autostartEntry, launchdPlist, systemdUnit, unitName } from './files';
export { unitName } from './files';

export type Exec = (file: string, args: string[]) => Promise<RunResult>;
const exec: Exec = (file, args) => run(file, args, { timeout: 15_000 });

/** Start a program and let it go: it outlives this one. */
export type Detach = (file: string, args: string[]) => void;
const detach: Detach = (file, args) => {
  spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
};

export interface Launcher {
  /** The file the computer runs: the sh launcher, or the `.vbs` that hides the batch file. */
  path: string;
  log: string;
}

export interface Backend {
  kind: BackgroundKind;
  /** Where a person sees it on this computer, in its own words. */
  place?: string;
  /** Write the computer's file (when it differs) and register it. Changes nothing running. */
  install(launcher: Launcher): Promise<{ changed: boolean }>;
  /** Start it now. A Conch that's already running is left alone. */
  start(launcher: Launcher): Promise<void>;
  /** Queue a service-manager restart, including the in-memory supervisor. */
  refreshSupervisor?(): Promise<void>;
  /** Unregister. `stop`: also stop the one the computer started (only when it isn't the one answering). */
  remove(options: { stop: boolean }): Promise<void>;
  /** It's registered to start at login. */
  registered(): Promise<boolean>;
  /** Registered, but turned off in the computer's own settings: what to say. */
  disabled?(): Promise<{ message: string; command?: string } | undefined>;
}

/** Write `text` to `path` unless it's already exactly that. */
async function writeIfChanged(path: string, text: string, mode: number): Promise<boolean> {
  const current = await readFile(path, 'utf8').catch(() => undefined);
  if (current === text) {
    await chmod(path, mode).catch(() => undefined);
    return false;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, text, mode);
  return true;
}

// ── macOS ─────────────────────────────────────────────────────────────────

export function launchdBackend(
  label: string,
  options: { home?: string; uid?: number; exec?: Exec } = {},
): Backend {
  const run = options.exec ?? exec;
  const plist = join(options.home ?? homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  const domain = `gui/${options.uid ?? userInfo().uid}`;
  const target = `${domain}/${label}`;
  const loaded = async () => (await run('launchctl', ['print', target])).code === 0;
  return {
    kind: 'launchd',
    place: 'System Settings → General → Login Items',
    async install(launcher) {
      // launchd refuses an agent that others can write to: 0644.
      const changed = await writeIfChanged(
        plist,
        launchdPlist(label, launcher.path, launcher.log),
        0o644,
      );
      // A newer file only counts once launchd reads it again: at the next login,
      // or now when nothing of it is running (`start`).
      return { changed };
    },
    async start() {
      if (await loaded()) {
        // Loaded and stopped (you quit it): run it again. Already running: nothing happens.
        await run('launchctl', ['kickstart', target]);
        return;
      }
      const result = await run('launchctl', ['bootstrap', domain, plist]);
      if (result.code !== 0 && !(await loaded()))
        throw new Error(
          `launchctl couldn't start Conch: ${result.stderr.trim() || 'no reason given'}`,
        );
    },
    async remove({ stop }) {
      await rm(plist, { force: true });
      // Unloading stops it. When it's the Conch answering, it stays loaded until you
      // quit or log out, and won't come back at the next login without the file.
      if (stop && (await loaded())) await run('launchctl', ['bootout', target]);
    },
    async registered() {
      return existsSync(plist);
    },
    async disabled() {
      const result = await run('launchctl', ['print-disabled', domain]);
      if (result.code !== 0) return undefined;
      const line = result.stdout.split('\n').find((l) => l.includes(`"${label}"`));
      if (!line || !/=>\s*(true|disabled)/.test(line)) return undefined;
      return {
        message:
          'Conch is turned off in System Settings → General → Login Items, so it won’t start when you log in. Turn Conch on there.',
        command: 'open "x-apple.systempreferences:com.apple.LoginItems-Settings.extension"',
      };
    },
  };
}

// ── Linux ─────────────────────────────────────────────────────────────────

/** Linux with a systemd user manager. */
export async function hasSystemdUser(runner: Exec = exec): Promise<boolean> {
  return (await runner('systemctl', ['--user', 'show-environment'])).code === 0;
}

export function systemdBackend(
  label: string,
  options: { config?: string; exec?: Exec } = {},
): Backend {
  const run = options.exec ?? exec;
  const name = `${unitName(label)}.service`;
  const file = join(options.config ?? join(homedir(), '.config'), 'systemd', 'user', name);
  const ctl = (...args: string[]) => run('systemctl', ['--user', ...args]);
  return {
    kind: 'systemd',
    async install(launcher) {
      const changed = await writeIfChanged(file, systemdUnit(launcher.path), 0o644);
      if (changed) await ctl('daemon-reload');
      const enabled = await ctl('enable', name);
      if (enabled.code !== 0)
        throw new Error(
          `systemd couldn't turn Conch on: ${enabled.stderr.trim() || 'no reason given'}`,
        );
      return { changed };
    },
    async start() {
      const result = await ctl('start', name);
      if (result.code !== 0)
        throw new Error(
          `systemd couldn't start Conch: ${result.stderr.trim() || 'no reason given'}`,
        );
    },
    async refreshSupervisor() {
      // Waiting for our own restart would deadlock shutdown. systemd retains the
      // queued job after this gateway and its old supervisor have exited.
      const result = await ctl('--no-block', 'try-restart', name);
      if (result.code !== 0) throw new Error('Conch could not refresh its background supervisor.');
    },
    async remove({ stop }) {
      await ctl('disable', name);
      if (stop) await ctl('stop', name);
      await rm(file, { force: true });
      await ctl('daemon-reload');
    },
    async registered() {
      return (await ctl('is-enabled', name)).stdout.trim() === 'enabled';
    },
  };
}

/** Desktops without systemd: an autostart entry, started when you sign in. */
export function autostartBackend(
  label: string,
  options: { config?: string; detach?: Detach } = {},
): Backend {
  const file = join(
    options.config ?? join(homedir(), '.config'),
    'autostart',
    `${unitName(label)}.desktop`,
  );
  const start = options.detach ?? detach;
  return {
    kind: 'autostart',
    async install(launcher) {
      return { changed: await writeIfChanged(file, autostartEntry(launcher.path), 0o644) };
    },
    async start(launcher) {
      start('/bin/sh', [launcher.path]);
    },
    async remove() {
      await rm(file, { force: true });
    },
    async registered() {
      return existsSync(file);
    },
  };
}

// ── Windows ───────────────────────────────────────────────────────────────

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const APPROVED_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';

/** The value name: `Conch`, or `Conch <suffix>` for another home. */
export function runValueName(label: string): string {
  return label === 'app.conch.gateway' ? 'Conch' : `Conch ${label.split('.').pop() ?? ''}`.trim();
}

export function windowsBackend(
  label: string,
  options: { exec?: Exec; detach?: Detach; wscript?: string } = {},
): Backend {
  const run = options.exec ?? exec;
  const start = options.detach ?? detach;
  const name = runValueName(label);
  const wscript =
    options.wscript ?? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wscript.exe');
  return {
    kind: 'windows',
    place: 'Task Manager → Startup apps',
    async install(launcher) {
      const value = `"${wscript}" "${launcher.path}"`;
      const current = await run('reg', ['query', RUN_KEY, '/v', name]);
      const changed = current.code !== 0 || !current.stdout.includes(launcher.path);
      if (changed) {
        const result = await run('reg', [
          'add',
          RUN_KEY,
          '/v',
          name,
          '/t',
          'REG_SZ',
          '/d',
          value,
          '/f',
        ]);
        if (result.code !== 0)
          throw new Error(`Windows couldn't add Conch to Startup apps: ${result.stderr.trim()}`);
      }
      return { changed };
    },
    async start(launcher) {
      start(wscript, [launcher.path]);
    },
    async remove() {
      await run('reg', ['delete', RUN_KEY, '/v', name, '/f']);
    },
    async registered() {
      return (await run('reg', ['query', RUN_KEY, '/v', name])).code === 0;
    },
    async disabled() {
      // Task Manager keeps its own switch: a first byte of 03 is "Disabled".
      const result = await run('reg', ['query', APPROVED_KEY, '/v', name]);
      if (result.code !== 0) return undefined;
      const data = /REG_BINARY\s+([0-9A-F]+)/i.exec(result.stdout)?.[1];
      if (!data || !data.startsWith('03')) return undefined;
      return {
        message:
          'Conch is turned off in Task Manager → Startup apps, so it won’t start when you sign in. Turn Conch on there.',
        command: 'taskmgr /0 /startup',
      };
    },
  };
}

// ── Pretend (the mock engine) ─────────────────────────────────────────────

/** Remembers in memory only: tests and `pnpm dev:mock` never touch the real computer. */
export function pretendBackend(): Backend & { started: number } {
  let registered = false;
  const backend = {
    kind: 'pretend' as const,
    place: 'Login Items',
    started: 0,
    async install() {
      const changed = !registered;
      registered = true;
      return { changed };
    },
    async start() {
      backend.started += 1;
    },
    async remove() {
      registered = false;
    },
    async registered() {
      return registered;
    },
  };
  return backend;
}
