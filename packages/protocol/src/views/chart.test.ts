import { describe, expect, it } from 'vitest';

import { ToolView } from '../chat-cards';
import { CHART_POINTS_MAX, CHART_SERIES_MAX, ChartView } from './chart';

const chart = (over: Record<string, unknown> = {}) => ({
  kind: 'chart',
  type: 'column',
  labels: ['Q1', 'Q2'],
  series: [{ name: 'Europe', values: [4.2, 5.1] }],
  ...over,
});

describe('ChartView', () => {
  it('is one of the views a tool may draw', () => {
    expect(ToolView.safeParse(chart()).success).toBe(true);
  });

  it('takes only the forms Conch draws', () => {
    for (const type of ['bar', 'column', 'line', 'area', 'pie', 'donut', 'scatter'])
      expect(ChartView.safeParse(chart({ type })).success).toBe(true);
    for (const type of ['radar', 'treemap', 'funnel', 'heatmap', ''])
      expect(ChartView.safeParse(chart({ type })).success).toBe(false);
  });

  it('caps the series at the token order and the points at a readable number', () => {
    const series = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `s${i}`, values: [1, 2] }));
    expect(ChartView.safeParse(chart({ series: series(CHART_SERIES_MAX) })).success).toBe(true);
    expect(ChartView.safeParse(chart({ series: series(CHART_SERIES_MAX + 1) })).success).toBe(
      false,
    );
    const many = (n: number) => Array.from({ length: n }, () => 1);
    expect(
      ChartView.safeParse(
        chart({
          labels: many(CHART_POINTS_MAX).map(String),
          series: [{ name: 's', values: many(CHART_POINTS_MAX) }],
        }),
      ).success,
    ).toBe(true);
    expect(
      ChartView.safeParse(
        chart({
          labels: many(CHART_POINTS_MAX + 1).map(String),
          series: [{ name: 's', values: [1] }],
        }),
      ).success,
    ).toBe(false);
  });

  it('takes a gap but never a number that isn’t one', () => {
    expect(ChartView.safeParse(chart({ series: [{ name: 's', values: [1, null] }] })).success).toBe(
      true,
    );
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '2', {}])
      expect(
        ChartView.safeParse(chart({ series: [{ name: 's', values: [1, bad] }] })).success,
      ).toBe(false);
  });

  it('takes the words a card needs and nothing that could be markup', () => {
    const parsed = ChartView.safeParse(
      chart({
        title: 'Revenue',
        subtitle: 'Three regions',
        unit: '%',
        prefix: '$',
        stacked: true,
        horizontal: false,
        goal: { value: 25, label: 'Target' },
        source: 'the sheet',
        note: 'Rounded.',
      }),
    );
    expect(parsed.success).toBe(true);
    // Nothing in the shape takes a link or an id, so nothing can ride out in one.
    expect(Object.keys(ChartView.shape).sort()).toEqual([
      'goal',
      'horizontal',
      'kind',
      'labels',
      'note',
      'prefix',
      'series',
      'source',
      'stacked',
      'subtitle',
      'title',
      'type',
      'unit',
    ]);
  });

  it('needs at least one label and one series', () => {
    expect(ChartView.safeParse(chart({ labels: [] })).success).toBe(false);
    expect(ChartView.safeParse(chart({ series: [] })).success).toBe(false);
  });
});
