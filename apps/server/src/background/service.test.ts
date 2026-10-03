import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pretendBackend, type Backend } from './backends';
import { backgroundCommand, quitCommand, type BackgroundIo } from './cli';
import {
  BackgroundService,
  backgroundDir,
  logFile,
  runningAs,
  waitForTurn,
  waitingPid,
  type BackgroundDeps,
} from './service';

let home: string;
let others: ChildProcess[] = [];
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'conch-bg-'));
});
afterEach(() => {
  for (const child of others) child.kill();
  others = [];
  rmSync(home, { recursive: true, force: true });
});

/** Another process that stays alive: the background Conch, as far as the files say. */
function anotherProcess(): number {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  others.push(child);
  return child.pid ?? 0;
}

/** A backend like the real ones: `start` runs a background Conch that waits for its turn. */
function computer(options: { starts?: boolean; refuses?: string } = {}) {
  const calls: string[] = [];
  let registered = false;
  const backend: Backend = {
    kind: 'launchd',
    place: 'System Settings → General → Login Items',
    async install() {
      if (options.refuses) throw new Error(options.refuses);
      calls.push('install');
      const changed = !registered;
      registered = true;
      return { changed };
    },
    async start() {
      calls.push('start');
      if (options.starts === false) {
        mkdirSync(join(home, 'logs'), { recursive: true });
        writeFileSync(
          logFile(home),
          '--- start\nConch needs Node.js 24 or newer and couldn’t find it.\n',
        );
        return;
      }
      mkdirSync(backgroundDir(home), { recursive: true });
      writeFileSync(
        join(backgroundDir(home), 'waiting.json'),
        JSON.stringify({ pid: anotherProcess() }),
      );
    },
    async remove({ stop }) {
      calls.push(stop ? 'remove+stop' : 'remove');
      registered = false;
    },
    async registered() {
      return registered;
    },
  };
  return { backend, calls };
}

function service(overrides: Partial<BackgroundDeps> = {}) {
  const heal = vi.fn();
  const handover = vi.fn(() => true);
  const deps: BackgroundDeps = {
    home,
    checkout: join(home, 'checkout'),
    running: 'window',
    since: 1,
    backend: computer().backend,
    spec: { node: '/usr/local/bin/node', env: {}, path: '/usr/bin' },
    handover,
    heal,
    waitMs: 1_500,
    platform: 'darwin',
    url: 'http://localhost:4317',
    ...overrides,
  };
  return { service: new BackgroundService(deps), heal, handover };
}

describe('runningAs', () => {
  it('tells the background, a window and a development server apart', () => {
    expect(runningAs({ CONCH_BACKGROUND: '1', CONCH_SUPERVISED: '1' })).toBe('background');
    expect(runningAs({ CONCH_SUPERVISED: '1' })).toBe('window');
    expect(runningAs({})).toBe('dev');
  });

  it('is the app only while the app’s channel is open (ADR 0054)', () => {
    const had = process.send;
    try {
      process.send = (() => true) as typeof process.send;
      expect(
        runningAs({
          CONCH_APP: '/Applications/Conch.app/Contents/MacOS/Conch',
          CONCH_SUPERVISED: '1',
        }),
      ).toBe('app');
      // Started at login by Always on: the app, in the background.
      expect(runningAs({ CONCH_APP: '/x/Conch', CONCH_BACKGROUND: '1' })).toBe('background');
      process.send = undefined;
      // A Conch started from the app's own terminal inherits the variable, not the channel.
      expect(runningAs({ CONCH_APP: '/x/Conch', CONCH_SUPERVISED: '1' })).toBe('window');
    } finally {
      process.send = had;
    }
  });
});

