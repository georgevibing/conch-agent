import { describe, expect, it } from 'vitest';

import {
  addDays,
  dayDate,
  dayKey,
  dayName,
  dayOf,
  shortWhen,
  timeOf,
  usesTwelveHours,
} from './time';

const now = Date.UTC(2026, 9, 3, 10, 0); // Saturday 3 October 2026, 10:00 UTC
const utc = { now, timeZone: 'UTC', locale: 'en-GB' };

describe('days in the reader’s words', () => {
  it('names days around today, then by weekday', () => {
    expect(dayName('2026-10-03', utc)).toBe('Today');
    expect(dayName('2026-10-04', utc)).toBe('Tomorrow');
    expect(dayName('2026-10-02', utc)).toBe('Yesterday');
    expect(dayName('2026-10-06', utc)).toBe('Tuesday');
    expect(dayDate('2026-10-06', utc)).toBe('Tue 6 Oct');
    expect(dayDate('2027-01-06', utc)).toBe('Wed 6 Jan 2027');
  });

  it('reads a day in the reader’s time zone, and an end as the day before', () => {
    expect(dayKey(Date.UTC(2026, 9, 3, 23, 30), 'Europe/Athens')).toBe('2026-10-04');
    expect(dayOf('2026-10-03T23:30:00Z', 'Europe/Athens')).toBe('2026-10-04');
    expect(dayOf('2026-10-05', 'UTC', true)).toBe('2026-10-04');
    expect(dayOf('2026-10-05T00:00:00Z', 'UTC', true)).toBe('2026-10-04');
    expect(dayOf('soon')).toBeUndefined();
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('says when something arrived like a mail app', () => {
    expect(shortWhen('2026-10-03T08:15:00Z', utc)).toBe('08:15');
    expect(shortWhen('2026-10-02T08:15:00Z', utc)).toBe('Yesterday');
    expect(shortWhen('2026-09-29T08:15:00Z', utc)).toBe('Tue');
    expect(shortWhen('2026-08-29T08:15:00Z', utc)).toBe('29 Aug');
    expect(shortWhen('2025-08-29T08:15:00Z', utc)).toBe('29 Aug 2025');
    expect(shortWhen('not a date', utc)).toBe('');
  });

  it.each([
    ['en-US', '9:05 AM', true],
    ['en-GB', '09:05', false],
  ])('writes the clock the way %s does', (locale, text, twelve) => {
    expect(timeOf(Date.UTC(2026, 9, 3, 9, 5), { locale, timeZone: 'UTC' })).toBe(text);
    expect(usesTwelveHours(locale)).toBe(twelve);
  });
});
