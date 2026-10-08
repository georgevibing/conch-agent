import { describe, expect, it } from 'vitest';

import { openNow, weekOf } from './hours';

const LONDON = 'Europe/London';
/** A moment in London: 2026-10-07 is a Wednesday (BST, UTC+1). */
const at = (iso: string) => new Date(iso);

describe('opening hours', () => {
  const weekdays = 'Mo-Fr 08:00-18:00; Sa 09:00-14:00';

  it('reads a working week with a short Saturday', () => {
    expect(openNow(weekdays, LONDON, at('2026-10-07T10:00:00+01:00'))).toEqual({
      open: true,
      at: '18:00',
    });
    // Wednesday evening: opens again in the morning, and says which.
    expect(openNow(weekdays, LONDON, at('2026-10-07T19:30:00+01:00'))).toEqual({
      open: false,
      at: '08:00',
      day: 'Thu',
    });
    expect(openNow(weekdays, LONDON, at('2026-10-07T06:30:00+01:00'))).toEqual({
      open: false,
      at: '08:00',
    });
    // Saturday afternoon, after closing: next is Monday.
    expect(openNow(weekdays, LONDON, at('2026-10-10T15:00:00+01:00'))).toEqual({
      open: false,
      at: '08:00',
      day: 'Mon',
    });
    expect(openNow(weekdays, LONDON, at('2026-10-10T09:30:00+01:00'))).toEqual({
      open: true,
      at: '14:00',
    });
  });

  it('reads the place’s own clock, not the gateway’s', () => {
    // 10:00 in London is 18:00 in Tokyo: a Tokyo café open 08:00-18:00 has just closed.
    const now = at('2026-10-07T10:00:00+01:00');
    expect(openNow('Mo-Fr 08:00-18:00', 'Asia/Tokyo', now)?.open).toBe(false);
    expect(openNow('Mo-Fr 08:00-18:00', LONDON, now)?.open).toBe(true);
  });

  it('knows 24/7 and every day around the clock', () => {
    expect(openNow('24/7', LONDON, at('2026-10-07T03:00:00+01:00'))).toEqual({
      open: true,
      always: true,
    });
    expect(openNow('Mo-Su 00:00-24:00', LONDON, at('2026-10-07T03:00:00+01:00'))).toEqual({
      open: true,
      always: true,
    });
  });

  it('carries late hours past midnight', () => {
    const bar = 'Mo-Sa 18:00-02:00; Su off';
    // Thursday 01:00 is still Wednesday night.
    expect(openNow(bar, LONDON, at('2026-10-08T01:00:00+01:00'))).toEqual({
      open: true,
      at: '02:00',
    });
    expect(openNow(bar, LONDON, at('2026-10-11T20:00:00+01:00'))).toEqual({
      open: false,
      at: '18:00',
      day: 'Mon',
    });
  });

  it('reads split days, day lists, and a later rule that overrides', () => {
    const split = 'Mo,We,Fr 09:00-12:00,14:00-18:00';
    expect(openNow(split, LONDON, at('2026-10-07T13:00:00+01:00'))).toEqual({
      open: false,
      at: '14:00',
    });
    expect(openNow(split, LONDON, at('2026-10-08T10:00:00+01:00'))?.open).toBe(false);
    expect(
      openNow('Mo-Su 10:00-22:00; We off', LONDON, at('2026-10-07T12:00:00+01:00'))?.open,
    ).toBe(false);
    expect(
      openNow('Mo-Fr 08:00-18:00, Sa 10:00-14:00', LONDON, at('2026-10-10T11:00:00+01:00')),
    ).toEqual({ open: true, at: '14:00' });
    expect(
      openNow('Mo-Sa 09:00-18:00; PH,Su off', LONDON, at('2026-10-07T12:00:00+01:00'))?.open,
    ).toBe(true);
  });

  it('gives no answer for hours it can’t read, rather than a wrong one', () => {
    for (const hours of [
      'Jan-Mar Mo-Fr 09:00-17:00',
      'sunrise-sunset',
      'Mo-Fr 09:00-17:00 "by appointment"',
      'Mo-Fr 09:00-17:00 || "call us"',
      'by appointment',
      'Mo-Fr 9-5',
      '',
    ])
      expect(openNow(hours, LONDON, at('2026-10-07T12:00:00+01:00'))).toBeUndefined();
    expect(openNow('Mo-Fr 09:00-17:00', undefined)).toBeUndefined();
    expect(openNow('Mo-Fr 09:00-17:00', 'Not/AZone')).toBeUndefined();
    expect(weekOf('Mo-Fr 09:00-17:00')).not.toBeUndefined();
  });
});
