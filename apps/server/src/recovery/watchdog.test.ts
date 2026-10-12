import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  pressureStretch,
  watchGateway,
  watchTransition,
  type WatchdogOptions,
  type WatchState,
} from './watchdog';

afterEach(() => vi.useRealTimers());
function world(extra: Partial<WatchdogOptions> = {}) {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    connected: true,
    send: vi.fn(),
    kill: vi.fn(),
  });
  const incident = vi.fn();
  const repaired = vi.fn();
  const watch = watchGateway(child as unknown as ChildProcess, {
    startupMs: 100,
    unhealthyMs: 30,
    recoverMs: 20,
    pollMs: 5,
    stopMs: 15,
    stopping: () => false,
    incident,
    repaired,
    ...extra,
  });
  return { child, watch, incident, repaired };
}
describe('independent gateway watchdog', () => {
  it('allows startup, reduces work before restarting, then forces a stuck shutdown', () => {
    const { child, watch, incident } = world();
    vi.advanceTimersByTime(95);
    expect(child.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5);
    expect(child.send).toHaveBeenCalledWith({ type: 'conch.recover' }, expect.any(Function));
    vi.advanceTimersByTime(20);
    expect(watch.failed()).toBe(true);
    vi.advanceTimersByTime(15);
    // It never answered: no SIGTERM it could not run, only the kill.
    expect(child.kill.mock.calls).toEqual([['SIGKILL']]);
    expect(incident.mock.calls.map(([reason]) => reason)).toEqual([
      'reduced-workload',
      'unresponsive',
    ]);
    watch.close();
  });
  it('recovers without restart when reducing work restores healthy responses', () => {
    const { child, watch, incident } = world();
    child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(30);
    child.emit('message', { type: 'conch.heartbeat', healthy: false });
    vi.advanceTimersByTime(10);
    child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(20);
    expect(child.kill).not.toHaveBeenCalled();
    expect(incident.mock.calls.map(([reason]) => reason)).toEqual([
      'reduced-workload',
      'responsive',
    ]);
    watch.close();
  });
  it('does not mistake its own sleep for a frozen gateway', () => {
    let slept = 0;
    const { child, watch, incident } = world({ now: () => Date.now() + slept });
    child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(10);
    slept = 3_600_000;
    vi.advanceTimersByTime(5);
    child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(25);
    expect(child.send).not.toHaveBeenCalled();
    expect(incident).not.toHaveBeenCalled();
    // Judging resumes after the nap.
    vi.advanceTimersByTime(10);
    expect(child.send).toHaveBeenCalledWith({ type: 'conch.recover' }, expect.any(Function));
    watch.close();
  });
  it('kills a gateway that said nothing while reducing after a short grace, not the full stop', () => {
    const { child, watch } = world({ frozenStopMs: 3 });
    child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(50);
    expect(child.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3);
    expect(child.kill.mock.calls).toEqual([['SIGKILL']]);
    watch.close();
  });
  it('sends a frozen gateway no SIGTERM that would end it before its evidence is captured', () => {
    const order: string[] = [];
    const { child, watch } = world({
      stopMs: 15_000,
      beforeKill: () => order.push('evidence'),
    });
    child.kill.mockImplementation((signal: string) => order.push(signal));
    child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(50);
    expect(order).toEqual(['evidence']);
    // Comfortably past the capture's 2 s bound, and still within stopMs.
    vi.advanceTimersByTime(2_499);
    expect(order).toEqual(['evidence']);
    vi.advanceTimersByTime(1);
    expect(order).toEqual(['evidence', 'SIGKILL']);
    watch.close();
  });
  it('gives a gateway that still answers, unhealthily, the whole graceful stop', () => {
    const { child, watch } = world({ frozenStopMs: 3 });
    child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(35);
    child.emit('message', { type: 'conch.heartbeat', healthy: false });
    vi.advanceTimersByTime(15);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    vi.advanceTimersByTime(14);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    vi.advanceTimersByTime(1);
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
    watch.close();
  });
  it('restarts health that keeps recovering only to fail again, recording one cycle', () => {
    const { child, watch, incident } = world({ flapWindowMs: 1_000 });
    for (let cycle = 0; cycle < 3; cycle++) {
      child.emit('message', { type: 'conch.heartbeat', healthy: true });
      vi.advanceTimersByTime(30);
    }
    expect(child.send).toHaveBeenCalledTimes(2);
    expect(watch.failed()).toBe(true);
    expect(incident.mock.calls.map(([reason]) => reason)).toEqual([
      'reduced-workload',
      'responsive',
      'unresponsive',
    ]);
    watch.close();
  });
  it('forgets reductions older than the flap window', () => {
    const { child, watch, incident } = world({ flapWindowMs: 50 });
    for (let cycle = 0; cycle < 4; cycle++) {
      child.emit('message', { type: 'conch.heartbeat', healthy: true });
      vi.advanceTimersByTime(30);
    }
    child.emit('message', { type: 'conch.heartbeat', healthy: true });
    expect(child.kill).not.toHaveBeenCalled();
    expect(child.send).toHaveBeenCalledTimes(4);
    // The second and fourth cycles fall within the window of one already recorded.
    expect(incident.mock.calls.map(([reason]) => reason)).toEqual([
      'reduced-workload',
      'responsive',
      'reduced-workload',
      'responsive',
    ]);
    watch.close();
  });
  it('gives a gateway that says it is still starting until readyMs to answer', () => {
    const { child, watch } = world({ readyMs: 300 });
    const boot = (phase = 'services') => child.emit('message', { type: 'conch.booting', phase });
    for (let t = 0; t < 250; t += 50) {
      boot();
      vi.advanceTimersByTime(50);
    }
    expect(child.send).not.toHaveBeenCalled();
    boot();
    vi.advanceTimersByTime(50);
    expect(child.send).toHaveBeenCalledWith({ type: 'conch.recover' }, expect.any(Function));
    watch.close();
  });
  it('still holds a starting gateway to startupMs of silence', () => {
    const { child, watch } = world({ readyMs: 300 });
    vi.advanceTimersByTime(50);
    child.emit('message', { type: 'conch.booting', phase: 'app' });
    vi.advanceTimersByTime(95);
    expect(child.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5);
    expect(child.send).toHaveBeenCalledOnce();
    watch.close();
  });
  it('lets a start wait for another Conch to close for as long as it keeps saying so', () => {
    const { child, watch } = world({ readyMs: 300 });
    for (let t = 0; t < 1_000; t += 50) {
      child.emit('message', { type: 'conch.booting', phase: 'waiting' });
      vi.advanceTimersByTime(50);
    }
    child.emit('message', { type: 'conch.booting', phase: 'listen' });
    vi.advanceTimersByTime(95);
    expect(child.send).not.toHaveBeenCalled();
    watch.close();
  });
  it('tracks health from the first heartbeat of a release that announces its start', () => {
    const { child, watch } = world({ readyMs: 300 });
    child.emit('message', { type: 'conch.booting', phase: 'probe' });
    child.emit('message', { type: 'conch.heartbeat', healthy: false });
    vi.advanceTimersByTime(30);
    expect(child.send).toHaveBeenCalledOnce();
    watch.close();
  });
  it('keeps the startup deadline for an older release that never announces its start', () => {
    const { child, watch } = world({ readyMs: 300 });
    for (let t = 0; t < 95; t += 5) {
      child.emit('message', { type: 'conch.heartbeat', healthy: false });
      vi.advanceTimersByTime(5);
    }
    expect(child.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5);
    expect(child.send).toHaveBeenCalledOnce();
    watch.close();
  });
  it('calls beforeKill once, saying whether the gateway was frozen', () => {
    const frozenKill = vi.fn();
    const frozen = world({ beforeKill: frozenKill });
    frozen.child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(200);
    expect(frozenKill.mock.calls).toEqual([[true]]);
    frozen.watch.close();
    const beforeKill = vi.fn();
    const alive = world({ beforeKill });
    alive.child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(35);
    alive.child.emit('message', { type: 'conch.heartbeat', healthy: false });
    vi.advanceTimersByTime(200);
    expect(beforeKill.mock.calls).toEqual([[false]]);
    alive.watch.close();
  });
  it('kills on time when beforeKill throws, and does not call it for a requested stop', () => {
    const beforeKill = vi.fn(() => {
      throw new Error('no evidence');
    });
    const { child, watch } = world({ beforeKill, frozenStopMs: 3 });
    vi.advanceTimersByTime(120);
    expect(beforeKill.mock.calls).toEqual([[true]]);
    vi.advanceTimersByTime(3);
    expect(child.kill.mock.calls).toEqual([['SIGKILL']]);
    watch.close();
    const stopped = world({ beforeKill });
    stopped.child.emit('message', { type: 'conch.stopping' });
    stopped.watch.stop();
    vi.advanceTimersByTime(200);
    expect(beforeKill).toHaveBeenCalledOnce();
    stopped.watch.close();
  });
  it('ignores malformed heartbeats and cancels timers and listeners on exit', () => {
    const { child, watch, repaired } = world();
    child.emit('message', { type: 'conch.heartbeat', healthy: 'true' });
    child.emit('message', { type: 'conch.recovered' });
    expect(repaired).toHaveBeenCalledOnce();
    watch.close();
    vi.advanceTimersByTime(1_000);
    expect(child.send).not.toHaveBeenCalled();
    expect(child.listenerCount('message')).toBe(0);
  });
  it('keeps only bounded numeric resource evidence when diagnosing a stall', () => {
    const { child, watch, incident } = world();
    child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(25);
    child.emit('message', {
      type: 'conch.heartbeat',
      healthy: false,
      resource: { running: 3, probeMs: 2, token: 'private', command: 'private' },
    });
    vi.advanceTimersByTime(5);
    expect(incident).toHaveBeenCalledWith('reduced-workload', { running: 3, probeMs: 2 });
    watch.close();
  });

  it('does not report an older heartbeat’s measurements as current', () => {
    const { child, watch, incident } = world();
    child.emit('message', {
      type: 'conch.heartbeat',
      healthy: true,
      resource: { running: 3, probeMs: 2 },
    });
    child.emit('message', { type: 'conch.heartbeat', healthy: false });
    vi.advanceTimersByTime(30);
    expect(incident).toHaveBeenCalledWith('reduced-workload', undefined);
    watch.close();
  });

  it('does not report a silent gateway’s last measurements as current', () => {
    const { child, watch, incident } = world();
    child.emit('message', {
      type: 'conch.heartbeat',
      healthy: true,
      resource: { running: 3, probeMs: 2 },
    });
    vi.advanceTimersByTime(50);
    expect(incident.mock.calls).toEqual([
      ['reduced-workload', undefined],
      ['unresponsive', undefined],
    ]);
    watch.close();
  });

  it('gives a gateway that still answers longer while other programs starve the computer', () => {
    const { child, watch, incident } = world();
    const starved = { gatewayRssBytes: 200, memoryTotalBytes: 16_000, loadPerCpu: 2 };
    child.emit('message', { type: 'conch.heartbeat', healthy: true, resource: starved });
    const beat = (ms: number) => {
      for (let t = 0; t < ms; t += 5) {
        child.emit('message', { type: 'conch.heartbeat', healthy: false, resource: starved });
        vi.advanceTimersByTime(5);
      }
    };
    beat(55);
    expect(child.send).not.toHaveBeenCalled();
    beat(5);
    expect(child.send).toHaveBeenCalledOnce();
    // Twice recoverMs, shedding again after the first.
    beat(20);
    expect(child.send).toHaveBeenCalledTimes(2);
    expect(child.kill).not.toHaveBeenCalled();
    beat(20);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(incident.mock.calls.map(([reason]) => reason)).toEqual([
      'reduced-workload',
      'unresponsive',
    ]);
    watch.close();
  });
  it('does not take a starved computer’s stretched cycles for flapping', () => {
    const { child, watch } = world({ flapWindowMs: 1_000 });
    const starved = { gatewayRssBytes: 200, memoryTotalBytes: 16_000, loadPerCpu: 2 };
    const beat = (healthy: boolean) =>
      child.emit('message', { type: 'conch.heartbeat', healthy, resource: starved });
    for (let cycle = 0; cycle < 4; cycle++) {
      beat(true);
      for (let t = 0; t < 60; t += 5) {
        vi.advanceTimersByTime(5);
        beat(false);
      }
    }
    expect(child.send.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(child.kill).not.toHaveBeenCalled();
    expect(watch.failed()).toBe(false);
    watch.close();
  });
  it('never stretches a deadline for silence', () => {
    const { child, watch } = world();
    child.emit('message', {
      type: 'conch.heartbeat',
      healthy: true,
      resource: { gatewayRssBytes: 200, memoryTotalBytes: 16_000, loadPerCpu: 4 },
    });
    vi.advanceTimersByTime(30);
    expect(child.send).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(20);
    expect(watch.failed()).toBe(true);
    watch.close();
  });

  it('does not mistake an older release without heartbeat support for a freeze', () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    const incident = vi.fn();
    const watch = watchGateway(child as unknown as ChildProcess, {
      enabled: false,
      stopping: () => false,
      incident,
      repaired: () => undefined,
    });
    vi.advanceTimersByTime(600_000);
    expect(incident).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
    watch.close();
  });

  it('bounds intentional shutdown without treating it as a crash', () => {
    const { child, watch } = world();
    child.emit('message', { type: 'conch.stopping' });
    vi.advanceTimersByTime(100);
    expect(child.kill.mock.calls).toEqual([['SIGKILL']]);
    expect(watch.failed()).toBe(false);
    watch.close();
  });
  it('terminates a real child with a blocked event loop, even when SIGTERM is ignored', async () => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `
      process.on('SIGTERM', () => {});
      process.send({ type: 'conch.heartbeat', healthy: true });
      while (true) {}
    `,
      ],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
    );
    const watch = watchGateway(child, {
      startupMs: 2_000,
      unhealthyMs: 40,
      recoverMs: 30,
      pollMs: 10,
      stopMs: 40,
      stopping: () => false,
      incident: () => undefined,
      repaired: () => undefined,
    });
    try {
      const signal = await new Promise<NodeJS.Signals | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (_code, endedBy) => resolve(endedBy));
      });
      expect(signal).toBe('SIGKILL');
      expect(watch.failed()).toBe(true);
    } finally {
      watch.close();
      child.kill('SIGKILL');
    }
  });
});

