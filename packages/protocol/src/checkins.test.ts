import { describe, expect, it } from 'vitest';

import {
  CheckInBody,
  CreateStandingOrderBody,
  inQuietHours,
  standingOrderKind,
  standingOrderPower,
  UpdateStandingOrderBody,
} from './checkins';

describe('quiet hours', () => {
  const at = (h: number, m = 0) => h * 60 + m;

  it('cross midnight the way people mean them', () => {
    const night = { from: '22:00', to: '07:00' };
    expect(inQuietHours(at(23), night)).toBe(true);
    expect(inQuietHours(at(3), night)).toBe(true);
    expect(inQuietHours(at(7), night)).toBe(false);
    expect(inQuietHours(at(21, 59), night)).toBe(false);
  });

  it('work within one day too, and the same time twice means none', () => {
    expect(inQuietHours(at(13), { from: '12:00', to: '14:00' })).toBe(true);
    expect(inQuietHours(at(15), { from: '12:00', to: '14:00' })).toBe(false);
    expect(inQuietHours(at(15), { from: '09:00', to: '09:00' })).toBe(false);
  });
});

describe('standing orders on the wire', () => {
  it('are one line of the person’s words', () => {
    expect(CreateStandingOrderBody.safeParse({ text: 'Tell me if a flight changes' }).success).toBe(
      true,
    );
    expect(CreateStandingOrderBody.safeParse({ text: 'a\nb c' }).success).toBe(false);
    expect(CreateStandingOrderBody.safeParse({ text: 'x'.repeat(241) }).success).toBe(false);
    expect(CreateStandingOrderBody.safeParse({ text: 'ok', extra: 1 }).success).toBe(false);
  });

  it('refuse an empty change, and a check-in change that names nothing', () => {
    expect(UpdateStandingOrderBody.safeParse({}).success).toBe(false);
    expect(UpdateStandingOrderBody.safeParse({ state: 'draft' }).success).toBe(false);
    expect(CheckInBody.safeParse({}).success).toBe(false);
    expect(CheckInBody.safeParse({ everyMinutes: 5 }).success).toBe(false);
  });

  it('are read as what to tell or what’s welcome, and power is noticed', () => {
    expect(standingOrderKind('Let me know when Anna writes')).toBe('tell');
    expect(standingOrderKind('Go ahead and decline meetings on Fridays')).toBe('may');
    expect(standingOrderPower('Never ask before pushing')).toBe(true);
    expect(standingOrderPower('Tell me if my rent goes up')).toBe(false);
  });
});
