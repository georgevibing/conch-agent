import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RunResult } from '../lib/proc';
import {
  autostartBackend,
  launchdBackend,
  runValueName,
  systemdBackend,
  unitName,
  windowsBackend,
  type Exec,
} from './backends';

/** A pretend program: answers by its arguments, and remembers every call. */
function fakeExec(answer: (file: string, args: string[]) => Partial<RunResult> = () => ({})) {
  const calls: string[] = [];
  const exec: Exec = async (file, args) => {
    calls.push([file, ...args].join(' '));
    return { stdout: '', stderr: '', code: 0, ...answer(file, args) };
  };
  return { exec, calls };
}

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'conch-backend-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const launcher = () => ({ path: join(home, 'bg', 'Conch'), log: join(home, 'log') });

describe('launchd', () => {
  const label = 'app.conch.gateway';
  const plist = () => join(home, 'Library', 'LaunchAgents', `${label}.plist`);

  it('writes an agent only its owner can change, and only when it differs', async () => {
    const { exec } = fakeExec();
    const backend = launchdBackend(label, { home, uid: 501, exec });
    expect(await backend.registered()).toBe(false);
    expect(await backend.install(launcher())).toEqual({ changed: true });
    expect(statSync(plist()).mode & 0o777).toBe(0o644);
    expect(readFileSync(plist(), 'utf8')).toContain(launcher().path);
    expect(await backend.install(launcher())).toEqual({ changed: false });
    expect(await backend.registered()).toBe(true);
  });

  it('loads it when it isn’t loaded, and kicks it when it is', async () => {
    let loaded = false;
    const { exec, calls } = fakeExec((_, args) =>
      args[0] === 'print' ? { code: loaded ? 0 : 113 } : {},
    );
    const backend = launchdBackend(label, { home, uid: 501, exec });
    await backend.install(launcher());
    await backend.start(launcher());
    expect(calls).toContain(`launchctl bootstrap gui/501 ${plist()}`);
    loaded = true;
    await backend.start(launcher());
    expect(calls).toContain('launchctl kickstart gui/501/app.conch.gateway');
  });

  it('says what launchctl said when it refuses', async () => {
    const { exec } = fakeExec((_, args) =>
      args[0] === 'print'
        ? { code: 113 }
        : { code: 5, stderr: 'Bootstrap failed: 5: Input/output error' },
    );
    const backend = launchdBackend(label, { home, uid: 501, exec });
    await expect(backend.start(launcher())).rejects.toThrow(/Input\/output error/);
  });

  it('never unloads the Conch you are using, only one that isn’t answering', async () => {
    const { exec, calls } = fakeExec();
    const backend = launchdBackend(label, { home, uid: 501, exec });
    await backend.install(launcher());
    await backend.remove({ stop: false });
    expect(existsSync(plist())).toBe(false);
    expect(calls.some((c) => c.includes('bootout'))).toBe(false);
    await backend.install(launcher());
    await backend.remove({ stop: true });
    expect(calls).toContain('launchctl bootout gui/501/app.conch.gateway');
  });

  it('notices when Login Items turned it off', async () => {
    const { exec } = fakeExec((_, args) =>
      args[0] === 'print-disabled'
        ? {
            stdout:
              'disabled services = {\n\t"app.conch.gateway" => disabled\n\t"other" => enabled\n}',
          }
        : {},
    );
    const off = await launchdBackend(label, { home, uid: 501, exec }).disabled?.();
    expect(off?.message).toMatch(/Login Items/);
    const { exec: fine } = fakeExec(() => ({ stdout: '"app.conch.gateway" => enabled' }));
    expect(
      await launchdBackend(label, { home, uid: 501, exec: fine }).disabled?.(),
    ).toBeUndefined();
  });
});

