import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { watchGateway } from './watchdog';

afterEach(() => vi.useRealTimers());
function world() {
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
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(watch.failed()).toBe(true);
    vi.advanceTimersByTime(15);
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
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
    child.emit('message', {
      type: 'conch.heartbeat',
      healthy: true,
      resource: { running: 3, probeMs: 2, token: 'private', command: 'private' },
    });
    vi.advanceTimersByTime(30);
    expect(incident).toHaveBeenCalledWith('reduced-workload', { running: 3, probeMs: 2 });
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
