import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveRecoveryState } from './recovery/supervisor-state';
import {
  gatewayLaunch,
  nextStep,
  nodeFlags,
  RESTART_CODE,
  shouldSupervise,
  supervise,
} from './supervisor';
import { point, prove, readState, swapIn, writeState } from './updates/layout';

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
/** A CONCH_HOME of its own, so no test reads the versions of whoever runs it. */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'conch-supervise-'));
  homes.push(home);
  return home;
}

describe('keeping Conch running', () => {
  it('supervises only when started for real, and never twice', () => {
    expect(shouldSupervise({ CONCH_SUPERVISE: '1' })).toBe(true);
    expect(shouldSupervise({ CONCH_SUPERVISE: '1', CONCH_SUPERVISED: '1' })).toBe(false);
    expect(shouldSupervise({})).toBe(false);
  });

  it('starts it again at once when it asks, and after a crash with backoff', () => {
    expect(nextStep(RESTART_CODE, null, [], 0, false)).toEqual({
      kind: 'restart',
      delay: 0,
      crashed: false,
    });
    expect(nextStep(1, null, [], 0, false)).toMatchObject({ kind: 'restart', crashed: true });
    expect(nextStep(1, null, [0, 1, 2], 10, false)).toMatchObject({ delay: 30_000 });
  });

  it('stops when you stop it, when it ends cleanly, or when it keeps crashing', () => {
    expect(nextStep(1, null, [], 0, true)).toEqual({ kind: 'exit', code: 1 });
    expect(nextStep(0, null, [], 0, false)).toEqual({ kind: 'exit', code: 0 });
    const now = 1_000_000;
    expect(nextStep(1, null, [now - 5, now - 4, now - 3, now - 2, now - 1], now, false)).toEqual({
      kind: 'exit',
      code: 1,
    });
    // Old crashes don't count.
    expect(nextStep(1, null, [0, 1, 2, 3, 4], now + 11 * 60_000, false).kind).toBe('restart');
  });

  it('runs the gateway again with the same Node and flags, saying why it started', async () => {
    const codes = [RESTART_CODE, 7, 0];
    const started: NodeJS.ProcessEnv[] = [];
    const spawn = vi.fn((_cmd: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      started.push(options.env);
      const child = new EventEmitter();
      const code = codes.shift();
      queueMicrotask(() => child.emit('exit', code, null));
      return child;
    });
    const exit = vi.fn((code: number) => {
      throw Object.assign(new Error('exit'), { code });
    });
    await expect(
      supervise({
        spawn: spawn as never,
        exit: exit as never,
        log: () => undefined,
        sleep: async () => undefined,
        home: tempHome(),
      }),
    ).rejects.toMatchObject({ code: 0 });
    expect(spawn.mock.calls[0]?.[0]).toBe(process.execPath);
    expect(started.map((env) => env.CONCH_STARTED_BECAUSE)).toEqual(['start', 'restart', 'crash']);
    expect(started.every((env) => env.CONCH_SUPERVISED === '1')).toBe(true);
  });
});

/** A folder that looks like a Conch to start (ADR 0051). */
function version(home: string, name: string): string {
  const folder = join(home, 'versions', name);
  mkdirSync(join(folder, 'apps', 'server', 'src'), { recursive: true });
  writeFileSync(join(folder, 'apps', 'server', 'src', 'start.ts'), '');
  return folder;
}

