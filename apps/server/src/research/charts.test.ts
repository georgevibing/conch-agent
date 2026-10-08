import { ToolView } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { cleanView } from '../conversations/views';
import { hostToolText, type HostTool } from '../engines/types';
import { chartKind, chartTools, chartView } from './charts';

const tool = (): HostTool => {
  const [chart] = chartTools();
  if (!chart) throw new Error('no chart tool');
  return chart;
};

const run = async (args: Record<string, unknown>) => {
  const chart = tool();
  const mended = chart.mend ? chart.mend(args) : args;
  return chart.run(mended as never);
};

const bars = {
  type: 'column',
  title: 'Revenue by quarter',
  labels: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [
    { name: 'Europe', values: [4.2, 5.1, 5.8, 7.4] },
    { name: 'Americas', values: [3.1, 3.4, 4.9, 5.2] },
  ],
  prefix: '€',
};

describe('chart_show', () => {
  it('is a read with a row of its own', () => {
    expect(tool().name).toBe('chart_show');
    expect(tool().effect).toBe('read');
    expect(tool().row).toBe(true);
  });

  it('teaches the model when to use it, and when to make a file instead', () => {
    const said = tool().description;
    expect(said).toMatch(/pie chart/i);
    expect(said).toMatch(/parts of one whole/i);
    expect(said).toMatch(/8 series/);
    expect(said).toMatch(/file_make/);
    expect(said).toMatch(/share bar/);
    expect(said).toMatch(/don’t relist|don’t relist them|relist/i);
  });

  it('draws every form it promises, and names the stacking a model asked for', () => {
    for (const type of ['bar', 'column', 'line', 'area', 'pie', 'donut', 'scatter'])
      expect(chartKind(type).type).toBe(type);
    expect(chartKind('stackedBar')).toEqual({ type: 'column', stacked: true });
    expect(chartKind('grouped bar')).toEqual({ type: 'column' });
    expect(chartKind('horizontal_bar')).toEqual({ type: 'bar' });
    expect(chartKind('doughnut')).toEqual({ type: 'donut' });
    expect(chartKind('Scatter Plot')).toEqual({ type: 'scatter' });
  });

  it('refuses a form it can’t draw, and says what to use instead', () => {
    expect(() => chartKind('radar')).toThrow(/column chart with one column per measure/);
    expect(() => chartKind('treemap')).toThrow(/bar chart/);
    expect(() => chartKind('sankey')).toThrow(/biggest flows/);
    expect(() => chartKind('gauge')).toThrow(/goal line/);
    // Something nobody draws at all still gets the honest list.
    expect(() => chartKind('mandala')).toThrow(/isn’t a chart Conch draws/);
    expect(() => chartKind('heatmap')).toThrow(/file_make with sheets/);
  });

  it.each([
    ['bar', { horizontal: true }],
    ['column', {}],
    ['line', {}],
    ['area', { stacked: true }],
    ['pie', {}],
    ['donut', {}],
    ['scatter', {}],
  ])('makes a view for a %s that logs exactly as it is', async (type, extra) => {
    const result = await run({
      ...bars,
      ...extra,
      type,
      ...(type === 'pie' || type === 'donut' ? { series: [bars.series[0]] } : {}),
    });
    const view = typeof result === 'string' ? undefined : result.view;
    expect(view?.kind).toBe('chart');
    expect(ToolView.safeParse(view).success).toBe(true);
    expect(cleanView(view)).toEqual(view);
    expect(hostToolText(result)).toContain(`a ${type} chart`);
  });

  it('carries the unit, the goal, the source and the note through', async () => {
    const result = await run({
      type: 'line',
      labels: ['Jan', 'Feb'],
      series: [{ name: 'Sign-ups', values: [100, 200] }],
      unit: 'a day',
      goal: 180,
      goal_label: 'Target',
      source: 'the product log',
      note: 'Bots filtered out.',
    });
    const view = typeof result === 'string' ? undefined : result.view;
    expect(view).toMatchObject({
      unit: 'a day',
      goal: { value: 180, label: 'Target' },
      source: 'the product log',
      note: 'Bots filtered out.',
    });
  });

  it('refuses more than eight series rather than inventing a ninth colour', () => {
    expect(() =>
      chartView({
        type: 'column',
        labels: ['a'],
        series: Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, values: [i] })),
      }),
    ).toThrow(/keep it to 8|too many to tell apart/);
  });

  it('refuses a scatter with more series than any two dots can be told apart', () => {
    expect(() =>
      chartView({
        type: 'scatter',
        labels: ['1', '2'],
        series: Array.from({ length: 4 }, (_, i) => ({ name: `s${i}`, values: [i, i] })),
      }),
    ).toThrow(/only tell 3 series apart/);
  });

  it('refuses a ragged row, naming the series and both counts', () => {
    expect(() =>
      chartView({
        type: 'column',
        labels: ['Q1', 'Q2', 'Q3'],
        series: [
          { name: 'Europe', values: [1, 2, 3] },
          { name: 'Asia', values: [1, 2] },
        ],
      }),
    ).toThrow(/“Asia” has 2 values but there are 3 labels/);
  });

  it('refuses a value that isn’t a finite number', () => {
    expect(() =>
      chartView({
        type: 'line',
        labels: ['a', 'b'],
        series: [{ name: 's', values: [1, Number.NaN] }],
      }),
    ).toThrow();
    expect(() =>
      chartView({
        type: 'line',
        labels: ['a', 'b'],
        series: [{ name: 's', values: [1, Number.POSITIVE_INFINITY] }],
      }),
    ).toThrow();
    expect(() =>
      chartView({
        type: 'line',
        labels: ['a', 'b'],
        series: [{ name: 's', values: [1, 'lots'] }],
      }),
    ).toThrow();
  });

  it('refuses data with nothing in it at all', () => {
    expect(() =>
      chartView({
        type: 'column',
        labels: ['a', 'b'],
        series: [{ name: 's', values: [null, null] }],
      }),
    ).toThrow(/nothing to draw/);
    expect(() => chartView({ type: 'column', labels: [], series: [] })).toThrow();
  });

  it('refuses more points than a picture can say', () => {
    expect(() =>
      chartView({
        type: 'line',
        labels: Array.from({ length: 401 }, (_, i) => String(i)),
        series: [{ name: 's', values: Array.from({ length: 401 }, () => 1) }],
      }),
    ).toThrow();
  });

  it('refuses a pie of several series, and one with nothing above zero', () => {
    expect(() =>
      chartView({
        type: 'pie',
        labels: ['a', 'b'],
        series: [
          { name: 'x', values: [1, 2] },
          { name: 'y', values: [3, 4] },
        ],
      }),
    ).toThrow(/shows one series as parts of one whole/);
    expect(() =>
      chartView({ type: 'pie', labels: ['a', 'b'], series: [{ name: 'x', values: [-1, -2] }] }),
    ).toThrow(/needs values above zero/);
  });

  it('says plainly what a pie had to leave out or gather up', () => {
    const negative = chartView({
      type: 'pie',
      labels: ['a', 'b', 'c'],
      series: [{ name: 'x', values: [10, 5, -3] }],
    });
    expect(negative.warnings.join(' ')).toMatch(/1 value is below zero/);
    const long = chartView({
      type: 'donut',
      labels: Array.from({ length: 12 }, (_, i) => `c${i}`),
      series: [{ name: 'x', values: Array.from({ length: 12 }, (_, i) => 12 - i) }],
    });
    expect(long.warnings.join(' ')).toMatch(/smallest parts are drawn together as “Others”/);
  });

  it('reads a model’s other plain spellings of the same thing', async () => {
    const result = await run({
      type: 'Pie Chart',
      labels: [2024, 2025, 2026],
      series: [{ label: 'Orders', data: ['10', 20, ''] }],
    });
    const view = typeof result === 'string' ? undefined : result.view;
    expect(view).toMatchObject({
      type: 'pie',
      labels: ['2024', '2025', '2026'],
      series: [{ name: 'Orders', values: [10, 20, null] }],
    });
  });

  it('tells the model the card already shows the numbers', async () => {
    const said = hostToolText(await run(bars));
    expect(said).toMatch(/Show the numbers/);
    expect(said).toMatch(/share bar/);
    expect(said).toMatch(/don’t list the numbers again/);
  });
});
