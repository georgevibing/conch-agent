import { describe as suite, expect, it } from 'vitest';

import { describe, nextRuns, perDay, preview, previousRun, toCron, validate } from './schedule';

const TZ = 'Europe/Berlin';

suite('schedules', () => {
  it('describes schedules consistently in plain language', () => {
    expect(describe({ type: 'daily', time: '08:00' }, TZ, 'en-US')).toBe('Every day at 8:00 AM');
    expect(
      describe(
        { type: 'weekly', days: ['fri', 'mon', 'tue', 'wed', 'thu'], time: '07:30' },
        TZ,
        'en-US',
      ),
    ).toBe('Every weekday at 7:30 AM');
    expect(describe({ type: 'weekly', days: ['sun'], time: '18:00' }, TZ, 'en-US')).toBe(
      'Every Sunday at 6:00 PM',
    );
    expect(
      describe({ type: 'weekly', days: ['mon', 'wed', 'fri'], time: '09:00' }, TZ, 'en-US'),
    ).toBe('Every Mon, Wed and Fri at 9:00 AM');
    expect(describe({ type: 'monthly', day: 1, time: '09:00' }, TZ, 'en-US')).toBe(
      'On the 1st of every month at 9:00 AM',
    );
    expect(describe({ type: 'monthly', day: 'last', time: '17:00' }, TZ, 'en-US')).toBe(
      'On the last day of every month at 5:00 PM',
    );
    expect(describe({ type: 'interval', every: 2, unit: 'hours' }, TZ)).toBe('Every 2 hours');
    expect(describe({ type: 'cron', expression: '0 9 * * 1-5' }, TZ)).toMatch(
      /Monday through Friday/,
    );
  });

  it('builds cron expressions', () => {
    expect(toCron({ type: 'weekly', days: ['mon', 'fri'], time: '07:05' })).toBe('5 7 * * 1,5');
    expect(toCron({ type: 'monthly', day: 'last', time: '17:00' })).toBe('0 17 L * *');
  });

  it('computes next runs in the routine timezone', () => {
    const from = Date.parse('2026-10-01T05:00:00Z'); // 07:00 in Berlin (CEST)
    const [next] = nextRuns({ type: 'daily', time: '08:00' }, TZ, { from });
    expect(new Date(next ?? 0).toISOString()).toBe('2026-10-01T06:00:00.000Z');
  });

  it('anchors intervals so they never drift', () => {
    const anchor = Date.parse('2026-10-01T00:00:00Z');
    const runs = nextRuns({ type: 'interval', every: 30, unit: 'minutes' }, TZ, {
      from: anchor + 45 * 60_000,
      anchor,
      count: 2,
    });
    expect(runs.map((t) => (t - anchor) / 60_000)).toEqual([60, 90]);
    expect(
      previousRun(
        { type: 'interval', every: 30, unit: 'minutes' },
        TZ,
        anchor + 95 * 60_000,
        anchor,
      ),
    ).toBe(anchor + 90 * 60_000);
  });

  it('rejects schedules that are too frequent, in the past, or invalid', () => {
    expect(() => validate({ type: 'interval', every: 5, unit: 'minutes' }, TZ)).toThrow(
      /every 15 minutes/,
    );
    expect(() => validate({ type: 'cron', expression: '* * * * *' }, TZ)).toThrow(
      /every 15 minutes/,
    );
    expect(() => validate({ type: 'once', at: '2020-01-01T00:00:00Z' }, TZ)).toThrow(
      /already passed/,
    );
    expect(() => validate({ type: 'cron', expression: 'banana bread' }, TZ)).toThrow(/isn’t valid/);
    expect(() => validate({ type: 'daily', time: '08:00' }, 'Mars/Olympus')).toThrow(/timezone/);
  });

  it('previews with next runs and a frequency estimate', () => {
    const p = preview({ type: 'interval', every: 1, unit: 'hours' }, TZ);
    expect(p).toMatchObject({ valid: true, text: 'Every hour', perDay: 24 });
    expect(p.next).toHaveLength(3);
    expect(
      perDay({ type: 'weekly', days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '08:00' }, TZ),
    ).toBeCloseTo(5 / 7, 0);
  });
});
