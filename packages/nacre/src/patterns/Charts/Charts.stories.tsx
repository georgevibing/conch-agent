import type { Meta, StoryObj } from '@storybook/react-vite';

import { ChartCard } from './ChartCard';
import {
  eightSeries,
  energyByHour,
  longTail,
  monthlySignups,
  onePoint,
  quarterlyRevenue,
  spendByCategory,
  teamLoad,
  twoMeasures,
  withGaps,
} from './fixtures';

const meta = {
  title: 'Patterns/Chat/Charts',
  component: ChartCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A chart in the chat (ADR 0105). The form follows the question — parts of a whole are a pie or a ring, change over time a line or an area, categories compared a column or a bar, two measures a scatter — and the colours are the one validated categorical order every Conch chart uses (`--nc-chart-1…8`, never cycled), so a chart here and the same chart exported as a file read as one family. Bars grow out of the axis with a short stagger, lines draw along their path, areas fade up and a pie sweeps round; reduced motion stills all of it. A crosshair and one read-out give every series’ value at a point, by pointer or by arrow key (Home/End jump, Esc clears, Enter picks a mark out). The legend takes a series out of the picture. **Show the numbers** opens the same data as a real table, which is also the path a screen reader takes.',
      },
    },
  },
  args: { chart: quarterlyRevenue, locale: 'en-GB' },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 560, marginInline: 'auto' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChartCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** Columns: three series side by side, compared category by category. */
export const Columns: Story = {};

/** Stacked columns: the total is the point, with a 2 px gap of surface between the parts. */
export const Stacked: Story = {
  args: { chart: { ...quarterlyRevenue, stacked: true, title: 'Revenue by quarter, stacked' } },
};

/** Bars lying down, for long category names — with a line to read against. */
export const Bars: Story = { args: { chart: teamLoad } };

/** A line over a year of months, labelled as dates, with a target. */
export const Line: Story = { args: { chart: monthlySignups } };

/** A stacked area: a day's energy, hour by hour. */
export const Area: Story = { args: { chart: energyByHour } };

/** A pie: five parts of one month's spending. */
export const Pie: Story = { args: { chart: spendByCategory } };

/** A ring, with a long tail gathered into “Others” — said in words under the chart. */
export const LongTailDonut: Story = { args: { chart: longTail } };

/** Two measures against each other: price along the bottom, rating up the side. */
export const Scatter: Story = { args: { chart: twoMeasures } };

/** Gaps are gaps: a missing reading breaks the line, it never reads as a zero. */
export const Gaps: Story = { args: { chart: withGaps } };

/** Eight series, the token ceiling. A ninth is refused, never invented. */
export const EightSeries: Story = { args: { chart: eightSeries } };

/** The numbers, as a real table — the same data, and the screen-reader path. */
export const TheNumbers: Story = {
  args: { chart: monthlySignups, defaultNumbers: true },
};

/** One reading doesn't look broken: it stands in the middle with its value on it. */
export const SinglePoint: Story = { args: { chart: onePoint } };

/** Nothing came back: the card says so rather than drawing an empty box. */
export const Nothing: Story = {
  args: {
    chart: {
      type: 'column',
      title: 'Orders a day',
      labels: ['Mon', 'Tue'],
      series: [{ name: 'Orders', values: [null, null] }],
    },
  },
};

/** A phone: the legend wraps, the labels turn, the read-out keeps its room. */
export const Phone: Story = {
  args: { chart: quarterlyRevenue },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 340 }}>
        <Story />
      </div>
    ),
  ],
};

/** A phone, with a pie: the legend carries every share in words. */
export const PhonePie: Story = {
  args: { chart: spendByCategory },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 340 }}>
        <Story />
      </div>
    ),
  ],
};

/** Where the share bar will mount (agent C's `CardShare`), stood in for here. */
export const WithShareBar: Story = {
  args: {
    chart: spendByCategory,
    actions: (
      <span style={{ font: 'inherit', fontSize: 12, color: 'var(--nc-text-subtle)' }}>
        Save · Copy · Send
      </span>
    ),
  },
};

/** Every form at once, so the family reads as one. */
export const TheFamily: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <ChartCard chart={quarterlyRevenue} locale="en-GB" />
      <ChartCard chart={monthlySignups} locale="en-GB" />
      <ChartCard chart={energyByHour} locale="en-GB" />
      <ChartCard chart={teamLoad} locale="en-GB" />
      <ChartCard chart={spendByCategory} locale="en-GB" />
      <ChartCard chart={longTail} locale="en-GB" />
      <ChartCard chart={twoMeasures} locale="en-GB" />
    </div>
  ),
};
