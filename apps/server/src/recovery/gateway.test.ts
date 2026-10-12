import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProcessService } from '../processes/service';
import { eventLoopDelay, GatewayRecovery } from './gateway';
import type { WorkloadPace } from './pace';
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
    relieve: vi.fn(async () => ({ stopped: 1, queued: 2 })),
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

describe('whether there is room, and why not', () => {
  it('says why work waits, and always agrees with allowsWork', async () => {
    let pace: WorkloadPace = {
      phase: 'normal',
      cause: 'recovery',
      concurrency: 4,
      critical: false,
    };
    let sample = healthy();
    let answering = false;
    const { deps } = setup();
    const recovery = new GatewayRecovery({
      ...deps,
      sample: async () => sample,
      admit: () => pace.phase === 'normal',
      pace: () => pace,
    });
    const check = (reason: string | undefined) => {
      const room = recovery.room();
      expect(room.room ? undefined : room.reason).toBe(reason);
      expect(room.room).toBe(recovery.allowsWork);
      if (!room.room) {
        expect(room.why).toBeTruthy();
        expect(room.until).toBeTruthy();
      }
    };
    try {
      check('not-answering');
      await recovery.start(async () => answering);
      check('not-answering');
      answering = true;
      await recovery.poll();
      check(undefined);
      // Five helpers starting at once push the load up: the pacer slows work down.
      pace = { phase: 'constrained', cause: 'cpu', concurrency: 1, critical: false };
      check('cpu');
      expect(recovery.room()).toMatchObject({ why: 'the processor is busy' });
      pace = { phase: 'held', cause: 'memory', concurrency: 0, critical: false };
      check('memory');
      pace = { phase: 'recovering', cause: 'recovery', concurrency: 2, critical: false };
      check('easing');
      pace = { phase: 'held', cause: 'unknown', concurrency: 0, critical: false };
      check('not-measured');
      // The hold after one slow moment isn't the recovery after repeated trouble.
      pace = { phase: 'held', cause: 'unresponsive', concurrency: 0, critical: false };
      check('catching-up');
      expect(recovery.room()).toMatchObject({
        why: 'Conch was slow to respond a moment ago, and is catching up',
        until: 'within about half a minute, once it’s keeping up again',
      });
      // Admission paused for Conch's own recovery still says so.
      pace = { phase: 'held', cause: 'recovery', concurrency: 0, critical: false };
      check('recovering');
      expect(recovery.room()).toMatchObject({
        until: 'once Conch has stayed responsive for a full minute',
      });
      pace = { phase: 'normal', cause: 'recovery', concurrency: 4, critical: false };
      sample = resourcePolicy({ ...healthy(), availableBytes: 1e8 });
      await recovery.poll();
      check('memory');
      sample = resourcePolicy({ ...healthy(), loadPerCpu: 3 });
      await recovery.poll();
      check('cpu');
      expect(recovery.holding).toContain('the processor is busy');
    } finally {
      recovery.stop();
    }
    check('stopping');
    const restarted = setup(true).recovery;
    expect(restarted.room()).toMatchObject({ room: false, reason: 'recovering' });
  });
});

