import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunResult } from '../lib/proc';
import { AfterLogout, KeepAwake } from './little';
import { trayCheck, TrayService, type TrayDeps } from './tray';
import { powershellSource, pythonSource, swiftSource } from './tray-sources';

const checkout = resolve(import.meta.dirname, '../../../..');
let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'conch-tray-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function tray(overrides: Partial<TrayDeps> = {}) {
  let wanted = true;
  const spawned: string[] = [];
  const execs: string[] = [];
  const tokens: string[] = [];
  const service = new TrayService({
    home,
    checkout,
    url: 'http://localhost:4317',
    spec: { node: process.execPath, env: {}, path: '/usr/bin' },
    wanted: async () => wanted,
    setWanted: async (on) => void (wanted = on),
    onToken: (t) => tokens.push(t),
    platform: 'darwin',
    exec: async (file, args): Promise<RunResult> => {
      execs.push([file, ...args].join(' '));
      if (file === 'launchctl') return { stdout: 'Aqua\n', stderr: '', code: 0 };
      if (file === 'xcrun') {
        // A pretend build: the binary appears where swiftc was told to put it.
        const out = args[args.indexOf('-o') + 1] ?? '';
        writeFileSync(out, '#!/bin/sh\n');
      }
      return { stdout: '/Library/Developer/CommandLineTools\n', stderr: '', code: 0 };
    },
    // A process that's alive (this one's parent shell would do; the test's own pid is refused).
    spawn: (file) => (spawned.push(file), process.ppid),
    ...overrides,
  });
  return { service, spawned, execs, tokens, setWanted: (on: boolean) => (wanted = on) };
}

