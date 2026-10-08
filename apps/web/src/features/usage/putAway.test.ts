import type { UsageSnapshot } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { isPutAway, limitInView, putAway, rearm } from './putAway';

const HOUR = 3_600_000;
const now = Date.UTC(2026, 9, 8, 12);
const weeklyResets = now + 23 * HOUR;

function plan(weeklyUsed: number, resetsAt = weeklyResets, engine = 'claude-code'): UsageSnapshot {
  const severity =
    weeklyUsed >= 100
      ? 'exhausted'
      : weeklyUsed >= 90
        ? 'critical'
        : weeklyUsed >= 75
          ? 'warning'
          : 'normal';
  return {
    engine,
    kind: 'plan',
    source: 'Claude Max',
    windows: [
      {
        id: 'session',
        label: 'Current session',
        usedPercent: 10,
        resetsAt: now + 2 * HOUR,
        severity: 'normal',
      },
      { id: 'weekly', label: 'This week', usedPercent: weeklyUsed, resetsAt, severity },
    ],
    spend: { today: 0, month: 0 },
    updatedAt: now,
  };
}

/** The limit in view, which these readings always have. */
function inView(usage: UsageSnapshot, at: number) {
  const limit = limitInView(usage, at);
  if (!limit) throw new Error('nothing in view');
  return limit;
}

describe('limitInView', () => {
  it('has nothing to say while a plan is healthy', () => {
    expect(limitInView(plan(60), now)).toBeUndefined();
  });

  it('speaks once a limit nears its end, for that provider, limit and cycle', () => {
    expect(limitInView(plan(75), now)).toEqual({
      engine: 'claude-code',
      window: 'weekly',
      resetsAt: weeklyResets,
    });
  });

  it('names the month for a budget, and the refusal for a blocked key', () => {
    const metered: UsageSnapshot = {
      engine: 'anthropic',
      kind: 'metered',
      source: 'Anthropic API',
      windows: [],
      spend: { today: 1, month: 46, budget: 50 },
      updatedAt: now,
    };
    expect(limitInView(metered, now)).toEqual({
      engine: 'anthropic',
      window: 'budget',
      resetsAt: new Date(2026, 10, 1).getTime(),
    });
    expect(limitInView({ ...metered, blocked: { until: now + HOUR } }, now)).toEqual({
      engine: 'anthropic',
      window: 'blocked',
      resetsAt: now + HOUR,
    });
  });
});

describe('putting the line away', () => {
  const weekly = inView(plan(96), now);

  it('keeps it away for the rest of the cycle, even as the limit gets closer or runs out', () => {
    const marks = putAway([], inView(plan(80), now), now);
    expect(isPutAway(marks, weekly, now)).toBe(true);
    expect(isPutAway(marks, inView(plan(100), now), now + 20 * HOUR)).toBe(true);
    // A reset time read again a few seconds off is the same cycle.
    expect(isPutAway(marks, inView(plan(96, weeklyResets + 4_000), now), now)).toBe(true);
  });

  it('is per provider and per limit', () => {
    const marks = putAway([], weekly, now);
    expect(isPutAway(marks, inView(plan(96, weeklyResets, 'codex-cli'), now), now)).toBe(false);
    expect(isPutAway(marks, { engine: 'claude-code', window: 'session' }, now)).toBe(false);
  });

  it('re-arms in the next cycle, when that one nears its end again', () => {
    const marks = putAway([], weekly, now);
    const nextWeek = weeklyResets + 7 * 24 * HOUR;
    const later = weeklyResets + 6 * 24 * HOUR;
    expect(isPutAway(marks, inView(plan(80, nextWeek), later), later)).toBe(false);
    // Even read before the old reset time passes on this clock: a later reset is a new cycle.
    expect(isPutAway(marks, inView(plan(80, nextWeek), now), now)).toBe(false);
  });

  it('keeps one entry per limit and drops ended cycles', () => {
    const old = { engine: 'codex-cli', window: 'session', resetsAt: now - HOUR };
    const marks = putAway([old, weekly], { ...weekly, resetsAt: weeklyResets + 60_000 }, now);
    expect(marks).toEqual([{ ...weekly, resetsAt: weeklyResets + 60_000 }]);
  });

  it('never grows without end', () => {
    let marks = putAway([], weekly, now);
    for (let i = 0; i < 40; i++)
      marks = putAway(
        marks,
        { engine: `server:${i}`, window: 'weekly', resetsAt: now + HOUR },
        now,
      );
    expect(marks.length).toBeLessThanOrEqual(20);
  });
});

describe('rearm', () => {
  it('drops an entry once its limit is healthy again (it reset), or its cycle ended', () => {
    const marks = [
      { engine: 'claude-code', window: 'weekly', resetsAt: weeklyResets },
      { engine: 'codex-cli', window: 'weekly', resetsAt: now - HOUR },
    ];
    expect(rearm(marks, plan(10), now)).toEqual([]);
  });

  it('holds an entry without a reset time until the limit is seen healthy', () => {
    const marks = [{ engine: 'claude-code', window: 'weekly' }];
    expect(rearm(marks, plan(92), now)).toBe(marks);
    expect(isPutAway(marks, inView(plan(92), now), now)).toBe(true);
    expect(rearm(marks, plan(20), now)).toEqual([]);
  });

  it('leaves the list alone when nothing changed, so nothing is saved', () => {
    const marks = putAway([], inView(plan(80), now), now);
    expect(rearm(marks, plan(85), now)).toBe(marks);
    expect(rearm(marks, plan(10, weeklyResets, 'codex-cli'), now)).toBe(marks);
  });
});
