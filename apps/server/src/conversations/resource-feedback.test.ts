import { describe, expect, it } from 'vitest';
import { resourceFeedback } from './resource-feedback';
import type { WorkloadPace } from '../recovery/pace';

const normal: WorkloadPace = {
  phase: 'normal',
  cause: 'recovery',
  concurrency: 4,
  critical: false,
};
const busy: WorkloadPace = {
  phase: 'constrained',
  cause: 'memory',
  concurrency: 1,
  critical: false,
};

describe('resource feedback at tool boundaries', () => {
  it('coalesces parallel calls, suppresses metric chatter, and tells each chat independently', async () => {
    let state = normal;
    const signal = new AbortController().signal;
    const one = resourceFeedback(() => state, signal);
    const two = resourceFeedback(() => state, signal);
    expect(one.take()).toBeUndefined();
    state = busy;
    const notes = await Promise.all(Array.from({ length: 30 }, async () => one.take()));
    expect(notes.filter(Boolean)).toHaveLength(1);
    expect(two.take()).toContain('approaching');
    state = { ...busy, concurrency: 0 };
    expect(one.take()).toBeUndefined();
  });
  it('escalates immediately, then rate-limits recovery and reports restoration once', () => {
    let now = 0;
    let state = busy;
    const feedback = resourceFeedback(
      () => state,
      new AbortController().signal,
      () => now,
    );
    expect(feedback.take()).toContain('one command');
    state = { ...busy, phase: 'held', concurrency: 0, critical: true };
    expect(feedback.take()).toContain('critical memory');
    state = { ...normal, phase: 'recovering', concurrency: 0 };
    expect(feedback.take()).toBeUndefined();
    now = 30_000;
    expect(feedback.take()).toContain('easing');
    state = normal;
    now = 60_000;
    expect(feedback.take()).toContain('cleared');
    expect(feedback.take()).toBeUndefined();
  });
  it('refreshes current conditions in a new turn so old provider context cannot keep a stale warning', () => {
    const feedback = resourceFeedback(() => normal, new AbortController().signal);
    expect(feedback.take(true)).toContain('currently has room');
    expect(feedback.take()).toBeUndefined();
  });
  it('does not deliver feedback after Stop or consume another turn’s state', async () => {
    const stop = new AbortController();
    const feedback = resourceFeedback(() => busy, stop.signal);
    stop.abort();
    expect(feedback.take(true)).toBeUndefined();
    expect(resourceFeedback(() => busy, new AbortController().signal).take()).toContain(
      'approaching',
    );
  });
});
