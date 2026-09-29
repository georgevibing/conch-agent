import { describe, expect, it } from 'vitest';

import { formatRunDuration, formatWhen, formatWhenInline } from './time';

// Thursday 16 Oct 2025, 10:00 in Berlin (08:00 UTC).
const now = Date.UTC(2025, 9, 16, 8, 0);
const opts = { now, locale: 'en-US', timeZone: 'Europe/Berlin' };
const at = (dayOffset: number, h: number, m = 0) => Date.UTC(2025, 9, 16 + dayOffset, h - 2, m);

describe('formatWhen', () => {
  it('uses relative minutes close to now', () => {
    expect(formatWhen(now + 20_000, opts)).toBe('In less than a minute');
    expect(formatWhen(now - 20_000, opts)).toBe('Just now');
    expect(formatWhen(now + 5 * 60_000, opts)).toBe('In 5 minutes');
    expect(formatWhen(now + 60_000, opts)).toBe('In 1 minute');
    expect(formatWhen(now - 12 * 60_000, opts)).toBe('12 minutes ago');
  });

  it('names nearby days', () => {
    expect(formatWhen(at(0, 18), opts)).toBe('Today at 6:00 PM');
    expect(formatWhen(at(1, 8), opts)).toBe('Tomorrow at 8:00 AM');
    expect(formatWhen(at(-1, 8), opts)).toBe('Yesterday at 8:00 AM');
    expect(formatWhen(at(3, 8), opts)).toBe('Sunday at 8:00 AM');
    expect(formatWhen(at(-3, 8), opts)).toBe('Monday at 8:00 AM');
  });

  it('falls back to a date, adding the year only when it differs', () => {
    // (Before the late-October DST switch, so the UTC offset is still +2.)
    expect(formatWhen(at(8, 8), opts)).toBe('Oct 24 at 8:00 AM');
    expect(formatWhen(Date.UTC(2026, 0, 5, 7), opts)).toBe('Jan 5, 2026 at 8:00 AM');
  });

  it('respects the timezone when deciding what "today" is', () => {
    // 23:30 UTC on the 16th is already the 17th in Berlin.
    const late = Date.UTC(2025, 9, 16, 22, 30);
    expect(formatWhen(late, opts)).toBe('Tomorrow at 12:30 AM');
    expect(formatWhen(late, { ...opts, timeZone: 'UTC' })).toBe('Today at 10:30 PM');
  });

  it('follows the locale clock', () => {
    const text = formatWhen(at(1, 20), { ...opts, locale: 'en-GB' });
    expect(text).toBe('Tomorrow at 20:00');
  });

  it('has an inline variant for mid-sentence use', () => {
    expect(formatWhenInline(at(1, 8), opts)).toBe('tomorrow at 8:00 AM');
    expect(formatWhenInline(at(3, 8), opts)).toBe('Sunday at 8:00 AM');
  });
});

describe('formatRunDuration', () => {
  it('reads naturally', () => {
    expect(formatRunDuration(400)).toBe('1s');
    expect(formatRunDuration(12_000)).toBe('12s');
    expect(formatRunDuration(3 * 60_000)).toBe('3 min');
    expect(formatRunDuration(65 * 60_000)).toBe('1 h 5 min');
    expect(formatRunDuration(120 * 60_000)).toBe('2 h');
  });
});