describe('starting the version swapped in, and going back when it fails', () => {
  it('leaves out tsx’s own loaders, which belong to another folder', () => {
    expect(
      nodeFlags([
        '--require',
        '/a/node_modules/tsx/dist/preflight.cjs',
        '--import',
        'file:///a/node_modules/tsx/dist/loader.mjs',
        '--max-old-space-size=4096',
        '--import=tsx',
      ]),
    ).toEqual(['--max-old-space-size=4096']);
  });

  it('starts from the pointer’s folder, or as it was started without one', () => {
    const home = tempHome();
    expect(gatewayLaunch(home, ['--import', 'tsx'], ['node', 'src/start.ts'])).toEqual({
      args: ['--import', 'tsx', 'src/start.ts'],
    });
    const next = version(home, '0.3.0');
    point(home, next);
    expect(gatewayLaunch(home, ['--import', 'tsx'], ['node', 'src/start.ts'])).toEqual({
      args: ['--import', 'tsx', join('src', 'start.ts')],
      cwd: join(next, 'apps', 'server'),
      folder: next,
    });
    // A pointer at something that isn't a Conch is passed over.
    point(home, join(home, 'gone'));
    expect(gatewayLaunch(home, [], ['node', 'x.ts']).folder).toBeUndefined();
  });

  /** A pretend gateway: does what `act` says when started, from the folder it was started in. */
  function world(
    act: (cwd: string, child: EventEmitter & { kill: () => void }, home: string) => void,
  ) {
    const home = tempHome();
    const old = version(home, '0.2.0');
    const next = version(home, '0.3.0');
    writeState(home, { current: { folder: old, version: '0.2.0' }, failed: [] });
    swapIn(home, { folder: next, version: '0.3.0' }, { folder: old, version: '0.2.0' });
    const cwds: string[] = [];
    const roots: (string | undefined)[] = [];
    const spawn = vi.fn(
      (_cmd: string, _args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv }) => {
        const child = Object.assign(new EventEmitter(), {
          kill: () => queueMicrotask(() => child.emit('exit', null, 'SIGTERM')),
        });
        cwds.push(options.cwd ?? '');
        roots.push(options.env.CONCH_RELEASE_ROOT);
        // Stop after the third start, cleanly.
        if (cwds.length >= 3) queueMicrotask(() => child.emit('exit', 0, null));
        else act(options.cwd ?? '', child, home);
        return child;
      },
    );
    const logs: string[] = [];
    const run = supervise({
      spawn: spawn as never,
      exit: ((code: number) => {
        throw Object.assign(new Error('exit'), { code });
      }) as never,
      log: (m) => logs.push(m),
      sleep: async () => undefined,
      home,
      proveWithinMs: 200,
      lookEveryMs: 10,
    });
    return { home, old, next, cwds, roots, logs, run };
  }

  it('goes back to the version before when the new one stops before answering', async () => {
    const { home, old, next, cwds, roots, logs, run } = world((cwd, child) => {
      if (cwd.includes('0.3.0')) queueMicrotask(() => child.emit('exit', 1, null));
      else queueMicrotask(() => child.emit('exit', RESTART_CODE, null));
    });
    await expect(run).rejects.toMatchObject({ code: 0 });
    expect(cwds[0]).toBe(join(next, 'apps', 'server'));
    expect(roots[0]).toBe(next);
    // At once, from the folder that worked.
    expect(cwds[1]).toBe(join(old, 'apps', 'server'));
    expect(logs.join('')).toContain(
      'Conch 0.3.0 didn’t start properly, so Conch went back to 0.2.0.',
    );
    const state = readState(home);
    expect(state.failed).toEqual(['0.3.0']);
    expect(state.current).toEqual({ folder: old, version: '0.2.0' });
    expect(state.pending).toBeUndefined();
    expect(state.wentBack).toMatchObject({ version: '0.3.0', to: '0.2.0' });
  });

  it('goes back when the new one runs but never answers', async () => {
    const { home, old, cwds, run } = world((cwd, child) => {
      // 0.3.0 hangs; the old one asks for a restart, then the third start ends.
      if (!cwd.includes('0.3.0')) queueMicrotask(() => child.emit('exit', RESTART_CODE, null));
    });
    await expect(run).rejects.toMatchObject({ code: 0 });
    expect(cwds[1]).toBe(join(old, 'apps', 'server'));
    expect(readState(home).failed).toEqual(['0.3.0']);
  });

  it('keeps the new version once it’s answering', async () => {
    const { home, next, cwds, run } = world((cwd, child, at) => {
      prove(at, cwd.replace(/[\\/]apps[\\/]server$/, ''));
      setTimeout(() => child.emit('exit', RESTART_CODE, null), 50);
    });
    await expect(run).rejects.toMatchObject({ code: 0 });
    expect(cwds.slice(0, 2)).toEqual([join(next, 'apps', 'server'), join(next, 'apps', 'server')]);
    const state = readState(home);
    expect(state.current?.version).toBe('0.3.0');
    expect(state.previous?.version).toBe('0.2.0');
    expect(state.failed).toEqual([]);
  });
});

