import { describe, expect, it } from 'vitest';

import {
  ERRORS_NUDGE,
  LOOP_NUDGE,
  LOOP_STOP,
  PATIENT_MS,
  SAME_NUDGE,
  SAME_STOP,
  stableJson,
  steady,
  turnBudget,
  TurnWatch,
} from './budget';

const roomy = { steps: 1_000, tokens: 1e12, ms: 1e12 };

describe('turnBudget', () => {
  const on = { on: true, steps: 100, tokens: 2_000_000, minutes: 30 };

  it('has no limit for a chat someone is watching, until they turn one on', () => {
    expect(turnBudget({})).toEqual({ steps: Infinity, tokens: Infinity, ms: Infinity });
    // Over the monthly budget doesn't pause a turn by itself: it only matters once limits are on.
    expect(turnBudget({ overBudget: true, limits: { ...on, on: false } }).steps).toBe(Infinity);
    expect(turnBudget({ local: true }).ms).toBe(Infinity);
  });

  it('gives a watched chat the limits a person set, halving tokens over the monthly budget', () => {
    const watched = turnBudget({ limits: { on: true, steps: 40, tokens: 500_000, minutes: 10 } });
    expect(watched).toEqual({ steps: 40, tokens: 500_000, ms: 10 * 60_000 });
    expect(turnBudget({ overBudget: true, limits: on }).tokens).toBe(1_000_000);
  });

  it('gives more room when nobody is watching, whatever the switch says', () => {
    const watched = turnBudget({ limits: on });
    const unattended = turnBudget({ unattended: true });
    expect(unattended.steps).toBeGreaterThan(watched.steps);
    expect(unattended.ms).toBeGreaterThan(watched.ms);
    expect(turnBudget({ unattended: true, limits: { ...on, on: false } })).toEqual(unattended);
  });

  it('never counts tokens for a model on this computer, and gives it longer', () => {
    const local = turnBudget({ local: true, limits: on });
    expect(local.tokens).toBe(Number.POSITIVE_INFINITY);
    expect(local.ms).toBeGreaterThan(turnBudget({ limits: on }).ms);
  });

  it('a turn with no limit never pauses on steps, tokens or time, but a loop still does', () => {
    let now = 0;
    const watch = new TurnWatch(turnBudget({}), () => now);
    watch.used({ inputTokens: 50_000_000, outputTokens: 1_000_000 });
    for (let i = 0; i < 500; i++) watch.round();
    now = 48 * 60 * 60_000;
    expect(watch.next().kind).toBe('go');
    expect(watch.outside().kind).toBe('go');
    const answers = Array.from({ length: LOOP_STOP }, () =>
      watch.result('browser_click', { id: 1 }, 'Nothing happened.', false),
    );
    expect(answers.some((v) => v.kind === 'nudge')).toBe(true);
    expect(answers.at(-1)).toMatchObject({ kind: 'stop', pause: { reason: 'loop' } });
  });
});

