import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunResult } from '../lib/proc';
import { AfterLogout, KeepAwake } from './little';
import { startHelper, trayCheck, trayIconIn, TrayService, type TrayDeps } from './tray';
import { powershellSource, pythonSource, swiftSource } from './tray-sources';

const checkout = resolve(import.meta.dirname, '../../../..');

/** How solid one pixel of an 8-bit RGBA PNG is (0 see-through, 255 solid). */
function alphaAt(png: Buffer, x: number, y: number): number {
  const stride = png.readUInt32BE(16) * 4;
  const data: Buffer[] = [];
  for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at))
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT')
      data.push(png.subarray(at + 8, at + 8 + png.readUInt32BE(at)));
  const raw = inflateSync(Buffer.concat(data));
  let above = Buffer.alloc(stride);
  for (let row = 0; row <= y; row++) {
    const start = row * (stride + 1);
    const line = Buffer.from(raw.subarray(start + 1, start + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = line[i - 4] ?? 0;
      const b = above[i] ?? 0;
      const c = above[i - 4] ?? 0;
      const [da, db, dc] = [Math.abs(b - c), Math.abs(a - c), Math.abs(a + b - 2 * c)];
      const paeth = da <= db && da <= dc ? a : db <= dc ? b : c;
      line[i] = ((line[i] ?? 0) + ([0, a, b, (a + b) >> 1, paeth][raw[start] ?? 0] ?? 0)) & 0xff;
    }
    above = line;
  }
  return above[x * 4 + 3] ?? -1;
}
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
    settle: 0,
    ...overrides,
  });
  return { service, spawned, execs, tokens, setWanted: (on: boolean) => (wanted = on) };
}

describe('the menu bar helper', () => {
  it('builds once on a Mac, starts, and leaves a running one alone', async () => {
    const { service, spawned, execs, tokens } = tray();
    expect(await service.ensure()).toBe('started');
    expect(execs.filter((e) => e.startsWith('xcrun swiftc'))).toHaveLength(1);
    expect(spawned[0]).toMatch(/Conch Menu\.app[\\/]Contents[\\/]MacOS[\\/]ConchMenu$/);
    expect(await service.ensure()).toBe('running');
    expect(execs.filter((e) => e.startsWith('xcrun swiftc'))).toHaveLength(1);
    // Its token: random, in a file only its owner reads, told to the gate.
    const token = readFileSync(join(home, 'tray', 'token'), 'utf8').trim();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (process.platform !== 'win32')
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
    expect(
      readFileSync(join(home, 'tray', 'conch.png')).equals(readFileSync(trayIconIn(checkout))),
    ).toBe(true);
  });

  it('on Windows, runs PowerShell hidden, with the pearl as its icon', async () => {
    const { service, spawned } = tray({ platform: 'win32' });
    expect(await service.ensure()).toBe('started');
    expect(spawned).toEqual(['powershell.exe']);
    expect(readFileSync(join(home, 'tray', 'tray.ps1'), 'utf8')).toContain('NotifyIcon');
    expect(readFileSync(join(home, 'tray', 'conch.ico')).readUInt16LE(2)).toBe(1);
  });

  it('its picture is the pearl alone: as big as its square allows, on nothing', async () => {
    const { service } = tray({ platform: 'win32' });
    await service.ensure();
    const png = readFileSync(join(home, 'tray', 'conch.ico')).subarray(22);
    // 256 px square, with see-through pixels (colour type 6).
    expect([png.readUInt32BE(16), png.readUInt32BE(20), png[25]]).toEqual([256, 256, 6]);
    // The corners show the taskbar; the pearl reaches every edge.
    for (const [x, y] of [
      [0, 0],
      [255, 0],
      [0, 255],
      [255, 255],
    ] as const)
      expect(alphaAt(png, x, y)).toBe(0);
    for (const [x, y] of [
      [128, 3],
      [128, 252],
      [3, 128],
      [252, 128],
      [128, 128],
    ] as const)
      expect(alphaAt(png, x, y)).toBeGreaterThan(250);
  });

  it('a new picture replaces the helper that’s showing the old one', async () => {
    // A checkout of its own, so the picture can change; and helpers that can really be ended.
    const mine = join(home, 'checkout');
    mkdirSync(join(mine, 'apps', 'web', 'public', 'icons'), { recursive: true });
    const picture = readFileSync(trayIconIn(checkout));
    writeFileSync(trayIconIn(mine), picture);
    const helpers: ChildProcess[] = [];
    const { service } = tray({
      platform: 'win32',
      checkout: mine,
      spawn: () => {
        const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
          stdio: 'ignore',
        });
        helpers.push(child);
        return child.pid;
      },
    });
    try {
      expect(await service.ensure()).toBe('started');
      expect(await service.ensure()).toBe('running');
      writeFileSync(trayIconIn(mine), Buffer.concat([picture, Buffer.from('new')]));
      expect(await service.ensure()).toBe('started');
      expect(helpers).toHaveLength(2);
      await vi.waitFor(() =>
        expect(helpers[0]?.exitCode ?? helpers[0]?.signalCode ?? null).not.toBeNull(),
      );
    } finally {
      for (const helper of helpers) helper.kill();
    }
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

  it('one that leaves straight away isn’t called started, and Repair everything doesn’t say fixed', async () => {
    // The pid of a program that has already gone.
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    const { service } = tray({ spawn: () => gone });
    expect(await service.ensure()).toBe('failed');
    expect((await service.status()).running).toBe(false);
    const signal = new AbortController().signal;
    expect((await trayCheck(service).run({ repair: true, signal }))[0]).toMatchObject({
      state: 'warning',
      message: 'Conch couldn’t show itself in the menu bar. It tries again by itself.',
    });
  });
});

// Really started, on a real Windows: a pretend spawn can't tell whether the helper stays.
describe.runIf(process.platform === 'win32')('started for real on Windows', () => {
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it('PowerShell runs the helper and stays, from a folder with spaces and quotes in its name', async () => {
    const dir = join(home, "Ada's folder (x86) & $co");
    mkdirSync(dir);
    const ran = join(dir, 'ran');
    const script = join(dir, 'helper.ps1');
    writeFileSync(
      script,
      [
        `"tray=$env:CONCH_TRAY" | Out-File -Encoding ascii -FilePath '${ran.replaceAll("'", "''")}'`,
        'Start-Sleep -Seconds 60',
        '',
      ].join('\r\n'),
    );
    const pid = await startHelper(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
      ],
      { CONCH_TRAY: '1' },
    );
    try {
      expect(pid).toBeGreaterThan(0);
      await vi.waitFor(() => expect(readFileSync(ran, 'utf8')).toContain('tray=1'), {
        timeout: 15_000,
        interval: 200,
      });
      expect(alive(pid ?? 0)).toBe(true);
    } finally {
      if (pid && alive(pid)) process.kill(pid);
    }
  }, 30_000);
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
