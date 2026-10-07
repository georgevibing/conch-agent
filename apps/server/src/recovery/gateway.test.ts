import { afterEach, describe, expect, it, vi } from 'vitest';

import { GatewayRecovery } from './gateway';
import { resourcePolicy } from './resources';

const healthy = () =>
  resourcePolicy({
    at: Date.now(),
    totalBytes: 8e9,
    availableBytes: 4e9,
    cpuCount: 4,
    loadPerCpu: 0.2,
    memoryPressure: 0,
  });

function setup(recoveryMode = false) {
  const deps = {
    sample: vi.fn(async () => healthy()),
    relieve: vi.fn(() => ({ stopped: 1, queued: 2 })),
    pause: vi.fn(),
    resume: vi.fn(),
    note: vi.fn(),
    send: vi.fn(),
    recovered: vi.fn(async (): Promise<void> => undefined),
    recoveryMode,
  };
  return { deps, recovery: new GatewayRecovery(deps) };
}

afterEach(() => vi.useRealTimers());

describe('gateway recovery', () => {
  it('does not release work before checking resources and the HTTP listener', async () => {
    const { recovery, deps } = setup();
    expect(recovery.allowsWork).toBe(false);
    const probe = vi.fn(async () => false);
    await recovery.start(probe);
    expect(recovery.allowsWork).toBe(false);
    expect(deps.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'conch.heartbeat', healthy: false }),
    );
    probe.mockResolvedValue(true);
    await recovery.poll();
    expect(recovery.allowsWork).toBe(true);
    recovery.stop();
  });

  it('backs off under pressure, reports failed checks, and recovers without restarting', async () => {
    const { recovery, deps } = setup();
    await recovery.start(async () => true);
    deps.sample.mockResolvedValue(resourcePolicy({ ...healthy(), availableBytes: 1 }));
    await recovery.poll();
    expect(recovery.allowsWork).toBe(false);
    expect(deps.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'conch.heartbeat', healthy: true }),
    );
    deps.sample.mockRejectedValueOnce(new Error('unavailable'));
    await expect(recovery.poll()).resolves.toBeUndefined();
    expect(recovery.allowsWork).toBe(false);
    expect(deps.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'conch.heartbeat', healthy: true }),
    );
    deps.sample.mockResolvedValue(healthy());
    await recovery.poll();
    expect(recovery.allowsWork).toBe(true);
    recovery.stop();
  });

  it('rate-limits workload relief and ignores unrelated IPC and late requests', async () => {
    vi.useFakeTimers();
    const { recovery, deps } = setup();
    await recovery.start(async () => true);
    recovery.receive({ type: 'restart' });
    expect(deps.relieve).not.toHaveBeenCalled();
    recovery.receive({ type: 'conch.recover' });
    recovery.receive({ type: 'conch.recover' });
    expect(deps.relieve).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    recovery.receive({ type: 'conch.recover' });
    expect(deps.relieve).toHaveBeenCalledTimes(2);
    recovery.stop();
    recovery.receive({ type: 'conch.recover' });
    expect(deps.relieve).toHaveBeenCalledTimes(2);
  });

  it('keeps recovery mode until an explicit repair after stable health', async () => {
    vi.useFakeTimers();
    const { recovery, deps } = setup(true);
    await recovery.start(async () => true);
    const check = recovery.doctorCheck();
    const run = (repair: boolean) => check.run({ repair, signal: new AbortController().signal });
    expect(recovery.allowsWork).toBe(false);
    // Too soon to carry on: after a repair that's news, never left as a warning.
    expect((await run(true))[0]?.state).toBe('info');
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await run(false))[0]?.state).toBe('warning');
    expect(deps.resume).not.toHaveBeenCalled();
    expect((await run(true))[0]?.state).toBe('fixed');
    expect(deps.recovered).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenLastCalledWith({ type: 'conch.recovered' });
    expect(recovery.allowsWork).toBe(true);
    recovery.stop();
  });

  it('cannot reopen admission when an in-flight probe completes during shutdown', async () => {
    const { recovery, deps } = setup();
    let answer!: (value: boolean) => void;
    const start = recovery.start(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    await Promise.resolve();
    recovery.stop();
    answer(true);
    await start;
    expect(recovery.allowsWork).toBe(false);
    expect(deps.send).toHaveBeenCalledExactlyOnceWith({ type: 'conch.stopping' });
  });

  it('shutdown wins over an in-flight repair', async () => {
    vi.useFakeTimers();
    const { recovery, deps } = setup(true);
    await recovery.start(async () => true);
    await vi.advanceTimersByTimeAsync(15_000);
    let finish!: () => void;
    deps.recovered.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const repair = recovery
      .doctorCheck()
      .run({ repair: true, signal: new AbortController().signal });
    await vi.waitFor(() => expect(deps.recovered).toHaveBeenCalledOnce());
    recovery.stop();
    finish();
    await repair;
    expect(deps.resume).not.toHaveBeenCalled();
    expect(recovery.allowsWork).toBe(false);
    expect(deps.send).not.toHaveBeenCalledWith({ type: 'conch.recovered' });
  });
});
