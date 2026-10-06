import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { monotonePath, niceCeiling, runs } from './curve';
import { LiveChart, describeSeries } from './LiveChart';
import { Sparkline } from './Sparkline';

const times = [0, 2000, 4000, 6000];
const percent = (v: number) => `${Math.round(v)}%`;

describe('LiveChart', () => {
  it('names itself, shows the value now and says the chart in words', async () => {
    const { container } = renderNacre(
      <LiveChart
        title="Processor"
        detail="Load 2.4"
        times={times}
        series={[{ id: 'cpu', label: 'Processor', values: [10, 30, 20, 12] }]}
        format={percent}
        max={100}
        windowMs={6000}
      />,
    );
    const figure = screen.getByRole('figure', { name: /Processor/ });
    expect(figure).toHaveAccessibleDescription(
      'Processor over the last 6 seconds: now 12%, average 18%, highest 30%.',
    );
    expect(screen.getByText('12%')).toBeInTheDocument();
    expect(screen.getByText('Load 2.4')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('gives two series a legend with their values, and a gap stays a gap', async () => {
    const { container } = renderNacre(
      <LiveChart
        title="Network"
        times={times}
        series={[
          { id: 'in', label: 'Download', values: [1, null, 3, 4] },
          { id: 'out', label: 'Upload', values: [2, 2, 2, 7] },
        ]}
        format={(v) => `${v} KB/s`}
      />,
    );
    expect(screen.getByText('Download')).toBeInTheDocument();
    expect(screen.getByText('4 KB/s')).toBeInTheDocument();
    expect(screen.getByText('7 KB/s')).toBeInTheDocument();
    // Download is two pieces of line around its missing reading.
    const lines = container.querySelectorAll('path[style*="chart-1"]');
    expect(lines.length).toBe(2);
    await expectAccessible(container);
  });

  it('shows every series at the moment under the pointer', () => {
    const { container } = renderNacre(
      <LiveChart
        title="Processor"
        times={times}
        series={[{ id: 'cpu', label: 'Processor', values: [10, 30, 20, 12] }]}
        format={percent}
        windowMs={6000}
      />,
    );
    const plot = container.querySelector('svg')?.parentElement as HTMLElement;
    // The plot is 320 px wide by default in tests (no layout).
    fireEvent.pointerMove(plot, { clientX: 105 });
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('4 s ago')).toBeInTheDocument();
    fireEvent.pointerLeave(plot);
    expect(screen.queryByText('4 s ago')).not.toBeInTheDocument();
  });

  it('waits for its first reading without a number', () => {
    renderNacre(
      <LiveChart
        title="Graphics"
        times={[]}
        series={[{ id: 'gpu', label: 'Graphics', values: [] }]}
        format={percent}
      />,
    );
    expect(screen.getByRole('figure')).toHaveAccessibleDescription('Graphics: no readings yet.');
  });
});

describe('Sparkline', () => {
  it('is decorative unless it is given words', async () => {
    const { container, rerender } = renderNacre(<Sparkline values={[1, 2, 3]} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<Sparkline values={[1, 2, 3]} label="Memory, rising" />);
    expect(screen.getByRole('img', { name: 'Memory, rising' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('the curve', () => {
  it('passes through every point without overshooting a flat stretch', () => {
    const d = monotonePath([
      [0, 10],
      [10, 10],
      [20, 0],
    ]);
    expect(d.startsWith('M0,10C')).toBe(true);
    // The flat first stretch keeps its control points on the line.
    expect(d).toContain('C3.33,10,6.67,10,10,10');
    expect(monotonePath([])).toBe('');
    expect(monotonePath([[1, 2]])).toBe('M1,2');
  });

  it('splits runs at gaps and picks clean tops', () => {
    expect(runs([1, null, 2, 3]).map((r) => r.items)).toEqual([[1], [2, 3]]);
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(7)).toBe(10);
    expect(niceCeiling(1.3e6)).toBe(2e6);
    expect(niceCeiling(230)).toBe(250);
  });

  it('describes a series in one sentence', () => {
    expect(
      describeSeries(
        { id: 'm', label: 'Memory', values: [50, null, 70] },
        percent,
        'the last minute',
      ),
    ).toBe('Memory over the last minute: now 70%, average 60%, highest 70%.');
  });
});
