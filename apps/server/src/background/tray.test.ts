import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunResult } from '../lib/proc';
import { AfterLogout, KeepAwake } from './little';
import { askUrl, startHelper, trayCheck, trayIconIn, TrayService, type TrayDeps } from './tray';
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

  it('on Windows, asks Conch by number, and still opens its pages by name', async () => {
    const { service } = tray({ platform: 'win32', ask: askUrl('127.0.0.1', 4317) });
    await service.ensure();
    const script = readFileSync(join(home, 'tray', 'tray.ps1'), 'utf8');
    expect(script).toContain("$api = 'http://127.0.0.1:4317'");
    expect(script).toContain("$base = 'http://localhost:4317'");
    // Wherever Conch listens on this computer, a number: a name is tried as ::1 first.
    expect(askUrl('0.0.0.0', 4317)).toBe('http://127.0.0.1:4317');
    expect(askUrl('127.0.0.2', 4400)).toBe('http://127.0.0.2:4400');
    expect(askUrl('::1', 4317)).toBe('http://[::1]:4317');
    expect(askUrl('::', 4317)).toBe('http://[::1]:4317');
    expect(askUrl('localhost', 4317)).toBe('http://localhost:4317');
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
      state: 'info',
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

  it('Windows PowerShell reads the helper whole: no mistakes, and its words as they were written', () => {
    const script = join(home, 'tray.ps1');
    writeFileSync(
      script,
      powershellSource({
        url: 'http://localhost:4317',
        ask: 'http://127.0.0.1:4317',
        tokenFile: join(home, 'token'),
        asksDir: join(home, 'asks'),
        startScript: join(home, 'start.cmd'),
      }),
    );
    // Read, not run: nothing lands in this computer's tray.
    const read = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        [
          '$tokens = $null; $errors = $null',
          '[void][System.Management.Automation.Language.Parser]::ParseFile($env:CONCH_READ, [ref]$tokens, [ref]$errors)',
          '$words = @($tokens | Where-Object { $_.Kind -like "String*" } | ForEach-Object { $_.Text }) -join " "',
          '"mistakes=$($errors.Count) apostrophes=$($words.Contains([string][char]0x2019)) garbled=$($words.Contains([string][char]0xE2))"',
        ].join('; '),
      ],
      { env: { ...process.env, CONCH_READ: script }, windowsHide: true },
    ).toString();
    expect(read.trim()).toBe('mistakes=0 apostrophes=True garbled=False');
  }, 30_000);
  it('asks a Conch that listens on 127.0.0.1, without the menu waiting, and reads its name as written', async () => {
    // A pretend Conch, listening the way the real one does.
    const asked: string[] = [];
    const server = createServer((request, response) => {
      asked.push(`${request.url ?? ''} ${String(request.headers['x-conch-tray'])}`);
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(
        JSON.stringify({ name: 'Perle café', alwaysOn: false, approvals: 0, devices: 0 }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    writeFileSync(join(home, 'token'), 'its-token\n');
    const said = join(home, 'said');
    const script = join(home, 'tray.ps1');
    // The helper as Conch writes it, but never shown: it says what its tooltip would, and leaves.
    const source = powershellSource({
      url: `http://localhost:${port}`,
      ask: askUrl('127.0.0.1', port),
      tokenFile: join(home, 'token'),
      asksDir: join(home, 'asks'),
      startScript: join(home, 'start.cmd'),
    })
      .replace('$icon.Visible = $true', '$icon.Visible = $false')
      .replace(
        '[System.Windows.Forms.Application]::Run()',
        [
          '$leave = New-Object System.Windows.Forms.Timer',
          '$leave.Interval = 4000',
          `$leave.add_Tick({ "$($icon.Text)|$($script:info.name)" | Out-File -Encoding utf8 '${said}'; [System.Windows.Forms.Application]::Exit() })`,
          '$leave.Start()',
          '[System.Windows.Forms.Application]::Run()',
        ].join('\r\n'),
      );
    expect(source).toContain('$icon.Visible = $false');
    expect(source).toContain('$leave.Start()');
    writeFileSync(script, source);
    try {
      const helper = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { stdio: 'ignore', windowsHide: true },
      );
      // An answer that came back on the wrong thread ends PowerShell on the spot.
      expect(await new Promise((resolve) => helper.on('exit', resolve))).toBe(0);
    } finally {
      server.close();
    }
    expect(
      readFileSync(said, 'utf8')
        .replace(/^\uFEFF/, '')
        .trim(),
    ).toBe('Conch is running|Perle café');
    expect(asked[0]).toBe('/api/tray/status its-token');
  }, 40_000);
});

describe('its source', () => {
  const spec = {
    url: 'http://localhost:4317',
    tokenFile: '/h/it"s\\tok',
    asksDir: '/h/asks',
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
      // Pages open as this computer, asked for in a folder only you can write (ADR 0063):
      // the token goes over the network, so it never opens anything itself.
      expect(source).toContain('/h/asks');
      expect(source).toContain('.ask');
      expect(source).not.toContain('/api/tray/open');
      expect(source).not.toContain('/api/here/link');
    }
  });

  it('says when a new release is ready, and opens Updates for it (never updates by itself)', () => {
    for (const source of [swiftSource(spec), powershellSource(spec), pythonSource(spec)]) {
      expect(source).toContain('/?open=updates');
      expect(source).toContain('What’s new');
      expect(source).not.toContain('/api/updates');
    }
  });

  it('offers no way to hide itself: showing it is a switch in Settings', () => {
    for (const source of [swiftSource(spec), powershellSource(spec), pythonSource(spec)]) {
      expect(source).not.toMatch(/Hide from/);
      expect(source).not.toContain('/api/tray/hide');
    }
  });

  it('on Windows, never keeps the menu waiting for an answer', () => {
    const source = powershellSource({ ...spec, ask: 'http://127.0.0.1:4317' });
    // How things are is asked in the background; the menu is Windows' own, put together as it opens.
    expect(source).toContain('DownloadStringAsync');
    const refresh = source.slice(source.indexOf('function Refresh {'));
    expect(refresh.slice(0, refresh.indexOf('\r\n}'))).not.toContain('Invoke-RestMethod');
    expect(source).toContain('$menu = New-Object System.Windows.Forms.ContextMenu\r\n');
    expect(source).toContain('$menu.add_Popup({ Build })');
    // Windows PowerShell reads a file without this mark in the computer's old code page.
    expect(source.charCodeAt(0)).toBe(0xfeff);
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

describe('in the desktop app (ADR 0054)', () => {
  it('shows and hides the app’s own icon, and builds no helper', async () => {
    const home = mkdtempSync(join(tmpdir(), 'conch-tray-app-'));
    try {
      let wanted = true;
      const shown: boolean[] = [];
      const spawned: string[] = [];
      const tray = new TrayService({
        home,
        url: 'http://127.0.0.1:4317',
        spec: { node: process.execPath, env: {}, path: '/usr/bin' },
        wanted: async () => wanted,
        setWanted: async (on) => void (wanted = on),
        onToken: () => undefined,
        platform: 'linux',
        env: {},
        spawn: (file) => void spawned.push(file),
        app: { show: async (on) => (shown.push(on), true) },
      });
      // Linux with no desktop variable still has the app's own icon.
      expect(await tray.status()).toMatchObject({ available: true, on: true, running: true });
      expect(await tray.ensure()).toBe('running');
      expect((await tray.set(false)).running).toBe(false);
      expect(shown).toEqual([true, false]);
      expect(spawned).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
