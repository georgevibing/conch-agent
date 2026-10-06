import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserStepBudget, BrowserStepStopped } from './step-budget';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  vi.useFakeTimers();
  const stop = new AbortController();
  const state = vi.fn();
  const cancel = vi.fn();
  const budget = new BrowserStepBudget(stop.signal, { timeoutMs: 100, state, cancel });
  return { stop, state, cancel, budget };
}
afterEach(() => vi.useRealTimers());

describe('browser active-work deadlines', () => {
  it('bounds active work, requests cancellation once and rejects late continuation', async () => {
    const { budget, cancel } = setup();
    const work = deferred<string>();
    const result = budget.run(() => work.promise);
    const checked = expect(result).rejects.toBeInstanceOf(BrowserStepStopped);
    await vi.advanceTimersByTimeAsync(101);
    await checked;
    expect(cancel).toHaveBeenCalledExactlyOnceWith(false);
    expect(() => budget.check()).toThrow('Check the page before repeating');
    work.resolve('too late');
    await vi.advanceTimersByTimeAsync(500);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pauses for a person and resumes the remaining budget without resetting it', async () => {
    const { budget, state, cancel } = setup();
    const ready = deferred<undefined>();
    const person = deferred<undefined>();
    const never = deferred<undefined>();
    const result = budget.run(async () => {
      await ready.promise;
      await budget.wait('Waiting for your approval', () => person.promise);
      return never.promise;
    });
    const checked = expect(result).rejects.toBeInstanceOf(BrowserStepStopped);
    await vi.advanceTimersByTimeAsync(40);
    ready.resolve(undefined);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state).toHaveBeenCalledWith('Waiting for your approval');
    expect(cancel).not.toHaveBeenCalled();
    person.resolve(undefined);
    await vi.advanceTimersByTimeAsync(50);
    expect(cancel).not.toHaveBeenCalled();
    expect(state).toHaveBeenLastCalledWith(undefined);
    await vi.advanceTimersByTimeAsync(11);
    await checked;
    never.resolve(undefined);
  });

  it('Stop ends a human wait without closing the browser or resuming the action', async () => {
    const { budget, stop, cancel } = setup();
    const person = deferred<undefined>();
    const action = vi.fn();
    const result = budget.run(async () => {
      await budget.wait('Waiting for you in the browser', () => person.promise);
      action();
    });
    const checked = expect(result).rejects.toThrow('Stopped.');
    await vi.advanceTimersByTimeAsync(1);
    stop.abort();
    await checked;
    expect(cancel).toHaveBeenCalledExactlyOnceWith(true);
    person.resolve(undefined);
    await vi.advanceTimersByTimeAsync(500);
    expect(action).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not run with an already-stopped parent', async () => {
    const { budget, stop } = setup();
    stop.abort();
    const work = vi.fn(async () => undefined);
    await expect(budget.run(work)).rejects.toThrow('Stopped.');
    expect(work).not.toHaveBeenCalled();
  });

  it('disarms after success and failure', async () => {
    const { budget, stop, cancel } = setup();
    await expect(budget.run(async () => 'done')).resolves.toBe('done');
    stop.abort();
    await vi.advanceTimersByTimeAsync(500);
    expect(cancel).not.toHaveBeenCalled();
    const next = setup();
    await expect(
      next.budget.run(async () => {
        throw new Error('closed');
      }),
    ).rejects.toThrow('closed');
    await vi.advanceTimersByTimeAsync(500);
    expect(next.cancel).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