describe('pressure stretch', () => {
  const GiB = 1024 ** 3;
  const host = { memoryTotalBytes: 16 * GiB, gatewayRssBytes: 0.5 * GiB };
  it('stretches only when other programs starve the computer, and only so far', () => {
    expect(pressureStretch(undefined)).toBe(1);
    expect(pressureStretch({ ...host, memoryAvailableBytes: 8 * GiB, loadPerCpu: 0.5 })).toBe(1);
    expect(pressureStretch({ ...host, memoryAvailableBytes: 1.2 * GiB })).toBe(2);
    expect(pressureStretch({ ...host, memoryAvailableBytes: 0.5 * GiB })).toBe(3);
    expect(pressureStretch({ ...host, loadPerCpu: 1.5 })).toBe(2);
    expect(pressureStretch({ ...host, loadPerCpu: 8 })).toBe(3);
    expect(pressureStretch({ ...host, memoryPressure: 25 })).toBe(3);
    expect(pressureStretch({ ...host, loadPerCpu: 8 }, 2)).toBe(2);
  });
  it('does not stretch when the gateway itself is the likely culprit', () => {
    const starved = { memoryAvailableBytes: 0.2 * GiB, loadPerCpu: 4 };
    expect(pressureStretch({ ...starved, memoryTotalBytes: 16 * GiB })).toBe(1);
    expect(
      pressureStretch({ ...starved, memoryTotalBytes: 16 * GiB, gatewayRssBytes: 6 * GiB }),
    ).toBe(1);
    const limited = { ...host, ...starved, cgroupMemoryLimitBytes: 4 * GiB };
    expect(pressureStretch({ ...limited, cgroupMemoryAvailableBytes: 2 * GiB })).toBe(3);
    expect(pressureStretch({ ...limited, cgroupMemoryAvailableBytes: 0.2 * GiB })).toBe(1);
    expect(pressureStretch({ ...limited, gatewayRssBytes: 2.5 * GiB })).toBe(1);
  });
  it('does not stretch for a loop that runs late while the computer is calm', () => {
    const calm = { ...host, memoryAvailableBytes: 8 * GiB, loadPerCpu: 0.5 };
    expect(pressureStretch({ ...calm, eventLoopDelayP99Ms: 2_000 })).toBe(1);
    expect(pressureStretch({ ...calm, memoryPressure: 8, eventLoopDelayP99Ms: 2_000 })).toBe(1);
    expect(pressureStretch({ ...calm, memoryPressure: 8, eventLoopDelayP99Ms: 40 })).toBe(2);
    expect(pressureStretch({ ...calm, memoryPressure: 8 })).toBe(2);
  });
  it('stretches as before for a late loop on a starved computer', () => {
    const late = { ...host, eventLoopDelayP99Ms: 2_000 };
    expect(pressureStretch({ ...late, loadPerCpu: 1.5 })).toBe(2);
    expect(pressureStretch({ ...late, loadPerCpu: 8 })).toBe(3);
    expect(pressureStretch({ ...late, memoryAvailableBytes: 1.2 * GiB })).toBe(2);
    expect(pressureStretch({ ...late, memoryAvailableBytes: 8 * GiB, memoryPressure: 25 })).toBe(3);
    expect(pressureStretch({ ...late, loadPerCpu: 8, gatewayRssBytes: 6 * GiB })).toBe(1);
  });
});

