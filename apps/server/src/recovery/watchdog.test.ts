import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  pressureStretch,
  RELIEF_COOLDOWN_MS,
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
  it('takes back the kill of a frozen gateway that answers before it, until it keeps doing so', () => {
    const { child, watch, incident } = world({ stopMs: 15_000 });
    const beat = () => child.emit('message', { type: 'conch.heartbeat', healthy: true });
    /** Answers every heartbeat for `ms`, past the 2.5 s kill. */
    const answer = (ms: number) => {
      for (let t = 0; t < ms; t += 5) {
        beat();
        vi.advanceTimersByTime(5);
      }
    };
    /** Frozen through reduction to the kill, then it answers 1.5 s into the 2.5 s grace. */
    const freeze = () => {
      vi.advanceTimersByTime(60);
      expect(watch.failed()).toBe(true);
      vi.advanceTimersByTime(1_500);
      answer(1_100);
    };
    beat();
    freeze();
    expect(child.kill).not.toHaveBeenCalled();
    expect(watch.failed()).toBe(false);
    expect(incident.mock.calls.map(([reason]) => reason)).toEqual([
      'reduced-workload',
      'unresponsive',
      'responsive',
    ]);
    // It is watched as before: the next freeze reduces work again.
    freeze();
    expect(child.send).toHaveBeenCalledTimes(2);
    expect(child.kill).not.toHaveBeenCalled();
    // The third time in the flap window is a restart, whatever it says next.
    vi.advanceTimersByTime(40);
    expect(watch.failed()).toBe(true);
    answer(3_000);
    expect(child.kill.mock.calls).toEqual([['SIGKILL']]);
    expect(watch.failed()).toBe(true);
    watch.close();
  });
  it('never takes back a requested stop, or the kill of a gateway that was sent SIGTERM', () => {
    const asked = world({ stopMs: 15_000 });
    asked.child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(50);
    asked.watch.stop();
    vi.advanceTimersByTime(1_500);
    asked.child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(1_010);
    expect(asked.child.kill.mock.calls).toEqual([['SIGKILL']]);
    asked.watch.close();
    const quitting = world({ stopMs: 15_000 });
    quitting.child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(50);
    quitting.child.emit('message', { type: 'conch.stopping' });
    vi.advanceTimersByTime(1_500);
    quitting.child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(1_010);
    expect(quitting.child.kill.mock.calls).toEqual([['SIGKILL']]);
    quitting.watch.close();
    let stopping = false;
    const quit = world({ stopMs: 15_000, stopping: () => stopping });
    quit.child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(50);
    stopping = true;
    vi.advanceTimersByTime(1_500);
    quit.child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(1_010);
    expect(quit.child.kill.mock.calls).toEqual([['SIGKILL']]);
    quit.watch.close();
    const answering = world({ frozenStopMs: 3 });
    answering.child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(35);
    answering.child.emit('message', { type: 'conch.heartbeat', healthy: false });
    vi.advanceTimersByTime(15);
    answering.child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(15);
    expect(answering.child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expect(answering.watch.failed()).toBe(true);
    answering.watch.close();
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
    // Twice recoverMs; shedding again waits out the gateway's cooldown.
    beat(20);
    expect(child.send).toHaveBeenCalledOnce();
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
  it('asks a stretched reduction to shed again only once the gateway would act on it', () => {
    const { child, watch } = world({
      unhealthyMs: 30_000,
      recoverMs: 20_000,
      pollMs: 5_000,
      stopMs: 15_000,
    });
    const starved = { gatewayRssBytes: 200, memoryTotalBytes: 16_000, loadPerCpu: 8 };
    const beat = (healthy: boolean) =>
      child.emit('message', { type: 'conch.heartbeat', healthy, resource: starved });
    beat(true);
    const sent: number[] = [];
    child.send.mockImplementation(() => sent.push(Date.now()));
    const start = Date.now();
    for (let t = 0; t < 150_000 && !child.kill.mock.calls.length; t += 5_000) {
      vi.advanceTimersByTime(5_000);
      beat(false);
    }
    const at = sent.map((time) => time - start);
    expect(at.length).toBeGreaterThan(1);
    for (const [i, time] of at.slice(1).entries())
      expect(time - (at[i] ?? 0)).toBeGreaterThan(RELIEF_COOLDOWN_MS);
    watch.close();
  });
  /** Real deadlines, and a gateway that answers every heartbeat it is awake for. */
  function cycling(extra: Partial<WatchdogOptions> = {}) {
    const test = world({
      startupMs: 120_000,
      unhealthyMs: 30_000,
      recoverMs: 20_000,
      pollMs: 5_000,
      stopMs: 15_000,
      flapWindowMs: 5 * 60_000,
      ...extra,
    });
    /** Runs for `ms`, a second at a time, beating when `awake` says it answered at that second. */
    const run = (ms: number, awake: (second: number) => boolean, resource?: object) => {
      for (let t = 1_000; t <= ms && !test.child.kill.mock.calls.length; t += 1_000) {
        vi.advanceTimersByTime(1_000);
        if (awake(t / 1_000))
          test.child.emit('message', { type: 'conch.heartbeat', healthy: true, resource });
      }
    };
    test.child.emit('message', { type: 'conch.heartbeat', healthy: true });
    return { ...test, run };
  }
  // Stopped 25 s out of every 30 (SIGSTOP), answering twice in between: never 30 s silent.
  const dutyCycle = (second: number) => second % 30 === 25 || second % 30 === 29;
  it('reduces work for a gateway that stops answering again and again, each time briefly', () => {
    const { child, watch, incident, run } = cycling();
    run(130_000, dutyCycle);
    expect(child.send).toHaveBeenCalledWith({ type: 'conch.recover' }, expect.any(Function));
    expect(incident.mock.calls[0]?.[0]).toBe('reduced-workload');
    expect(child.kill).not.toHaveBeenCalled();
    // It keeps doing it: the flap limit restarts it.
    run(15 * 60_000, dutyCycle);
    expect(watch.failed()).toBe(true);
    expect(child.kill).toHaveBeenCalled();
    watch.close();
  });
  it('leaves a healthy gateway that misses a heartbeat now and then alone', () => {
    const { child, watch, incident, run } = cycling();
    run(15 * 60_000, (second) => second % 5 === 0 && second % 35 !== 0);
    expect(child.send).not.toHaveBeenCalled();
    expect(incident).not.toHaveBeenCalled();
    watch.close();
  });
  it('does not count brief stalls against a gateway while other programs starve the computer', () => {
    const { child, watch, run } = cycling();
    const starved = { gatewayRssBytes: 200, memoryTotalBytes: 16_000, loadPerCpu: 2 };
    run(15 * 60_000, dutyCycle, starved);
    expect(child.send).not.toHaveBeenCalled();
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

  it('stops a gateway that has stopped answering after the short grace, not the whole stop', () => {
    const { child, watch } = world({ stopMs: 15_000, startupMs: 120_000 });
    child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(11);
    expect(watch.stop('SIGINT')).toBe('unanswered');
    expect(child.kill.mock.calls).toEqual([['SIGINT']]);
    vi.advanceTimersByTime(2_500);
    expect(child.kill.mock.calls).toEqual([['SIGINT'], ['SIGKILL']]);
    expect(watch.failed()).toBe(false);
    watch.close();
  });
  it('gives a gateway that still talks, or an old one that never does, the whole stop', () => {
    const talking = world({ stopMs: 15_000, startupMs: 120_000 });
    talking.child.emit('message', { type: 'conch.heartbeat', healthy: true });
    vi.advanceTimersByTime(10);
    expect(talking.watch.stop()).toBe('asked');
    vi.advanceTimersByTime(14_999);
    expect(talking.child.kill.mock.calls).toEqual([['SIGTERM']]);
    talking.watch.close();
    const old = world({ stopMs: 15_000, enabled: false });
    vi.advanceTimersByTime(60_000);
    expect(old.watch.stop()).toBe('asked');
    vi.advanceTimersByTime(14_999);
    expect(old.child.kill.mock.calls).toEqual([['SIGTERM']]);
    old.watch.close();
  });
  it('ends it at once when asked to stop again', () => {
    const { child, watch } = world({ stopMs: 15_000 });
    expect(watch.stop('SIGINT')).toBe('asked');
    expect(watch.stop('SIGINT')).toBe('forced');
    expect(child.kill.mock.calls).toEqual([['SIGINT'], ['SIGKILL']]);
    watch.close();
    // Already stopping by itself, the first request waits for it; the second does not.
    const quitting = world({ stopMs: 15_000 });
    quitting.child.emit('message', { type: 'conch.stopping' });
    expect(quitting.watch.stop()).toBe('asked');
    expect(quitting.child.kill).not.toHaveBeenCalled();
    expect(quitting.watch.stop()).toBe('forced');
    expect(quitting.child.kill.mock.calls).toEqual([['SIGKILL']]);
    quitting.watch.close();
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
  it('starts the health window again after a nap, and never judges it while booting', () => {
    const sparse = { ...limits, pollMs: 10, unhealthyMs: 1_000, healthWindowMs: 100 };
    const run = (state: WatchState, from: number, to: number) => {
      for (let at = from; at <= to; at += 10)
        state = watchTransition(state, { type: 'tick', at }, sparse);
      return state;
    };
    expect(run(booting, 10, 90).phase).toBe('booting');
    const healthy = watchTransition(booting, { type: 'healthy', at: 0 }, sparse);
    expect(run(healthy, 10, 90).phase).toBe('healthy');
    expect(run(healthy, 10, 100).phase).toBe('reducing');
    const woke = run(
      watchTransition(run(healthy, 10, 50), { type: 'tick', at: 500 }, sparse),
      510,
      590,
    );
    expect(woke.phase).toBe('healthy');
    expect(run(woke, 600, 600).phase).toBe('reducing');
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