describe('turning it on from the app', () => {
  it('registers the app to start at login, and starts nothing now: the app is already running', async () => {
    const { backend, calls } = computer();
    const { service: bg, handover } = service({
      backend,
      running: 'app',
      spec: {
        node: '/x/node',
        env: {},
        path: '/usr/bin',
        app: '/Applications/Conch.app/Contents/MacOS/Conch',
      },
    });
    const result = await bg.set(true);
    expect(result).toMatchObject({ handover: false, status: { on: true, running: 'app' } });
    expect(result.status.problem).toBeUndefined();
    expect(handover).not.toHaveBeenCalled();
    expect(calls).toEqual(['install']);
    const launcher = readFileSync(join(backgroundDir(home), 'Conch'), 'utf8');
    expect(launcher).toContain("APP='/Applications/Conch.app/Contents/MacOS/Conch'");
    expect(launcher).toContain('exec "$APP" --background');
    expect(launcher).not.toContain('start.ts');
  });

  it('off says Conch runs until the app quits', async () => {
    const { service: bg } = service({ running: 'app' });
    const [item] = await bg
      .doctorCheck()
      .run({ repair: false, signal: new AbortController().signal });
    expect(item?.message).toBe('Conch runs until you quit the app.');
  });
});

describe('turning it on from a window', () => {
  it('hands over once the background Conch is waiting', async () => {
    const { backend, calls } = computer();
    const { service: bg, handover } = service({ backend });
    const result = await bg.set(true);
    expect(result.handover).toBe(true);
    expect(handover).toHaveBeenCalledOnce();
    expect(result.status).toMatchObject({ on: true, supported: true, running: 'window' });
    expect(calls).toEqual(['install', 'start']);
    // The launcher is the owner's alone.
    expect(readFileSync(join(backgroundDir(home), 'Conch'), 'utf8')).toContain('src/start.ts');
  });

  it('keeps this one running, and says why, when the background one doesn’t start', async () => {
    const { backend } = computer({ starts: false });
    const { service: bg, handover } = service({ backend });
    const result = await bg.set(true);
    expect(result.handover).toBe(false);
    expect(handover).not.toHaveBeenCalled();
    expect(result.status.on).toBe(true);
    expect(result.status.problem?.message).toMatch(/couldn’t start in the background just now/);
    expect(result.status.problem?.message).toMatch(/Node\.js 24/);
    expect(result.status.problem?.command).toMatch(/^tail -n 40 /);
  });

  it('says what the computer said when it refuses', async () => {
    const { backend } = computer({ refuses: 'Operation not permitted' });
    const { service: bg } = service({ backend });
    const result = await bg.set(true);
    expect(result.status.on).toBe(false);
    expect(result.status.problem?.message).toMatch(/Operation not permitted/);
  });

  it('answers a second press with the first one’s answer', async () => {
    const { backend, calls } = computer();
    const { service: bg } = service({ backend });
    const [a, b] = await Promise.all([bg.set(true), bg.set(true)]);
    expect(a).toBe(b);
    expect(calls.filter((c) => c === 'start')).toHaveLength(1);
  });

  it('isn’t offered on a development server or without Conch’s folder', async () => {
    expect((await service({ running: 'dev' }).service.status()).supported).toBe(false);
    const noFolder = await service({ checkout: undefined }).service.status();
    expect(noFolder.supported).toBe(false);
    expect(noFolder.unsupported).toMatch(/own folder/);
    const none = await service({ backend: undefined }).service.status();
    expect(none.unsupported).toMatch(/no way/);
  });

  it('says what only works while Conch runs', async () => {
    const { service: bg } = service({
      needed: async () => 'Your routine only runs while Conch is running.',
    });
    expect((await bg.status()).needed).toMatch(/routine/);
  });
});

describe('turning it off', () => {
  it('never stops the background Conch you’re using', async () => {
    const { backend, calls } = computer();
    const { service: bg } = service({ backend, running: 'background' });
    await bg.set(true);
    expect(calls).toEqual(['install']);
    const result = await bg.set(false);
    expect(calls).toContain('remove');
    expect(calls).not.toContain('remove+stop');
    expect(result.status).toMatchObject({ on: false, running: 'background' });
    // Its launcher stays for a restart after a crash, until you log out.
    expect(existsSync(join(backgroundDir(home), 'Conch'))).toBe(true);
  });

  it('from a window, stops the one waiting for its turn', async () => {
    const { backend, calls } = computer();
    const { service: bg } = service({ backend, handover: () => false });
    await bg.set(true);
    const waiting = await waitingPid(home);
    expect(waiting).toBeTypeOf('number');
    await bg.set(false);
    expect(calls).toContain('remove+stop');
    await vi.waitFor(() =>
      expect(others[0]?.exitCode !== null || others[0]?.signalCode).toBeTruthy(),
    );
    expect(existsSync(backgroundDir(home))).toBe(false);
  });
});

