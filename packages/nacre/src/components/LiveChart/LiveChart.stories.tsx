import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { Stack } from '../Stack';
import { LiveChart } from './LiveChart';
import { Sparkline } from './Sparkline';

const INTERVAL = 2000;
const COUNT = 90;

/** A calm, believable walk: drifts, a burst now and then, never below zero. */
export function walk(seed: number, base: number, spread: number, count = COUNT): number[] {
  let value = base;
  let s = seed;
  const random = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  return Array.from({ length: count }, (_, i) => {
    const burst = i % 37 > 30 ? spread * 1.6 : 0;
    value += (random() - 0.5) * spread * 0.5 + (base - value) * 0.12;
    return Math.max(0, Math.round((value + burst) * 10) / 10);
  });
}

const END = 1_791_300_000_000;
const times = Array.from({ length: COUNT }, (_, i) => END - (COUNT - 1 - i) * INTERVAL);
const percent = (v: number) => `${Math.round(v)}%`;
const rate = (v: number) =>
  v >= 1e6
    ? `${(v / 1e6).toFixed(1)} MB/s`
    : v >= 1e3
      ? `${Math.round(v / 1e3)} KB/s`
      : `${Math.round(v)} B/s`;

const meta = {
  title: 'Components/Data/LiveChart',
  component: LiveChart,
  args: {
    title: 'Processor',
    times,
    series: [{ id: 'cpu', label: 'Processor', values: walk(7, 18, 14) }],
    format: percent,
    max: 100,
    detail: 'Load 2.4',
  },
  decorators: [(Story) => <div style={{ inlineSize: 'min(100%, 520px)' }}>{Story()}</div>],
  parameters: {
    docs: {
      description: {
        component:
          'A live reading over the last few minutes. The current value is always in words in the header; the line glides left at the pace time passes, holding still with reduced motion. Hover or drag for a crosshair with every series at that moment. Screen readers get one sentence per series: now, the average and the highest.',
      },
    },
  },
} satisfies Meta<typeof LiveChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const TwoSeries: Story = {
  args: {
    title: 'Network',
    detail: undefined,
    max: undefined,
    format: rate,
    series: [
      { id: 'in', label: 'Download', values: walk(3, 900_000, 700_000) },
      { id: 'out', label: 'Upload', values: walk(11, 120_000, 90_000) },
    ],
  },
};

export const WithAGap: Story = {
  args: {
    title: 'Graphics',
    detail: undefined,
    series: [
      {
        id: 'gpu',
        label: 'Graphics',
        values: walk(5, 30, 20).map((v, i) => (i > 40 && i < 52 ? null : v)),
      },
    ],
  },
};

export const Starting: Story = {
  args: {
    times: times.slice(-2),
    series: [{ id: 'cpu', label: 'Processor', values: [12, 14] }],
  },
};

/** Readings arriving every two seconds, as Settings → This computer shows them. */
export const Live: Story = {
  render: function Render(args) {
    const [state, setState] = useState(() => ({
      times,
      cpu: walk(7, 18, 14),
      mem: walk(9, 62, 3),
    }));
    useEffect(() => {
      const id = setInterval(() => {
        setState((s) => {
          const last = s.times.at(-1) ?? END;
          const next = (values: number[], base: number, spread: number) =>
            [
              ...values,
              Math.max(
                0,
                Math.min(
                  100,
                  (values.at(-1) ?? base) +
                    (Math.random() - 0.5) * spread +
                    (base - (values.at(-1) ?? base)) * 0.2,
                ),
              ),
            ].slice(-COUNT);
          return {
            times: [...s.times, last + INTERVAL].slice(-COUNT),
            cpu: next(s.cpu, 18, 16),
            mem: next(s.mem, 62, 2),
          };
        });
      }, INTERVAL);
      return () => clearInterval(id);
    }, []);
    return (
      <Stack gap={8}>
        <LiveChart
          {...args}
          times={state.times}
          series={[{ id: 'cpu', label: 'Processor', values: state.cpu }]}
        />
        <LiveChart
          title="Memory"
          times={state.times}
          format={percent}
          max={100}
          series={[{ id: 'mem', label: 'Memory', values: state.mem, color: 'var(--nc-chart-3)' }]}
        />
        <div style={{ inlineSize: 120 }}>
          <Sparkline values={state.cpu} max={100} latest={state.times.at(-1)} />
        </div>
      </Stack>
    );
  },
};

export const Sparklines: Story = {
  render: () => (
    <Stack gap={4} style={{ inlineSize: 160 }}>
      <Sparkline values={walk(7, 18, 14)} max={100} label="Processor, last 3 minutes" />
      <Sparkline values={walk(9, 62, 3)} max={100} color="var(--nc-chart-3)" />
      <Sparkline values={walk(3, 900, 700)} color="var(--nc-chart-2)" />
    </Stack>
  ),
};