describe('gateway recovery', () => {
  it('lets a pause the person chose go on while the processor is busy, never short of memory', async () => {
    let pacedForMemory = false;
    const { deps } = setup();
    const recovery = new GatewayRecovery({
      ...deps,
      // The pacer isn't settled (a busy processor): ordinary work waits.
      admit: () => false,
      admitPlanned: () => !pacedForMemory,
    });
    try {
      await recovery.start(async () => true);
      expect(recovery.allowsWork).toBe(false);
      expect(recovery.allowsPlanned).toBe(true);
      pacedForMemory = true;
      expect(recovery.allowsPlanned).toBe(false);
    } finally {
      recovery.stop();
    }
  });

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

  it('times the relief cooldown on the monotonic clock, not the wall clock', async () => {
    vi.useFakeTimers({
      toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
    const { recovery, deps } = setup();
    await recovery.start(async () => true);
    recovery.receive({ type: 'conch.recover' });
    expect(deps.relieve).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    // The wall clock is set back an hour (NTP, a time zone fix, a dead battery).
    vi.setSystemTime(new Date('2026-10-12T11:00:30Z'));
    recovery.receive({ type: 'conch.recover' });
    expect(deps.relieve).toHaveBeenCalledTimes(2);
    recovery.stop();
  });

  it('holds work a moment after a freeze while Conch catches up, never saying memory ran short', async () => {
    const processes = new ProcessService({
      protectedPaths: [],
      sealed: async () => false,
      resources: async () => healthy(),
    });
    const { deps } = setup();
    const relieve = vi.fn((cause: WorkloadPace['cause']) => processes.relievePressure(cause));
    const recovery = new GatewayRecovery({
      ...deps,
      relieve,
      sample: () => processes.resourceSnapshot(),
      admit: () => processes.workload.phase === 'normal',
      pace: () => processes.workload,
    });
    try {
      await recovery.start(async () => true);
      expect(recovery.room()).toEqual({ room: true });
      recovery.receive({ type: 'conch.recover' });
      expect(relieve).toHaveBeenCalledWith('unresponsive');
      await vi.waitFor(() =>
        expect(deps.note).toHaveBeenCalledWith('Held new commands a moment to stay responsive'),
      );
      expect(processes.workload).toMatchObject({ phase: 'held', cause: 'unresponsive' });
      const room = recovery.room();
      expect(room.room ? undefined : room.reason).toBe('catching-up');
      expect(room.room ? '' : room.why).not.toContain('memory');
      expect(room.room ? '' : room.why).not.toContain('repeated trouble');
      expect(recovery.allowsPlanned).toBe(false);
    } finally {
      recovery.stop();
      processes.close();
    }
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

describe('how late its own timers run', () => {
  it('reports the last interval’s p99 in each heartbeat and lets the histogram go on stop', async () => {
    vi.useFakeTimers();
    const delays: (number | undefined)[] = [undefined, 12.4, 640];
    const loopDelay = { take: vi.fn(() => delays.shift()), dispose: vi.fn() };
    const { deps } = setup();
    const recovery = new GatewayRecovery({ ...deps, loopDelay, intervalMs: 5_000 });
    await recovery.start(async () => true);
    expect(deps.send.mock.lastCall?.[0].resource).not.toHaveProperty('eventLoopDelayP99Ms');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deps.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ resource: expect.objectContaining({ eventLoopDelayP99Ms: 12 }) }),
    );
    // A poll between the timer's repeats the last reading rather than cutting a new one short.
    await recovery.poll();
    expect(deps.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ resource: expect.objectContaining({ eventLoopDelayP99Ms: 12 }) }),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deps.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ resource: expect.objectContaining({ eventLoopDelayP99Ms: 640 }) }),
    );
    // One reading per timer interval: each heartbeat covers only the interval before it.
    expect(loopDelay.take).toHaveBeenCalledTimes(3);
    recovery.stop();
    expect(loopDelay.dispose).toHaveBeenCalledOnce();
  });

  it('holds new work while its loop stays slow, before the probe fails, and lets it in once calm', async () => {
    vi.useFakeTimers();
    let delay: number | undefined = 0;
    const loopDelay = { take: () => delay, dispose: vi.fn() };
    const { deps } = setup();
    const recovery = new GatewayRecovery({
      ...deps,
      loopDelay,
      intervalMs: 5_000,
      slowLoopMs: 500,
      slowPolls: 2,
      calmLoopMs: 200,
      calmPolls: 3,
    });
    const poll = async (ms: number | undefined) => {
      delay = ms;
      await vi.advanceTimersByTimeAsync(5_000);
    };
    try {
      await recovery.start(async () => true);
      expect(recovery.allowsWork).toBe(true);
      // One late stretch is a hiccup, and a lull between two isn't "staying" slow.
      await poll(900);
      await poll(300);
      await poll(900);
      expect(recovery.allowsWork).toBe(true);
      await poll(900);
      expect(recovery.room()).toMatchObject({ room: false, reason: 'cpu' });
      expect(recovery.allowsWork).toBe(false);
      // Busy isn't broken: the listener still answers, so nothing restarts.
      expect(deps.send).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'conch.heartbeat', healthy: true }),
      );
      expect(deps.relieve).not.toHaveBeenCalled();
      // Planned work isn't held by a busy processor.
      expect(recovery.allowsPlanned).toBe(true);
      const [item] = await recovery
        .doctorCheck()
        .run({ repair: false, signal: new AbortController().signal });
      expect(item).toMatchObject({
        state: 'info',
        message: expect.stringMatching(/falling behind/),
      });
      // Better but not calm, or no reading at all, doesn't let work in.
      await poll(300);
      await poll(undefined);
      await poll(100);
      await poll(100);
      await poll(400);
      await poll(100);
      await poll(100);
      expect(recovery.allowsWork).toBe(false);
      await poll(100);
      expect(recovery.room()).toEqual({ room: true });
      expect(recovery.allowsWork).toBe(true);
    } finally {
      recovery.stop();
    }
  });

  it('counts only whole timer intervals, however often the doctor or the supervisor looks', async () => {
    vi.useFakeTimers();
    const loopDelay = { take: vi.fn((): number | undefined => 900), dispose: vi.fn() };
    const { deps } = setup();
    const recovery = new GatewayRecovery({
      ...deps,
      loopDelay,
      intervalMs: 5_000,
      slowLoopMs: 500,
      slowPolls: 2,
      recheckMs: 10,
    });
    try {
      loopDelay.take.mockReturnValueOnce(0);
      await recovery.start(async () => true);
      // One slow interval.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(recovery.allowsWork).toBe(true);
      // Looks between the timer's, a moment apart: none of them is an interval of its own.
      await recovery.doctorCheck().run({ repair: false, signal: new AbortController().signal });
      recovery.receive({ type: 'conch.recover' });
      await recovery.poll();
      expect(recovery.allowsWork).toBe(true);
      expect(loopDelay.take).toHaveBeenCalledTimes(2);
      // The second slow interval holds work.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(recovery.room()).toMatchObject({ room: false, reason: 'cpu' });
    } finally {
      recovery.stop();
    }
  });

  it('counts a block that starts right after a reading', async () => {
    const loopDelay = eventLoopDelay();
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      loopDelay.take();
      const until = performance.now() + 700;
      while (performance.now() < until);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(loopDelay.take()).toBeGreaterThan(500);
    } finally {
      loopDelay.dispose();
    }
  });

  it('keeps a recovering gateway from counting a slow loop as sustained health', async () => {
    vi.useFakeTimers();
    let delay = 900;
    const { deps } = setup(true);
    const recovery = new GatewayRecovery({
      ...deps,
      loopDelay: { take: () => delay, dispose() {} },
    });
    await recovery.start(async () => true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(deps.resume).not.toHaveBeenCalled();
    delay = 10;
    // Six calm polls (half a minute), then a full healthy minute before it carries on.
    await vi.advanceTimersByTimeAsync(30_000 + 55_000);
    expect(deps.resume).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deps.resume).toHaveBeenCalledOnce();
    recovery.stop();
  });

  it('measures its own loop when nothing is injected', async () => {
    const { deps } = setup();
    const recovery = new GatewayRecovery({ ...deps, intervalMs: 60 });
    await recovery.start(async () => true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const resource = deps.send.mock.lastCall?.[0].resource;
    expect(resource.eventLoopDelayP99Ms).toBeGreaterThanOrEqual(0);
    recovery.stop();
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

it('one slow answer to itself is asked again before Health says it can’t respond', async () => {
  const { deps } = setup();
  const recovery = new GatewayRecovery({ ...deps, recheckMs: 1 });
  const probe = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  await recovery.start(probe);
  // The look lands on a busy moment: the first answer is late, the next one isn't.
  probe.mockResolvedValueOnce(false);
  const signal = new AbortController().signal;
  const [item] = await recovery.doctorCheck().run({ repair: false, signal });
  expect(item).toMatchObject({ state: 'ok', message: expect.stringMatching(/has room to work/) });
  expect(recovery.allowsWork).toBe(true);

  // Still not answering after asking again: that's what it says.
  probe.mockResolvedValue(false);
  const [down] = await recovery.doctorCheck().run({ repair: true, signal });
  expect(down).toMatchObject({
    state: 'info',
    message: 'Conch is checking that it can respond before starting more work.',
  });
  recovery.stop();
});