describe('watchdog transitions', () => {
  const limits = {
    startupMs: 100,
    readyMs: 300,
    unhealthyMs: 30,
    recoverMs: 20,
    pollMs: 100,
    flapLimit: 3,
    flapWindowMs: 1_000,
  };
  const step = (state: WatchState, ...events: Parameters<typeof watchTransition>[1][]) =>
    events.reduce((current, event) => watchTransition(current, event, limits), state);
  const booting: WatchState = { phase: 'booting', since: 0, failed: false };

  it('moves booting → healthy → reducing → terminating, one deadline at a time', () => {
    expect(step(booting, { type: 'tick', at: 99 }).phase).toBe('booting');
    expect(step(booting, { type: 'tick', at: 100 })).toMatchObject({
      phase: 'reducing',
      since: 100,
    });
    const healthy = step(booting, { type: 'healthy', at: 10 });
    expect(step(healthy, { type: 'tick', at: 39 }).phase).toBe('healthy');
    const reducing = step(healthy, { type: 'tick', at: 40 });
    expect(reducing.phase).toBe('reducing');
    expect(step(reducing, { type: 'tick', at: 59 }).phase).toBe('reducing');
    expect(step(reducing, { type: 'tick', at: 60 })).toMatchObject({
      phase: 'terminating',
      failed: true,
    });
    expect(step(reducing, { type: 'healthy', at: 50 }).phase).toBe('healthy');
  });
  it('never leaves terminating, and a requested shutdown is not a failure', () => {
    const stopping = step(booting, { type: 'shutdown', at: 5, failed: false });
    expect(stopping).toMatchObject({ phase: 'terminating', failed: false });
    expect(step(stopping, { type: 'healthy', at: 6 }, { type: 'tick', at: 1_000 })).toBe(stopping);
  });
  it('skips judging a tick that follows its own sleep, and restarts the deadline there', () => {
    const healthy = step(booting, { type: 'healthy', at: 0 }, { type: 'tick', at: 5 });
    const woke = step(healthy, { type: 'tick', at: 3_600_000 });
    expect(woke).toMatchObject({ phase: 'healthy', since: 3_600_000 });
    expect(step(woke, { type: 'tick', at: 3_600_029 }).phase).toBe('healthy');
    expect(step(woke, { type: 'tick', at: 3_600_030 }).phase).toBe('reducing');
  });
  it('still judges a frozen gateway when every tick comes late', () => {
    let state = step(booting, { type: 'healthy', at: 0 }, { type: 'tick', at: 50 });
    for (let at = 450; at <= 2_050 && state.phase !== 'terminating'; at += 400)
      state = step(state, { type: 'tick', at });
    expect(state).toMatchObject({ phase: 'terminating', failed: true, frozen: true });
  });
  it('takes a late tick after an on-time one for another nap', () => {
    const napped = step(
      booting,
      { type: 'healthy', at: 0 },
      { type: 'tick', at: 5 },
      {
        type: 'tick',
        at: 1_000,
      },
    );
    const onTime = step(napped, { type: 'tick', at: 1_010 });
    expect(step(onTime, { type: 'tick', at: 5_000 })).toMatchObject({
      phase: 'healthy',
      since: 5_000,
    });
  });
});
