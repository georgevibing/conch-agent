import { describe, expect, it } from 'vitest';

import { DONE_LINES, WAITING_LINES, ago, pick, plural, span, until } from './words';

const MIN = 60_000;
const now = new Date(2026, 9, 3, 12, 0).getTime();

describe('words', () => {
  it('counts things the way people do', () => {
    expect(plural(1, 'device')).toBe('1 device');
    expect(plural(0, 'device')).toBe('0 devices');
    expect(plural(2, 'passkey')).toBe('2 passkeys');
    expect(plural(3, 'person', 'people')).toBe('3 people');
  });

  it('says how long ago', () => {
    expect(ago(now - 10_000, now)).toBe('just now');
    expect(ago(now - 5 * MIN, now)).toBe('5 minutes ago');
    expect(ago(now - 61 * MIN, now)).toBe('1 hour ago');
    expect(ago(now - 30 * 60 * MIN, now)).toBe('yesterday');
    expect(ago(now - 3 * 24 * 60 * MIN, now)).toBe('3 days ago');
    expect(ago(now - 90 * 24 * 60 * MIN, now)).toMatch(/^on /);
  });

  it('says how long something lasts', () => {
    expect(span(10 * MIN)).toBe('10 minutes');
    expect(span(60 * MIN)).toBe('an hour');
    expect(span(3 * 60 * MIN)).toBe('3 hours');
    expect(span(4 * 24 * 60 * MIN)).toBe('4 days');
  });

  it('says when something runs out', () => {
    expect(until(now + 10 * MIN, now)).toBe('for 10 minutes');
    expect(until(now + 60 * MIN, now)).toBe('for an hour');
    expect(until(now + 3 * 60 * MIN, now)).toMatch(/^until \d{2}.\d{2}/);
    expect(until(now + 2 * 24 * 60 * MIN, now)).toMatch(/^until \S+ \d{2}.\d{2}/);
    expect(until(now + 40 * 24 * 60 * MIN, now)).not.toMatch(/\d{2}:\d{2}/);
    expect(until(now - MIN, now)).toBe('no longer');
  });

  it('picks the same line for the same seed, and every line can come up', () => {
    expect(pick(DONE_LINES, 3)).toBe(pick(DONE_LINES, 3));
    const seen = new Set(WAITING_LINES.map((_, i) => pick(WAITING_LINES, i)));
    expect(seen.size).toBe(WAITING_LINES.length);
    expect(() => pick([], 1)).toThrow();
  });
});
