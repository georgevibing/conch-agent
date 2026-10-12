import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootHeartbeat, parentChannel } from './boot';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('boot heartbeat', () => {
  it('says it is starting at once, then beats every interval', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const boot = bootHeartbeat(send, { intervalMs: 100 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith({ type: 'conch.booting', phase: 'starting' });
    vi.advanceTimersByTime(350);
    expect(send).toHaveBeenCalledTimes(4);
    boot.stop();
  });

  it('says each new phase at once and carries it on every beat after', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const boot = bootHeartbeat(send, { intervalMs: 100 });
    boot.phase('restore');
    expect(send).toHaveBeenLastCalledWith({ type: 'conch.booting', phase: 'restore' });
    vi.advanceTimersByTime(100);
    boot.phase('listen');
    vi.advanceTimersByTime(100);
    expect(send.mock.calls.map(([message]) => message)).toEqual([
      { type: 'conch.booting', phase: 'starting' },
      { type: 'conch.booting', phase: 'restore' },
      { type: 'conch.booting', phase: 'restore' },
      { type: 'conch.booting', phase: 'listen' },
      { type: 'conch.booting', phase: 'listen' },
    ]);
    boot.stop();
  });

  it('goes quiet once stopped, even if a phase comes late', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const boot = bootHeartbeat(send, { intervalMs: 100 });
    boot.stop();
    boot.phase('probe');
    boot.stop();
    vi.advanceTimersByTime(1_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never throws when the parent has gone away', () => {
    vi.useFakeTimers();
    const send = vi.fn(() => {
      throw new Error('channel closed');
    });
    const boot = bootHeartbeat(send, { intervalMs: 100 });
    expect(() => boot.phase('services')).not.toThrow();
    expect(() => vi.advanceTimersByTime(300)).not.toThrow();
    expect(send).toHaveBeenCalledTimes(5);
    boot.stop();
  });

  it('does nothing without a parent to tell', () => {
    vi.useFakeTimers();
    const boot = bootHeartbeat(undefined, { intervalMs: 100 });
    boot.phase('app');
    expect(vi.getTimerCount()).toBe(0);
    boot.stop();
  });

  it('does not keep the process alive', () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    const boot = bootHeartbeat(vi.fn(), { intervalMs: 100_000 });
    const timer = interval.mock.results[0]?.value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(false);
    boot.stop();
  });
});

describe('parent channel', () => {
  const original = { send: process.send, connected: process.connected };
  const connected = (value: boolean) =>
    Object.defineProperty(process, 'connected', { value, configurable: true });
  afterEach(() => {
    process.send = original.send;
    connected(original.connected);
  });

  it('is absent when nothing started this process over IPC', () => {
    process.send = undefined;
    expect(parentChannel()).toBeUndefined();
  });

  it('sends only while the channel is open', () => {
    const send = vi.fn(() => true);
    process.send = send;
    connected(true);
    const channel = parentChannel();
    channel?.({ type: 'conch.booting', phase: 'app' });
    connected(false);
    channel?.({ type: 'conch.booting', phase: 'listen' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      { type: 'conch.booting', phase: 'app' },
      expect.any(Function),
    );
  });
});
