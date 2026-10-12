import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveRecoveryState } from './recovery/supervisor-state';
import {
  gatewayLaunch,
  legacyProofWindow,
  nextStep,
  nodeFlags,
  restartNotice,
  RESTART_CODE,
  shouldAdoptSupervisor,
  shouldSupervise,
  stopWindowsGateway,
  supervise,
} from './supervisor';
import { point, prove, readState, swapIn, writeState } from './updates/layout';

const homes: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
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

  it('adopts only legacy supervised children, never modern IPC or desktop gateways', () => {
    const legacy = { CONCH_SUPERVISE: '1', CONCH_SUPERVISED: '1' };
    expect(shouldAdoptSupervisor(legacy, false)).toBe(true);
    expect(shouldAdoptSupervisor(legacy, true)).toBe(false);
    expect(shouldAdoptSupervisor({ CONCH_SUPERVISE: '1' }, false)).toBe(false);
    expect(shouldAdoptSupervisor({ CONCH_SUPERVISED: '1' }, false)).toBe(false);
    expect(shouldAdoptSupervisor({}, false)).toBe(false);
    expect(shouldAdoptSupervisor({ ...legacy, CONCH_APP: '/Conch.app' }, false)).toBe(false);
  });

  it('leaves shutdown and a margin before the old parent’s first release deadline', () => {
    expect(legacyProofWindow(1_000, 1_000)).toBe(70_000);
    expect(legacyProofWindow(1_000, 21_000)).toBe(50_000);
    expect(legacyProofWindow(1_000, 91_000)).toBe(0);
    // A future timestamp cannot extend the legacy parent's real startup allowance.
    expect(legacyProofWindow(1_000_000, 0)).toBe(70_000);
    expect(legacyProofWindow(1_000, 1_000, 5_000)).toBe(80_000);
  });

  it.each(['restart', 'crash', 'invalid'])(
    'preserves the adopted reason %s and uses durable recovery state',
    async (reason) => {
      vi.stubEnv('CONCH_STARTED_BECAUSE', reason);
      vi.stubEnv('CONCH_RECOVERY_MODE', '0');
      vi.stubEnv('CONCH_SUPERVISOR_ROOT', '/legacy/conch');
      const home = tempHome();
      saveRecoveryState(home, { recoveryMode: true, failures: [], incidents: [] });
      const spawn = vi.fn(
        (_cmd: string, _args: string[], options: { env: NodeJS.ProcessEnv; stdio: string[] }) => {
          expect(options.env.CONCH_STARTED_BECAUSE).toBe(reason === 'invalid' ? 'start' : reason);
          expect(options.env.CONCH_RECOVERY_MODE).toBe('1');
          expect(options.env.CONCH_LEGACY_SUPERVISOR_ROOT).toBe('/legacy/conch');
          expect(options.env.CONCH_SUPERVISOR_ROOT).not.toBe('/legacy/conch');
          expect(options.stdio).toContain('ipc');
          expect(shouldAdoptSupervisor(options.env, true)).toBe(false);
          const child = new EventEmitter();
          queueMicrotask(() => child.emit('exit', 0, null));
          return child;
        },
      );
      await expect(
        supervise({
          adoptLegacy: true,
          home,
          spawn: spawn as never,
          log: () => undefined,
          exit: ((code: number) => {
            throw Object.assign(new Error('exit'), { code });
          }) as never,
        }),
      ).rejects.toMatchObject({ code: 0 });
      expect(spawn).toHaveBeenCalledOnce();
    },
  );

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

  it('forgets a swap the pointer never reached, instead of waiting on it forever', async () => {
    const home = tempHome();
    const old = version(home, '0.2.0');
    const next = version(home, '0.3.0');
    writeState(home, { current: { folder: old, version: '0.2.0' }, failed: [] });
    point(home, old);
    // Stopped between writing the swap and moving the pointer.
    writeState(home, {
      ...readState(home),
      pending: {
        folder: next,
        version: '0.3.0',
        since: 1,
        from: { folder: old, version: '0.2.0' },
      },
    });
    const spawn = vi.fn(() => {
      const child = Object.assign(new EventEmitter(), { kill: () => undefined });
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    });
    const run = supervise({
      spawn: spawn as never,
      exit: ((code: number) => {
        throw Object.assign(new Error('exit'), { code });
      }) as never,
      log: () => undefined,
      sleep: async () => undefined,
      home,
    });
    await expect(run).rejects.toMatchObject({ code: 0 });
    const state = readState(home);
    expect(state.pending).toBeUndefined();
    expect(state.current).toEqual({ folder: old, version: '0.2.0' });
    expect(state.failed).toEqual([]);
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

describe('release proof while adopting a legacy supervisor', () => {
  it('rolls back before launching when the legacy parent’s initial deadline has no room left', async () => {
    const home = tempHome();
    const old = version(home, '0.2.0');
    const next = version(home, '0.3.0');
    swapIn(
      home,
      { folder: next, version: '0.3.0' },
      { folder: old, version: '0.2.0' },
      Date.now() - 90_000,
    );
    const launched: string[] = [];
    const signals: NodeJS.Signals[] = [];
    const spawn = vi.fn((_cmd: string, _args: string[], options: { cwd: string }) => {
      launched.push(options.cwd);
      const child = Object.assign(new EventEmitter(), {
        kill: (signal: NodeJS.Signals) => {
          signals.push(signal);
          queueMicrotask(() => child.emit('exit', null, signal));
        },
      });
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    });
    await expect(
      supervise({
        adoptLegacy: true,
        home,
        spawn: spawn as never,
        log: () => undefined,
        proveWithinMs: 200,
        lookEveryMs: 5,
        exit: ((code: number) => {
          throw Object.assign(new Error('exit'), { code });
        }) as never,
      }),
    ).rejects.toMatchObject({ code: 0 });
    expect(signals).toEqual([]);
    expect(launched).toEqual([join(old, 'apps/server')]);
    expect(readState(home).pending).toBeUndefined();
    expect(readState(home).current?.folder).toBe(old);
  });

  it('uses the normal proof allowance for a later update, after adoption has finished', async () => {
    const home = tempHome();
    const old = version(home, '0.2.0');
    const next = version(home, '0.3.0');
    point(home, old);
    const launched: string[] = [];
    const spawn = vi.fn((_cmd: string, _args: string[], options: { cwd: string }) => {
      launched.push(options.cwd);
      const child = Object.assign(new EventEmitter(), {
        kill: () => queueMicrotask(() => child.emit('exit', null, 'SIGTERM')),
      });
      if (launched.length === 1) {
        swapIn(
          home,
          { folder: next, version: '0.3.0' },
          { folder: old, version: '0.2.0' },
          Date.now() - 90_000,
        );
        queueMicrotask(() => child.emit('exit', RESTART_CODE, null));
      } else if (launched.length === 2)
        setTimeout(() => {
          prove(home, next);
          child.emit('exit', 0, null);
        }, 30);
      else queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    });
    await expect(
      supervise({
        adoptLegacy: true,
        home,
        spawn: spawn as never,
        log: () => undefined,
        proveWithinMs: 200,
        lookEveryMs: 5,
        exit: ((code: number) => {
          throw Object.assign(new Error('exit'), { code });
        }) as never,
      }),
    ).rejects.toMatchObject({ code: 0 });
    expect(launched).toEqual([join(old, 'apps/server'), join(next, 'apps/server')]);
    expect(readState(home).current?.folder).toBe(next);
    expect(readState(home).failed).toEqual([]);
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
    const logs: string[] = [];
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
        log: (message) => logs.push(message),
        sleep: async () => undefined,
        watchdog: { startupMs: 10, pollMs: 5, recoverMs: 10, stopMs: 10 },
        exit: ((code: number) => {
          throw Object.assign(new Error('exit'), { code });
        }) as never,
      }),
    ).rejects.toMatchObject({ code: 0 });
    expect(reasons).toEqual(['start', 'crash']);
    expect(logs.join('')).toMatch(/Conch stopped responding\. Starting it again in a moment…/);
    expect(logs.join('')).not.toMatch(/unexpectedly/);
  });

  it('says how long it waits when a cooldown follows, once, not "in a moment"', async () => {
    const home = tempHome();
    let now = 1_000_000;
    saveRecoveryState(home, {
      failures: [now - 50, now - 40, now - 30, now - 20, now - 10],
      incidents: [],
    });
    const logs: string[] = [];
    const codes = [1, 0];
    const spawn = vi.fn(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', codes.shift(), null));
      return child;
    });
    await expect(
      supervise({
        home,
        now: () => now,
        spawn: spawn as never,
        log: (message) => logs.push(message),
        sleep: async (ms) => {
          now += ms;
        },
        exit: ((code: number) => {
          throw Object.assign(new Error('exit'), { code });
        }) as never,
      }),
    ).rejects.toMatchObject({ code: 0 });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(logs.join('')).toMatch(
      /Conch stopped unexpectedly\. Starting it again in about 10 minutes, with less background work/,
    );
    expect(logs.join('')).not.toMatch(/in a moment|to recover before starting/);
  });

  it('words the restart for what happened and how long it takes', () => {
    expect(restartNotice(false, 0, 0)).toBe('Conch stopped unexpectedly. Starting it again…');
    expect(restartNotice(false, 3_000, 0)).toBe(
      'Conch stopped unexpectedly. Starting it again in a moment…',
    );
    expect(restartNotice(true, 30_000, 0)).toBe(
      'Conch stopped responding. Starting it again in 30 seconds…',
    );
    expect(restartNotice(true, 30_000, 540_000)).toBe(
      'Conch stopped responding. Starting it again in about 10 minutes, with less background work, so this computer can recover.',
    );
    expect(restartNotice(false, 1_000, 20_000)).toMatch(/in about a minute,/);
  });
});

