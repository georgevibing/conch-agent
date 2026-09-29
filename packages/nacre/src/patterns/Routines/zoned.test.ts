import { describe, expect, it } from 'vitest';

import { fromZonedIso, toZonedIso } from './zoned';

describe('zoned time helpers', () => {
  it('builds ISO strings with the right offset, including across DST', () => {
    expect(toZonedIso('2025-07-01', '08:00', 'Europe/Berlin')).toBe('2025-07-01T08:00:00+02:00');
    expect(toZonedIso('2025-12-01', '08:00', 'Europe/Berlin')).toBe('2025-12-01T08:00:00+01:00');
    expect(toZonedIso('2025-12-01', '08:00', 'America/New_York')).toBe('2025-12-01T08:00:00-05:00');
    expect(toZonedIso('2025-12-01', '08:00', 'Asia/Kolkata')).toBe('2025-12-01T08:00:00+05:30');
  });

  it('reads them back as wall-clock time in the zone', () => {
    expect(fromZonedIso('2025-07-01T08:00:00+02:00', 'Europe/Berlin')).toEqual({
      date: '2025-07-01',
      time: '08:00',
    });
    expect(fromZonedIso('2025-07-01T08:00:00+02:00', 'UTC')).toEqual({
      date: '2025-07-01',
      time: '06:00',
    });
  });
});
