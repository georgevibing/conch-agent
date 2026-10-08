import { describe, expect, it } from 'vitest';
import type { ToolProgress } from '@conch/protocol';

import { PictureProgress, estimate } from './progress';

function clock() {
  let now = 0;
  let tick: (() => void) | undefined;
  return {
    now: () => now,
    every: (run: () => void) => {
      tick = run;
      return () => {
        tick = undefined;
      };
    },
    /** Move time on and let the estimate look. */
    step(ms: number) {
      now += ms;
      tick?.();
    },
    get running() {
      return Boolean(tick);
    },
  };
}

describe('how far a picture has come', () => {
  it('guesses quickly at first, slows down, and never claims it is done', () => {
    expect(estimate(0, 30_000)).toBe(0);
    expect(estimate(30_000, 30_000)).toBeGreaterThan(0.7);
    expect(estimate(30_000, 30_000)).toBeLessThan(0.8);
    expect(estimate(10 * 60_000, 30_000)).toBeLessThanOrEqual(0.9);
    let last = 0;
    for (let t = 0; t < 120_000; t += 1_000) {
      const now = estimate(t, 30_000);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it('says estimated while it guesses, at most twice a second, and stops at the picture', () => {
    const time = clock();
    const sent: ToolProgress[] = [];
    const progress = new PictureProgress({
      emit: (p) => sent.push(p),
      toolName: 'image_generate',
      by: 'your ChatGPT plan',
      typicalMs: 6_000,
      now: time.now,
      every: time.every,
    });
    progress.queued();
    progress.generating();
    for (let i = 0; i < 10; i++) time.step(100);
    // A second of guessing at 100 ms steps: two more events, not ten.
    expect(sent).toHaveLength(4);
    time.step(30_000);
    progress.finishing();
    expect(time.running).toBe(false);
    expect(sent[0]).toEqual({
      toolName: 'image_generate',
      progress: 0,
      stage: 'queued',
      by: 'your ChatGPT plan',
    });
    expect(sent.slice(1, -1).every((p) => p.estimated && p.stage === 'generating')).toBe(true);
    expect(sent.at(-1)).toMatchObject({ stage: 'finishing', progress: 0.95 });
    expect(sent.at(-1)).not.toHaveProperty('estimated');
    const values = sent.map((p) => p.progress ?? 0);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });

  it('takes the provider’s word over the guess once it sends a rough picture', () => {
    const time = clock();
    const sent: ToolProgress[] = [];
    const progress = new PictureProgress({
      emit: (p) => sent.push(p),
      toolName: 'image_generate',
      by: 'OpenAI',
      typicalMs: 45_000,
      now: time.now,
      every: time.every,
    });
    progress.queued();
    progress.generating();
    time.step(40_000);
    const guessed = sent.at(-1)?.progress ?? 0;
    progress.partial(0, 2, 'preview-1');
    const real = sent.at(-1);
    expect(real).toMatchObject({ stage: 'generating', preview: 'preview-1' });
    expect(real).not.toHaveProperty('estimated');
    // Never backwards, even when the word is behind the guess.
    expect(real?.progress).toBeGreaterThanOrEqual(guessed);
    time.step(5_000);
    expect(sent.at(-1)).toBe(real);
  });
});