describe('stopping a gateway that isn’t answering', () => {
  /** Ctrl+C `times` over, `silentMs` after it started, to a gateway that only SIGKILL ends. */
  async function interrupt(times: number, silentMs: number) {
    const before = new Set(process.listeners('SIGINT'));
    const kills: (NodeJS.Signals | number | undefined)[] = [];
    const logs: string[] = [];
    let now = 0;
    const child = Object.assign(new EventEmitter(), {
      kill: (signal?: NodeJS.Signals | number) => {
        kills.push(signal);
        if (signal === 'SIGKILL') queueMicrotask(() => child.emit('exit', null, signal));
        return true;
      },
    });
    const started = Date.now();
    const code = await new Promise<number>((resolve) => {
      void supervise({
        home: tempHome(),
        platform: 'linux',
        now: () => now,
        spawn: (() => {
          queueMicrotask(() => {
            now += silentMs;
            for (let i = 0; i < times; i++)
              for (const listener of process.listeners('SIGINT'))
                if (!before.has(listener)) (listener as () => void)();
          });
          return child;
        }) as never,
        log: (message) => logs.push(message),
        watchdog: { stopMs: 10_000, frozenStopMs: 20 },
        exit: ((exitCode: number) => {
          resolve(exitCode);
          throw new Error('exit');
        }) as never,
      }).catch(() => undefined);
    });
    return { code, kills, logs: logs.join(''), took: Date.now() - started };
  }

  it('says so, and waits only a moment for one that has said nothing for a while', async () => {
    const stopped = await interrupt(1, 60_000);
    expect(stopped).toMatchObject({ code: 0, kills: ['SIGINT', 'SIGKILL'] });
    expect(stopped.logs).toMatch(/Conch isn’t answering, so it’s being stopped/);
    expect(stopped.took).toBeLessThan(5_000);
  });

  it('ends it at once on a second Ctrl+C', async () => {
    const stopped = await interrupt(2, 0);
    expect(stopped).toMatchObject({ code: 0, kills: ['SIGINT', 'SIGKILL'] });
    expect(stopped.logs).not.toMatch(/answering/);
    expect(stopped.took).toBeLessThan(5_000);
  });
});