describe('systemd', () => {
  it('writes the unit, reloads, enables and starts it', async () => {
    const { exec, calls } = fakeExec((_, args) =>
      args.includes('is-enabled') ? { stdout: 'enabled\n' } : {},
    );
    const backend = systemdBackend('app.conch.gateway', { config: home, exec });
    await backend.install(launcher());
    await backend.start(launcher());
    expect(readFileSync(join(home, 'systemd', 'user', 'conch.service'), 'utf8')).toContain(
      launcher().path,
    );
    expect(calls).toEqual([
      'systemctl --user daemon-reload',
      'systemctl --user enable conch.service',
      'systemctl --user start conch.service',
    ]);
    expect(await backend.registered()).toBe(true);
  });

  it('says why when systemd refuses', async () => {
    const { exec } = fakeExec((_, args) =>
      args.includes('enable') ? { code: 1, stderr: 'Failed to connect to bus' } : {},
    );
    await expect(
      systemdBackend('app.conch.gateway', { config: home, exec }).install(launcher()),
    ).rejects.toThrow(/Failed to connect to bus/);
  });

  it('stops only when asked to', async () => {
    const { exec, calls } = fakeExec();
    const backend = systemdBackend('app.conch.gateway', { config: home, exec });
    await backend.remove({ stop: false });
    expect(calls.some((c) => c.includes(' stop '))).toBe(false);
    await backend.remove({ stop: true });
    expect(calls).toContain('systemctl --user stop conch.service');
  });

  it('names another home’s unit apart', () => {
    expect(unitName('app.conch.gateway')).toBe('conch');
    expect(unitName('app.conch.gateway.1a2b3c4d')).toBe('conch-1a2b3c4d');
  });
});

describe('autostart', () => {
  it('writes the desktop entry and starts the launcher', async () => {
    const started: string[] = [];
    const backend = autostartBackend('app.conch.gateway', {
      config: home,
      detach: (file, args) => started.push([file, ...args].join(' ')),
    });
    await backend.install(launcher());
    expect(await backend.registered()).toBe(true);
    await backend.start(launcher());
    expect(started).toEqual([`/bin/sh ${launcher().path}`]);
    await backend.remove({ stop: true });
    expect(await backend.registered()).toBe(false);
  });
});

describe('windows', () => {
  it('adds the Run value once, and hides the window with wscript', async () => {
    let value = '';
    const { exec, calls } = fakeExec((_, args) => {
      if (args[0] === 'add') value = args[args.indexOf('/d') + 1] ?? '';
      if (args[0] === 'query') return value ? { stdout: `Conch REG_SZ ${value}` } : { code: 1 };
      return {};
    });
    const started: string[] = [];
    const backend = windowsBackend('app.conch.gateway', {
      exec,
      wscript: 'C:\\Windows\\System32\\wscript.exe',
      detach: (file, args) => started.push([file, ...args].join(' ')),
    });
    const vbs = { path: 'C:\\Users\\me\\.conch\\background\\conch.vbs', log: 'x' };
    expect(await backend.install(vbs)).toEqual({ changed: true });
    expect(value).toBe(`"C:\\Windows\\System32\\wscript.exe" "${vbs.path}"`);
    expect(await backend.install(vbs)).toEqual({ changed: false });
    expect(calls.filter((c) => c.includes(' add ')).length).toBe(1);
    await backend.start(vbs);
    expect(started).toEqual([`C:\\Windows\\System32\\wscript.exe ${vbs.path}`]);
  });

  it('notices when Task Manager turned it off', async () => {
    const { exec } = fakeExec(() => ({
      stdout: '    Conch    REG_BINARY    030000000000000000000000',
    }));
    const off = await windowsBackend('app.conch.gateway', { exec }).disabled?.();
    expect(off?.message).toMatch(/Startup apps/);
    const { exec: on } = fakeExec(() => ({ stdout: '    Conch    REG_BINARY    020000000000' }));
    expect(await windowsBackend('app.conch.gateway', { exec: on }).disabled?.()).toBeUndefined();
  });

  it('names another home’s value apart', () => {
    expect(runValueName('app.conch.gateway')).toBe('Conch');
    expect(runValueName('app.conch.gateway.1a2b3c4d')).toBe('Conch 1a2b3c4d');
  });
});

describe('refreshing an installed watchdog', () => {
  it('queues a restart without waiting for its own process to stop or starting a stopped service', async () => {
    const { exec, calls } = fakeExec(() => ({}));
    const backend = systemdBackend('app.conch.gateway', { config: home, exec });
    await backend.refreshSupervisor?.();
    expect(calls).toEqual(['systemctl --user --no-block try-restart conch.service']);
  });
  it('reports a rejected restart so the existing gateway can keep serving', async () => {
    const { exec } = fakeExec(() => ({ code: 1 }));
    const backend = systemdBackend('app.conch.gateway', { config: home, exec });
    await expect(backend.refreshSupervisor?.()).rejects.toThrow('could not refresh');
  });
});