describe('TurnWatch', () => {
  it('pauses on steps, fresh tokens and time, in plain words', () => {
    let now = 0;
    const watch = new TurnWatch({ steps: 2, tokens: 1_000, ms: 60_000 }, () => now);
    expect(watch.next().kind).toBe('go');
    watch.round();
    watch.round();
    expect(watch.next()).toMatchObject({ kind: 'stop', pause: { reason: 'steps' } });

    const spend = new TurnWatch({ steps: 100, tokens: 1_000, ms: 60_000 });
    // Read from the cache doesn't count: 10,000 in, 9,500 cached, 400 out is 900 fresh.
    spend.used({ inputTokens: 10_000, cachedInputTokens: 9_500, outputTokens: 400 });
    expect(spend.next().kind).toBe('go');
    spend.used({ inputTokens: 20_000, cachedInputTokens: 19_000, outputTokens: 400 });
    expect(spend.next()).toMatchObject({ kind: 'stop', pause: { reason: 'tokens' } });

    const slow = new TurnWatch({ steps: 100, tokens: 1e9, ms: 60_000 }, () => now);
    now = 60_000;
    const late = slow.next();
    expect(late).toMatchObject({ kind: 'stop', pause: { reason: 'time' } });
    if (late.kind === 'stop') expect(late.pause.message).toMatch(/^Paused after 1 minute of work/);
  });

  it('asks the model to wrap up once, near the end', () => {
    const watch = new TurnWatch({ steps: 10, tokens: 1e9, ms: 1e9 });
    const verdicts = Array.from({ length: 10 }, () => watch.round().kind);
    expect(verdicts.filter((k) => k === 'nudge')).toHaveLength(1);
    expect(verdicts.indexOf('nudge')).toBe(8);
  });

  it('nudges the same call coming back with the same answer, twice, then pauses', () => {
    const watch = new TurnWatch(roomy);
    const kinds: string[] = [];
    for (let i = 0; i < LOOP_STOP; i++)
      kinds.push(
        watch.result(
          'browser_click',
          i % 2 ? { b: 1, a: 'x' } : { a: 'x', b: 1 },
          'No change.',
          false,
        ).kind,
      );
    expect(kinds[LOOP_NUDGE - 1]).toBe('nudge');
    expect(kinds[LOOP_NUDGE * 2 - 1]).toBe('nudge');
    expect(kinds.filter((k) => k === 'nudge')).toHaveLength(2);
    expect(kinds.slice(0, -1)).not.toContain('stop');
    expect(kinds.at(-1)).toBe('stop');
  });

  it('a changed answer is progress: checking on a test run as it moves along never pauses', () => {
    const watch = new TurnWatch(roomy);
    for (let i = 0; i < 200; i++)
      expect(
        watch.result(
          'shell',
          { command: 'python3 check.py' },
          `running: ${i} of 4278 passed`,
          false,
        ).kind,
      ).not.toBe('stop');
  });

  it('checks spaced out in time are waiting, not a loop', () => {
    let now = 0;
    const watch = new TurnWatch(roomy, () => now);
    for (let i = 0; i < 60; i++) {
      now += PATIENT_MS;
      expect(
        watch.result('shell', { command: 'tail -1 run.log' }, 'still running', false).kind,
      ).toBe('go');
    }
  });

  it('times, clocks and durations don’t make an answer new', () => {
    expect(steady('Done in 376ms at 09:43:12 (2026-10-05T07:43:12Z)')).toBe(
      steady('Done in 56ms at 09:44:01 (2026-10-05T07:44:01Z)'),
    );
    expect(steady('12 of 40 passed')).not.toBe(steady('13 of 40 passed'));
    const watch = new TurnWatch(roomy);
    const kinds = Array.from(
      { length: LOOP_STOP },
      (_, i) => watch.result('shell', { command: 'status' }, `idle, took ${i}ms`, false).kind,
    );
    expect(kinds.at(-1)).toBe('stop');
  });

  it('leaves a varied run of calls alone', () => {
    const watch = new TurnWatch(roomy);
    for (let i = 0; i < 200; i++) {
      expect(watch.call('browser_click', { ref: `e${i}` }).kind).toBe('go');
      expect(
        watch.result('browser_click', { ref: `e${i}` }, `page ${i} `.repeat(40), false).kind,
      ).toBe('go');
    }
  });

  it('tells the model about a run of failures, and never pauses for them', () => {
    const watch = new TurnWatch(roomy);
    const kinds = Array.from(
      { length: 50 },
      (_, i) => watch.result('shell', { command: `try ${i}` }, `failed ${i}`, true).kind,
    );
    expect(kinds[ERRORS_NUDGE - 1]).toBe('nudge');
    expect(kinds.filter((k) => k === 'nudge')).toHaveLength(1);
    expect(kinds).not.toContain('stop');
  });

  it('notices the same long answer coming back fast, but not a short confirmation', () => {
    const page = `Page: Shop\n${'- button "Next" [ref=e1]\n'.repeat(20)}`;
    const watch = new TurnWatch(roomy);
    const kinds = Array.from(
      { length: SAME_STOP },
      (_, i) => watch.result('browser_click', { ref: `e${i}` }, page, false).kind,
    );
    expect(kinds[SAME_NUDGE - 1]).toBe('nudge');
    expect(kinds.at(-1)).toBe('stop');

    const saved = new TurnWatch(roomy);
    for (let i = 0; i < 20; i++)
      expect(saved.result('remember', { text: `fact ${i}` }, 'Saved.', false).kind).toBe('go');
  });

  it('caps an outside agent by its calls, two to a step', () => {
    const watch = new TurnWatch({ steps: 3, tokens: 1e9, ms: 1e9 });
    for (let i = 0; i < 6; i++) watch.call('shell', { i });
    expect(watch.outside().kind).toBe('go');
    watch.call('shell', { i: 7 });
    expect(watch.outside()).toMatchObject({ kind: 'stop', pause: { reason: 'steps' } });
  });

  it('writes stable JSON', () => {
    expect(stableJson({ b: [1, { d: 1, c: 2 }], a: null })).toBe(
      '{"a":null,"b":[1,{"c":2,"d":1}]}',
    );
  });
});