describe('stopping on Windows without losing what the gateway saves', () => {
  /** A gateway that stops by itself once its channel closes, unless told it's stuck. */
  function gateway(stuck = false) {
    const kills: (NodeJS.Signals | number | undefined)[] = [];
    const child = Object.assign(new EventEmitter(), {
      connected: true,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: (signal?: NodeJS.Signals | number) => {
        kills.push(signal);
        queueMicrotask(() => child.emit('exit', null, signal));
        return true;
      },
      disconnect: () => {
        child.connected = false;
        if (!stuck) setTimeout(() => child.emit('exit', 0, null), 5);
      },
    });
    return { child, kills };
  }
  /** The supervisor's own signal listeners, so the test runner's are never called. */
  async function stopWith(signal: NodeJS.Signals, platform: NodeJS.Platform) {
    const before = new Set(process.listeners(signal));
    const { child, kills } = gateway();
    const exited = new Promise<number>((resolve) => {
      void supervise({
        home: tempHome(),
        platform,
        spawn: (() => {
          queueMicrotask(() => {
            for (const listener of process.listeners(signal))
              if (!before.has(listener)) (listener as () => void)();
          });
          return child;
        }) as never,
        log: () => undefined,
        watchdog: { stopMs: 1_000 },
        exit: ((code: number) => {
          resolve(code);
          throw new Error('exit');
        }) as never,
      }).catch(() => undefined);
    });
    return { code: await exited, kills, connected: child.connected };
  }

  it('closes the channel on Ctrl+C instead of ending the gateway, letting it save first', async () => {
    const stopped = await stopWith('SIGINT', 'win32');
    expect(stopped).toEqual({ code: 0, kills: [], connected: false });
  });

  it('still passes the signal on elsewhere, where the gateway has its own session', async () => {
    const stopped = await stopWith('SIGINT', 'linux');
    expect(stopped.kills).toEqual(['SIGINT']);
  });

  it('ends a gateway that never finishes stopping, once it has had its time', async () => {
    vi.useFakeTimers();
    try {
      const { child, kills } = gateway(true);
      stopWindowsGateway(child as never, 1_000);
      expect(child.connected).toBe(false);
      vi.advanceTimersByTime(999);
      expect(kills).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(kills).toEqual(['SIGKILL']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves a gateway that stopped in time, or had already stopped, alone', async () => {
    vi.useFakeTimers();
    try {
      const done = gateway();
      stopWindowsGateway(done.child as never, 1_000);
      vi.advanceTimersByTime(5);
      vi.advanceTimersByTime(5_000);
      expect(done.kills).toEqual([]);
      const gone = gateway();
      gone.child.exitCode = 0;
      stopWindowsGateway(gone.child as never, 1_000);
      vi.advanceTimersByTime(5_000);
      expect(gone).toMatchObject({ kills: [], child: { connected: true } });
    } finally {
      vi.useRealTimers();
    }
  });
});
