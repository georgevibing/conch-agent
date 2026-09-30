import type { EngineStatus } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { turnProblem } from './manager';

const engine = (state: EngineStatus['state']) => ({
  detect: vi.fn(async (): Promise<EngineStatus> => ({
    engine: 'codex-cli',
    label: 'Codex',
    state,
    install: [],
    canSignIn: true,
    checkedAt: 0,
  })),
});

describe('why a turn failed', () => {
  it('asks the provider again, not its cached answer, whether it signed out', async () => {
    const signedOut = engine('signed-out');
    expect(await turnProblem(signedOut, 'Something went wrong.')).toBe('signed-out');
    expect(signedOut.detect).toHaveBeenCalledWith({ force: true });
  });

  it('reads the words when the provider can’t say', async () => {
    const ready = engine('ready');
    expect(await turnProblem(ready, 'Error: 401 Unauthorized')).toBe('signed-out');
    expect(await turnProblem(ready, 'You’ve hit your usage limit (429)')).toBe('limit');
    expect(await turnProblem(ready, 'fetch failed: ECONNREFUSED')).toBe('unavailable');
    expect(await turnProblem(ready, 'The model refused.')).toBeUndefined();
  });

  it('knows a key it couldn’t read from a locked 1Password', async () => {
    const ready = engine('ready');
    expect(
      await turnProblem(ready, '1Password is locked. Open it and unlock it, then try again.'),
    ).toBe('key-locked');
    expect(ready.detect).not.toHaveBeenCalled();
  });
});