describe('the menu bar helper', () => {
  it('builds once on a Mac, starts, and leaves a running one alone', async () => {
    const { service, spawned, execs, tokens } = tray();
    expect(await service.ensure()).toBe('started');
    expect(execs.filter((e) => e.startsWith('xcrun swiftc'))).toHaveLength(1);
    expect(spawned[0]).toMatch(/Conch Menu\.app\/Contents\/MacOS\/ConchMenu$/);
    expect(await service.ensure()).toBe('running');
    expect(execs.filter((e) => e.startsWith('xcrun swiftc'))).toHaveLength(1);
    // Its token: random, in a file only its owner reads, told to the gate.
    const token = readFileSync(join(home, 'tray', 'token'), 'utf8').trim();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(statSync(join(home, 'tray', 'token')).mode & 0o077).toBe(0);
    expect(tokens).toEqual([token]);
    expect((await service.status()).running).toBe(true);
  });

  it('doesn’t show when it isn’t wanted, or there’s no screen to show it on', async () => {
    const off = tray();
    off.setWanted(false);
    expect(await off.service.ensure()).toBe('off');
    const ssh = tray({ exec: async () => ({ stdout: 'Background\n', stderr: '', code: 0 }) });
    expect(await ssh.service.ensure()).toBe('unavailable');
    expect((await ssh.service.support()).unavailable).toMatch(/nobody logged in/);
    const noTools = tray({
      exec: async (file) =>
        file === 'launchctl'
          ? { stdout: 'Aqua', stderr: '', code: 0 }
          : { stdout: '', stderr: 'no developer tools', code: 2 },
    });
    expect(await noTools.service.support()).toMatchObject({
      available: false,
      need: 'command-line-tools',
    });
  });

  it('on Linux, needs a desktop and AppIndicator', async () => {
    const headless = tray({ platform: 'linux', env: {} });
    expect((await headless.service.support()).unavailable).toMatch(/no desktop/);
    const missing = tray({
      platform: 'linux',
      env: { DISPLAY: ':0' },
      exec: async () => ({ stdout: '', stderr: 'ValueError', code: 1 }),
    });
    expect(await missing.service.support()).toMatchObject({
      available: false,
      need: 'appindicator',
    });
    const ok = tray({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' } });
    expect(await ok.service.ensure()).toBe('started');
    expect(ok.spawned).toEqual(['python3']);
  });

  it('on Windows, runs PowerShell hidden, with the pearl as its icon', async () => {
    const { service, spawned } = tray({ platform: 'win32' });
    expect(await service.ensure()).toBe('started');
    expect(spawned).toEqual(['powershell.exe']);
    expect(readFileSync(join(home, 'tray', 'tray.ps1'), 'utf8')).toContain('NotifyIcon');
    expect(readFileSync(join(home, 'tray', 'conch.ico')).readUInt16LE(2)).toBe(1);
  });

  it('turned off, it goes now; and never kills the gateway itself', async () => {
    const own = tray({ spawn: () => process.pid });
    await own.service.ensure();
    const kill = vi.spyOn(process, 'kill');
    await own.service.set(false);
    expect(kill).not.toHaveBeenCalledWith(process.pid, 'SIGTERM');
    kill.mockRestore();
  });

  it('Repair everything starts it again when it stopped', async () => {
    let alive = false;
    const { service } = tray({ spawn: () => ((alive = true), process.ppid) });
    const signal = new AbortController().signal;
    writeFileSync(join(home, 'dummy'), '');
    expect((await trayCheck(service).run({ repair: false, signal }))[0]?.state).toBe('warning');
    expect((await trayCheck(service).run({ repair: true, signal }))[0]).toMatchObject({
      state: 'fixed',
      message: 'Conch is back in the menu bar.',
    });
    expect(alive).toBe(true);
  });
});

describe('its source', () => {
  const spec = {
    url: 'http://localhost:4317',
    tokenFile: '/h/it"s\\tok',
    startScript: "/h/o'k/start",
  };
  it('quotes paths for each language', () => {
    expect(swiftSource(spec)).toContain('let tokenFile = "/h/it\\"s\\\\tok"');
    expect(powershellSource(spec)).toContain("$startScript = '/h/o''k/start'");
    expect(pythonSource(spec)).toContain('TOKEN_FILE = "/h/it\\"s\\\\tok"');
  });

  it('carries its token in a header, and only ever opens pages for what needs you to confirm', () => {
    for (const source of [swiftSource(spec), powershellSource(spec), pythonSource(spec)]) {
      expect(source).toContain('X-Conch-Tray');
      expect(source).toContain('/?open=background');
      expect(source).not.toMatch(/\/api\/background['"]/);
    }
  });
});

describe('a little computer', () => {
  it('lingers on Linux, and says the command when it needs an administrator', async () => {
    let linger = false;
    const calls: string[] = [];
    const allowed = new AfterLogout({
      platform: 'linux',
      user: 'ada',
      systemd: async () => true,
      exec: async (_f, args) => {
        calls.push(args.join(' '));
        if (args[0] === 'enable-linger') linger = true;
        return { stdout: `Linger=${linger ? 'yes' : 'no'}`, stderr: '', code: 0 };
      },
    });
    expect((await allowed.status()).state).toBe('off');
    expect((await allowed.set(true)).state).toBe('on');
    expect(calls).toContain('enable-linger ada');

    const refused = new AfterLogout({
      platform: 'linux',
      user: 'ada',
      systemd: async () => true,
      exec: async (_f, args) =>
        args[0] === 'enable-linger'
          ? { stdout: '', stderr: 'Access denied', code: 1 }
          : { stdout: 'Linger=no', stderr: '', code: 0 },
    });
    expect(await refused.set(true)).toMatchObject({
      state: 'off',
      command: 'sudo loginctl enable-linger ada',
    });
  });

  it('a Mac and Windows say how to stay logged in; a desktop autostart can’t linger', async () => {
    expect(
      (await new AfterLogout({ platform: 'darwin', systemd: async () => false }).status()).note,
    ).toMatch(/automatic login/);
    expect(
      (await new AfterLogout({ platform: 'win32', systemd: async () => false }).status()).note,
    ).toMatch(/Lock the screen/);
    expect(
      (await new AfterLogout({ platform: 'linux', systemd: async () => false }).status()).state,
    ).toBe('unavailable');
  });

  it('keeps a Mac awake while it runs, and lets go when turned off', () => {
    let started = 0;
    const child = {
      exitCode: null,
      killed: false,
      kill: () => ((child.killed = true), true),
      on: () => child,
      unref: () => undefined,
    };
    const awake = new KeepAwake({ platform: 'darwin', start: () => (started++, child as never) });
    awake.apply(true);
    awake.apply(true);
    expect(started).toBe(1);
    expect(awake.active).toBe(true);
    awake.apply(false);
    expect(child.killed).toBe(true);
    expect(awake.active).toBe(false);
    const linux = new KeepAwake({ platform: 'linux', start: () => (started++, child as never) });
    linux.apply(true);
    expect(started).toBe(1);
  });
});
