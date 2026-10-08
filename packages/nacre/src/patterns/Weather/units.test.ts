import { describe, expect, it } from 'vitest';

import { sampleWeather } from './fixtures';
import { inUnits } from './units';

describe('inUnits', () => {
  it('converts temperatures, wind and rain, and nothing else', () => {
    const metric = sampleWeather({ units: 'metric' });
    const f = inUnits(metric, 'imperial');
    expect(f.units).toBe('imperial');
    expect(f.current.temp).toBeCloseTo((metric.current.temp * 9) / 5 + 32, 0);
    expect(f.current.wind).toBeCloseTo(metric.current.wind / 1.609344, 0);
    expect(f.current.humidity).toBe(metric.current.humidity);
    expect(f.daily[0]?.max).toBeCloseTo(((metric.daily[0]?.max ?? 0) * 9) / 5 + 32, 0);
    const back = inUnits(f, 'metric');
    expect(back.current.temp).toBeCloseTo(metric.current.temp, 0);
    expect(inUnits(metric, 'metric')).toBe(metric);
  });
});
