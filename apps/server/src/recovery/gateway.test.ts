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
  it('keeps native and automatic work paced while HTTP health remains proven', async () => {
    let admitted = false;
    const { deps } = setup();
    const recovery = new GatewayRecovery({ ...deps, admit: () => admitted });
    try {
      await recovery.start(async () => true);
      expect(recovery.allowsWork).toBe(false);
      expect(deps.send).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'conch.heartbeat', healthy: true }),
      );
      admitted = true;
      expect(recovery.allowsWork).toBe(true);
    } finally {
      recovery.stop();
    }
  });
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

describe('automatic recovery without a restart loop', () => {
  it('automatically resumes after sustained health but retains the crash budget through probation', async () => {
    vi.useFakeTimers();
    const { recovery, deps } = setup(true);
    await recovery.start(async () => true);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(deps.resume).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.resume).toHaveBeenCalledOnce();
    expect(recovery.allowsWork).toBe(true);
    expect(deps.send).not.toHaveBeenCalledWith({ type: 'conch.recovered' });
    await vi.advanceTimersByTimeAsync(540_000);
    expect(deps.send).toHaveBeenCalledWith({ type: 'conch.recovered' });
    recovery.stop();
  });

  it('requires a fresh continuous healthy interval after renewed pressure', async () => {
    vi.useFakeTimers();
    const { recovery, deps } = setup(true);
    await recovery.start(async () => true);
    await vi.advanceTimersByTimeAsync(55_000);
    deps.sample.mockResolvedValue(resourcePolicy({ ...healthy(), availableBytes: 1 }));
    await vi.advanceTimersByTimeAsync(5_000);
    deps.sample.mockResolvedValue(healthy());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.resume).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deps.resume).toHaveBeenCalledOnce();
    recovery.stop();
  });

  it('keeps heartbeats running and retries failed repairs with backoff', async () => {
    vi.useFakeTimers();
    const { recovery, deps } = setup(true);
    deps.recovered.mockRejectedValueOnce(new Error('transient'));
    await recovery.start(async () => true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(recovery.allowsWork).toBe(false);
    await vi.advanceTimersByTimeAsync(55_000);
    expect(deps.recovered).toHaveBeenCalledOnce();
    expect(deps.send).toHaveBeenLastCalledWith(expect.objectContaining({ healthy: true }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deps.recovered).toHaveBeenCalledTimes(2);
    expect(recovery.allowsWork).toBe(true);
    recovery.stop();
  });

  it('a hanging resource sampler holds work without declaring a working listener dead', async () => {
    vi.useFakeTimers();
    const { recovery, deps } = setup();
    deps.sample.mockImplementation(() => new Promise(() => {}));
    const starting = recovery.start(async () => true);
    await vi.advanceTimersByTimeAsync(2_500);
    await starting;
    expect(recovery.allowsWork).toBe(false);
    expect(deps.send).toHaveBeenLastCalledWith(expect.objectContaining({ healthy: true }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(deps.send.mock.calls.length).toBeGreaterThan(1);
    recovery.stop();
  });

  it('a hanging probe reports failure within a deadline and can recover on a later poll', async () => {
    vi.useFakeTimers();
    const { recovery, deps } = setup();
    const probe = vi
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue(true);
    const starting = recovery.start(probe);
    await vi.advanceTimersByTimeAsync(2_500);
    await starting;
    expect(deps.send).toHaveBeenLastCalledWith(expect.objectContaining({ healthy: false }));
    await recovery.poll();
    expect(recovery.allowsWork).toBe(true);
    recovery.stop();
  });
});

it('rechecks health after a slow repair before reopening admission', async () => {
  vi.useFakeTimers();
  const { recovery, deps } = setup(true);
  await recovery.start(async () => true);
  await vi.advanceTimersByTimeAsync(15_000);
  deps.recovered.mockImplementation(async () => {
    deps.sample.mockResolvedValue(resourcePolicy({ ...healthy(), availableBytes: 1 }));
  });
  const items = await recovery
    .doctorCheck()
    .run({ repair: true, signal: new AbortController().signal });
  expect(items[0]?.state).toBe('info');
  expect(recovery.recoveryMode).toBe(true);
  expect(deps.resume).not.toHaveBeenCalled();
  expect(deps.send).not.toHaveBeenCalledWith({ type: 'conch.recovered' });
  recovery.stop();
});
