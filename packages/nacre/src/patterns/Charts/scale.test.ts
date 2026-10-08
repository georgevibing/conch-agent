import { describe, expect, it } from 'vitest';

import { cartesianLayout, roundLayout, sliceAt } from './geometry';
import {
  arcPath,
  axisLabels,
  describeChart,
  niceScale,
  niceStep,
  pathLength,
  sharePercent,
  shortValue,
  slicesOf,
  valueFormatter,
} from './scale';
import type { ChartSpec } from './types';

describe('the value axis', () => {
  it('picks round steps, the same ones the file chart picks', () => {
    expect(niceStep(100, 5)).toBe(20);
    expect(niceStep(9, 5)).toBe(2);
    expect(niceStep(0.9, 5)).toBe(0.2);
  });

  it('includes the baseline where a mark grows out of it', () => {
    const scale = niceScale([4.2, 5.1, 7.4]);
    expect(scale.min).toBe(0);
    expect(scale.max).toBeGreaterThanOrEqual(7.4);
    expect(scale.ticks[0]).toBe(0);
  });

  it('leaves the baseline out for a line, so a flat run still reads', () => {
    const scale = niceScale([980, 1000, 1020], { zero: false });
    expect(scale.min).toBeGreaterThan(0);
  });

  it('gives one flat reading room either side rather than sitting it on the axis', () => {
    const scale = niceScale([7, 7], { zero: false });
    expect(scale.min).toBeLessThan(7);
    expect(scale.max).toBeGreaterThan(7);
  });

  it('reaches both ends of negative and positive readings', () => {
    const scale = niceScale([-40, 60]);
    expect(scale.min).toBeLessThanOrEqual(-40);
    expect(scale.max).toBeGreaterThanOrEqual(60);
    expect(scale.ticks).toContain(0);
  });
});

describe('numbers as words', () => {
  it('shortens big ones and keeps the unit where it belongs', () => {
    expect(shortValue(1_250_000)).toBe('1.3M');
    expect(shortValue(4200, '%', undefined, 'en-GB')).toBe('4,200%');
    expect(shortValue(4.5, undefined, '€')).toBe('€4.5');
    expect(shortValue(3.4, 'kWh')).toBe('3.4 kWh');
    expect(shortValue(-12.5)).toBe('-12.5');
  });

  it('writes money the way the reader’s language does', () => {
    // Money on a chart keeps no trailing zeroes: “£1,450”, not “£1,450.00”.
    expect(valueFormatter('en-GB', { prefix: '£' })(1234.5)).toBe('£1,234.5');
    expect(valueFormatter('en-GB', { prefix: '£' })(1450)).toBe('£1,450');
    expect(valueFormatter('en-GB', { unit: 'kWh' })(1234)).toBe('1,234 kWh');
    expect(valueFormatter('en-GB', { prefix: 'kr ' })(12)).toBe('kr 12');
  });

  it('keeps a decimal on a small share and drops it on a big one', () => {
    expect(sharePercent('en-GB', 0.542)).toBe('54%');
    expect(sharePercent('en-GB', 0.036)).toBe('3.6%');
  });
});

describe('dates as labels', () => {
  it('labels months as months when a year is in view', () => {
    const { text, full, dates } = axisLabels(['2026-01', '2026-02', '2026-03'], 'en-GB');
    expect(dates).toBe(true);
    expect(text).toEqual(['Jan', 'Feb', 'Mar']);
    expect(full[0]).toBe('January 2026');
  });

  it('labels hours as hours within a day', () => {
    const { text } = axisLabels(['2026-10-07T00:00', '2026-10-07T06:00'], 'en-GB');
    expect(text[1]).toMatch(/06|6/);
  });

  it('leaves words exactly as they came', () => {
    const { text, dates } = axisLabels(['Q1', 'Q2'], 'en-GB');
    expect(dates).toBe(false);
    expect(text).toEqual(['Q1', 'Q2']);
  });
});

