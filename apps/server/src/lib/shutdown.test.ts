import { afterEach, describe, expect, it, vi } from 'vitest';

import { shutdownHandler } from './shutdown';

afterEach(() => vi.useRealTimers());

describe('coordinated shutdown', () => {
  it('saves progress before closing, and coalesces signals without changing the exit code', async () => {
    const order: string[] = [];
    let saved!: () => void;
    const drain = new Promise<void>((resolve) => {
      saved = resolve;
    });
    const exit = vi.fn();
    const shutdown = shutdownHandler({
      begin: () => {
        order.push('begin');
      },
      drain: () => {
        order.push('save');
        return drain;
      },
      close: async () => {
        order.push('close');
      },
      exit,
      warn: vi.fn(),
    });
    const first = shutdown(75);
    expect(shutdown(0)).toBe(first);
    expect(order).toEqual(['begin', 'save']);
    saved();
    await first;
    expect(order).toEqual(['begin', 'save', 'close']);
    expect(exit).toHaveBeenCalledExactlyOnceWith(75);
  });

  it('still cleans up when persistence stalls and ultimately exits if close stalls too', async () => {
    vi.useFakeTimers();
    const close = vi.fn(() => new Promise<void>(() => undefined));
    const exit = vi.fn();
    const warn = vi.fn();
    const shutdown = shutdownHandler({
      begin: vi.fn(),
      drain: () => new Promise<void>(() => undefined),
      close,
      exit,
      warn,
    });
    void shutdown(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(close).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('cleans up even when a checkpoint write fails', async () => {
    const close = vi.fn(async () => undefined);
    const exit = vi.fn();
    const shutdown = shutdownHandler({
      begin: vi.fn(),
      drain: async () => {
        throw new Error('disk full');
      },
      close,
      exit,
      warn: vi.fn(),
    });
    await shutdown(0);
    expect(close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });
});