describe('healing', () => {
  it('rewrites the launcher when Node moved, and says so once', async () => {
    const { backend } = computer();
    const first = service({ backend, handover: () => true });
    await first.service.set(true);
    const moved = service({
      backend,
      spec: { node: '/opt/homebrew/bin/node', env: {}, path: '/usr/bin' },
    });
    expect(await moved.service.heal()).toBe('fixed');
    expect(moved.heal).toHaveBeenCalledOnce();
    expect(readFileSync(join(backgroundDir(home), 'Conch'), 'utf8')).toContain(
      '/opt/homebrew/bin/node',
    );
    expect(await moved.service.heal()).toBe('ok');
    expect(moved.heal).toHaveBeenCalledOnce();
  });

  it('writes a missing launcher again', async () => {
    const { backend } = computer();
    const { service: bg, heal } = service({ backend });
    await bg.set(true);
    rmSync(backgroundDir(home), { recursive: true, force: true });
    expect(await bg.heal()).toBe('fixed');
    expect(heal.mock.calls[0]?.[0]).toMatch(/missing/);
  });

  it('leaves everything alone when it’s off', async () => {
    const { service: bg } = service();
    expect(await bg.heal()).toBe('off');
    expect(existsSync(backgroundDir(home))).toBe(false);
  });
});

describe('Repair everything', () => {
  const run = async (bg: BackgroundService, repair = false) =>
    (await bg.doctorCheck().run({ repair, signal: new AbortController().signal }))[0];

  it('is quiet when off and nothing needs it', async () => {
    expect(await run(service().service)).toMatchObject({ state: 'off' });
  });

  it('suggests it when a routine or a chat app needs Conch running', async () => {
    const item = await run(
      service({ needed: async () => 'Telegram only works while Conch is running.' }).service,
    );
    expect(item).toMatchObject({
      state: 'warning',
      message: 'Telegram only works while Conch is running.',
      action: { kind: 'open', place: 'health', focus: 'background' },
    });
  });

  it('is ok when on, and fixed after a repair that rewrote something', async () => {
    const { backend } = computer();
    await service({ backend }).service.set(true);
    expect(await run(service({ backend }).service)).toMatchObject({ state: 'ok' });
    const moved = service({ backend, spec: { node: '/elsewhere/node', env: {}, path: '' } });
    expect(await run(moved.service, true)).toMatchObject({ state: 'fixed' });
  });

  it('needs you when the computer turned it off', async () => {
    const backend = {
      ...pretendBackend(),
      kind: 'launchd' as const,
      registered: async () => true,
      disabled: async () => ({ message: 'Turned off in Login Items.', command: 'open x' }),
    };
    expect(await run(service({ backend }).service)).toMatchObject({
      state: 'needs-you',
      action: { kind: 'command', command: 'open x' },
    });
  });
});

describe('waitForTurn', () => {
  it('says it’s waiting, and stops waiting when the place is free', async () => {
    let tries = 0;
    let free = false;
    const waited = waitForTurn(home, async () => (tries++, free), { every: 10 });
    await vi.waitFor(() =>
      expect(existsSync(join(backgroundDir(home), 'waiting.json'))).toBe(true),
    );
    await vi.waitFor(() => expect(tries).toBeGreaterThan(2));
    free = true;
    await waited;
    expect(existsSync(join(backgroundDir(home), 'waiting.json'))).toBe(false);
  });

  it('only counts a waiting Conch that’s alive and isn’t this one', async () => {
    mkdirSync(backgroundDir(home), { recursive: true });
    const file = join(backgroundDir(home), 'waiting.json');
    writeFileSync(file, JSON.stringify({ pid: process.pid }));
    expect(await waitingPid(home)).toBeUndefined();
    writeFileSync(file, JSON.stringify({ pid: 2 ** 22 + 12345 }));
    expect(await waitingPid(home)).toBeUndefined();
    writeFileSync(file, 'not json');
    expect(await waitingPid(home)).toBeUndefined();
  });
});