describe('parts of a whole', () => {
  it('puts the biggest first and drops what a pie can’t show', () => {
    const { slices, total, dropped } = slicesOf(['a', 'b', 'c', 'd'], [10, 40, null, -5]);
    expect(slices.map((s) => s.label)).toEqual(['b', 'a']);
    expect(total).toBe(50);
    expect(dropped).toBe(2);
    expect(slices[0]?.share).toBeCloseTo(0.8);
  });

  it('gathers a long tail into one “Others”, and says how many', () => {
    const labels = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const values = labels.map((_, i) => 12 - i);
    const { slices } = slicesOf(labels, values);
    expect(slices).toHaveLength(8);
    expect(slices.at(-1)?.label).toBe('Others');
    expect(slices.at(-1)?.folded).toBe(5);
    expect(slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
  });

  it('keeps each slice on its own paint slot', () => {
    const { slices } = slicesOf(['a', 'b'], [1, 2]);
    expect(slices.map((s) => s.slot)).toEqual([0, 1]);
  });

  it('draws a whole circle as two arcs, never a point', () => {
    const path = arcPath(50, 50, 40, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2);
    expect(path.match(/A /g)?.length).toBe(4);
  });
});

describe('the plot’s geometry', () => {
  const base = {
    width: 560,
    height: 212,
    values: [0, 120],
    labels: ['Q1', 'Q2', 'Q3', 'Q4'],
    zero: true,
    tickChars: 3,
    dates: false,
  };

  it('leaves room on the left for the value ticks', () => {
    const layout = cartesianLayout({ ...base, horizontal: false });
    expect(layout.pads.left).toBeGreaterThan(24);
    expect(layout.plotW).toBeGreaterThan(400);
  });

  it('turns long category names rather than clipping them', () => {
    const layout = cartesianLayout({
      ...base,
      horizontal: false,
      labels: ['Platform reliability', 'Billing and invoices', 'Design system', 'Mobile'],
    });
    expect(layout.rotate).toBe(true);
    expect(layout.pads.bottom).toBeGreaterThan(40);
  });

  it('thins the labels when there are far too many to read', () => {
    const layout = cartesianLayout({
      ...base,
      horizontal: false,
      dates: true,
      labels: Array.from({ length: 60 }, (_, i) => `d${i}`),
    });
    expect(layout.tickEvery).toBeGreaterThan(1);
  });

  it('gives bars lying down the room their names need', () => {
    const layout = cartesianLayout({
      ...base,
      horizontal: true,
      labels: ['Platform reliability', 'Mobile'],
    });
    expect(layout.pads.left).toBeGreaterThan(60);
    expect(layout.pads.left).toBeLessThanOrEqual(560 * 0.34);
  });

  it('finds the slice a point lands on, by its angle', () => {
    const ring = roundLayout(200, 200, [0.5, 0.25, 0.25], false);
    // Straight up from the middle is the first slice's leading edge.
    expect(sliceAt(ring, 10, -60, ring.arcs)).toBe(0);
    // Straight down is still in the first slice, which runs half way round.
    expect(sliceAt(ring, 10, 60, ring.arcs)).toBe(0);
    // Below left is the second quarter, above left the third.
    expect(sliceAt(ring, -60, 10, ring.arcs)).toBe(1);
    expect(sliceAt(ring, -60, -10, ring.arcs)).toBe(2);
    expect(sliceAt(ring, 400, 0, ring.arcs)).toBeUndefined();
  });

  it('measures a line near enough to draw it along itself', () => {
    expect(
      pathLength([
        [0, 0],
        [3, 4],
      ]),
    ).toBe(5);
    expect(pathLength([])).toBe(1);
  });
});

describe('the chart in words', () => {
  it('says where each series starts, ends, dips and peaks', () => {
    const chart: ChartSpec = {
      type: 'line',
      labels: ['Mon', 'Tue', 'Wed'],
      series: [{ name: 'Orders', values: [10, null, 30] }],
    };
    const said = describeChart(chart, (v) => String(v));
    expect(said).toContain('Orders: 10 at Mon to 30 at Wed');
    expect(said).toContain('lowest 10, highest 30');
    expect(said).toContain('1 with no reading');
  });

  it('says a pie as parts of a total', () => {
    const chart: ChartSpec = {
      type: 'pie',
      labels: ['Rent', 'Food'],
      series: [{ name: 'Spend', values: [75, 25] }],
    };
    expect(describeChart(chart, (v) => String(v))).toContain('Rent 75, 75%');
  });
});