describe('recovering without restarting forever', () => {
  it('remembers failures across supervisor launches and starts with less background work', async () => {
    const home = tempHome();
    const started: NodeJS.ProcessEnv[] = [];
    const codes = [1, 1, 1, 0, 0];
    const spawn = vi.fn((_cmd: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      started.push(options.env);
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', codes.shift(), null));
      return child;
    });
    const deps = {
      home,
      spawn: spawn as never,
      log: () => undefined,
      sleep: async () => undefined,
      exit: ((code: number) => {
        throw Object.assign(new Error('exit'), { code });
      }) as never,
    };
    const listeners = process.listenerCount('SIGTERM');
    await expect(supervise(deps)).rejects.toMatchObject({ code: 0 });
    await expect(supervise(deps)).rejects.toMatchObject({ code: 0 });
    expect(started.map((env) => env.CONCH_RECOVERY_MODE)).toEqual(['0', '0', '0', '1', '1']);
    expect(process.listenerCount('SIGTERM')).toBe(listeners);
  });

  it('cools down an exhausted durable budget before starting, keeping waits interruptible', async () => {
    const home = tempHome();
    let now = 1_000_000;
    saveRecoveryState(home, {
      failures: [now - 50, now - 40, now - 30, now - 20, now - 10, now],
      incidents: [],
    });
    const waited: number[] = [];
    const spawn = vi.fn((_cmd: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      expect(now).toBeGreaterThanOrEqual(1_599_950);
      expect(options.env.CONCH_RECOVERY_MODE).toBe('1');
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    });
    await expect(
      supervise({
        home,
        now: () => now,
        spawn: spawn as never,
        log: () => undefined,
        sleep: async (ms) => {
          waited.push(ms);
          now += ms;
        },
        exit: ((code: number) => {
          throw Object.assign(new Error('exit'), { code });
        }) as never,
      }),
    ).rejects.toMatchObject({ code: 0 });
    expect(spawn).toHaveBeenCalledOnce();
    expect(Math.max(...waited)).toBeLessThanOrEqual(1_000);
  });

  it('backs off repeated requested restarts and enters recovery mode', async () => {
    const codes = [RESTART_CODE, RESTART_CODE, RESTART_CODE, RESTART_CODE, RESTART_CODE, 0];
    const modes: (string | undefined)[] = [];
    const slept: number[] = [];
    const spawn = vi.fn((_cmd: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      modes.push(options.env.CONCH_RECOVERY_MODE);
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', codes.shift(), null));
      return child;
    });
    await expect(
      supervise({
        home: tempHome(),
        spawn: spawn as never,
        log: () => undefined,
        sleep: async (ms) => {
          slept.push(ms);
        },
        exit: ((code: number) => {
          throw Object.assign(new Error('exit'), { code });
        }) as never,
      }),
    ).rejects.toMatchObject({ code: 0 });
    expect(slept).toEqual([1_000, 3_000, 10_000]);
    expect(modes).toEqual(['0', '0', '0', '0', '0', '1']);
  });

  it('restarts a frozen gateway even when its graceful shutdown exits zero', async () => {
    let starts = 0;
    const reasons: (string | undefined)[] = [];
    const spawn = vi.fn((_cmd: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      reasons.push(options.env.CONCH_STARTED_BECAUSE);
      const child = Object.assign(new EventEmitter(), {
        kill: () => queueMicrotask(() => child.emit('exit', 0, null)),
      });
      if (++starts === 2) queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    });
    await expect(
      supervise({
        home: tempHome(),
        spawn: spawn as never,
        log: () => undefined,
        sleep: async () => undefined,
        watchdog: { startupMs: 10, pollMs: 5, recoverMs: 10, stopMs: 10 },
        exit: ((code: number) => {
          throw Object.assign(new Error('exit'), { code });
        }) as never,
      }),
    ).rejects.toMatchObject({ code: 0 });
    expect(reasons).toEqual(['start', 'crash']);
  });
});