describe('pnpm conch background', () => {
  const io = (overrides: Partial<BackgroundIo> = {}) => {
    const lines: string[] = [];
    const plain = (s: string) => s;
    const value: BackgroundIo = {
      say: (line = '') => lines.push(line),
      bold: plain,
      dim: plain,
      green: plain,
      yellow: plain,
      running: async () => undefined,
      answering: async () => true,
      url: async () => 'http://localhost:4317',
      lastWords: async () => undefined,
      kill: () => undefined,
      sleep: async () => undefined,
      waitMs: 10,
      ...overrides,
    };
    return { value, lines };
  };

  it('on: starts it and says where it is', async () => {
    const { backend, calls } = computer();
    const { value, lines } = io();
    expect(await backgroundCommand(['on'], service({ backend }).service, value)).toBe(0);
    expect(calls).toEqual(['install', 'start']);
    expect(lines.join('\n')).toMatch(/running in the background at http:\/\/localhost:4317/);
  });

  it('on, with Conch open in a window: carries on when the window closes', async () => {
    const { backend } = computer();
    const { value, lines } = io({ running: async () => ({ pid: 1, port: 4317 }) });
    expect(await backgroundCommand(['on'], service({ backend }).service, value)).toBe(0);
    expect(lines.join('\n')).toMatch(/Close that window/);
  });

  it('on: says what Conch said when it didn’t start', async () => {
    const { backend } = computer({ starts: false });
    const { value, lines } = io({
      answering: async () => false,
      lastWords: async () => 'Conch needs Node.js 24 or newer',
    });
    expect(await backgroundCommand(['on'], service({ backend }).service, value)).toBe(1);
    expect(lines.join('\n')).toMatch(/It said: Conch needs Node\.js 24/);
  });

  it('status and off', async () => {
    const { backend } = computer();
    const bg = service({ backend, running: 'background' }).service;
    await bg.enable();
    const status = io({ running: async () => ({ pid: 1, port: 4317, background: true }) });
    await backgroundCommand(['status'], bg, status.value);
    expect(status.lines.join('\n')).toMatch(/On: Conch starts by itself/);
    expect(status.lines.join('\n')).toMatch(/Running in the background now/);
    const off = io({ running: async () => ({ pid: 1, port: 4317, background: true }) });
    await backgroundCommand(['off'], bg, off.value);
    expect(off.lines.join('\n')).toMatch(/keeps running until you quit it/);
  });

  it('quit: stops the running Conch', async () => {
    let alive = true;
    const killed: number[] = [];
    const { value, lines } = io({
      running: async () => (alive ? { pid: 42, port: 4317, background: true } : undefined),
      kill: (pid) => {
        killed.push(pid);
        alive = false;
      },
    });
    expect(await quitCommand(value)).toBe(0);
    expect(killed).toEqual([42]);
    expect(lines.join('\n')).toMatch(/has stopped/);
  });
});

describe('lastWords', () => {
  it('says what the launcher or the gateway said last, in words', async () => {
    const { lastWords } = await import('./service');
    mkdirSync(join(home, 'logs'), { recursive: true });
    writeFileSync(
      logFile(home),
      '--- 2026 Conch is starting\n{"level":50,"msg":"Port 4317 was taken just as Conch started."}\n',
    );
    expect(await lastWords(home)).toBe('Port 4317 was taken just as Conch started.');
    writeFileSync(logFile(home), 'Conch needs Node.js 24 or newer\n--- next\n');
    expect(await lastWords(home)).toBe('Conch needs Node.js 24 or newer');
    rmSync(logFile(home));
    expect(await lastWords(home)).toBeUndefined();
  });
});
