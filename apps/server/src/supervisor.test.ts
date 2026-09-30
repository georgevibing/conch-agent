import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { nextStep, RESTART_CODE, shouldSupervise, supervise } from './supervisor';

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
      }),
    ).rejects.toMatchObject({ code: 0 });
    expect(spawn.mock.calls[0]?.[0]).toBe(process.execPath);
    expect(started.map((env) => env.CONCH_STARTED_BECAUSE)).toEqual(['start', 'restart', 'crash']);
    expect(started.every((env) => env.CONCH_SUPERVISED === '1')).toBe(true);
  });
});
