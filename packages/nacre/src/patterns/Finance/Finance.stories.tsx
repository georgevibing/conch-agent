import type { Meta, StoryObj } from '@storybook/react-vite';

import { InChat } from '../ToolViews/fixtures';
import { QuotesCard } from './FinanceCard';
import { sampleCompare, sampleQuotes, sampleSeries, sampleShelf } from './fixtures';
import type { FinancePeriod } from './types';

/** A pretend range switch: the same made-up walk, longer or shorter. */
const points: Record<FinancePeriod, { points: number; every: number; drift: number }> = {
  '1D': { points: 96, every: 1, drift: 0.004 },
  '1W': { points: 5, every: 1, drift: 0.012 },
  '1M': { points: 22, every: 1, drift: 0.07 },
  '3M': { points: 63, every: 1, drift: 0.11 },
  '6M': { points: 60, every: 3, drift: 0.19 },
  '1Y': { points: 72, every: 5, drift: 0.34 },
  '5Y': { points: 60, every: 30, drift: 2.1 },
  MAX: { points: 90, every: 60, drift: 5.4 },
};

const pretendRange = (end: Record<string, number>) =>
  async function range(symbol: string, period: FinancePeriod) {
    const shape = points[period];
    await new Promise((done) => setTimeout(done, 240));
    return sampleSeries({
      symbol,
      period,
      end: end[symbol] ?? 257.2,
      points: shape.points,
      every: shape.every,
      drift: shape.drift,
      wobble: (end[symbol] ?? 257.2) * 0.012,
      currency: symbol === 'AIR.PA' ? 'EUR' : 'USD',
    });
  };

const meta = {
  title: 'Patterns/Chat/Finance',
  component: QuotesCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Money, as a card in the chat (ADR 0060 §7). The price is large and its digits roll when it changes; the move beside it carries a triangle *and* the word (“up 0.67%”), so direction is never colour alone. Under it the price over time: one line in the first chart colour — never recoloured by whether it went up — drawn in from the left on arrival, and scrubbable by drag, hover or arrow keys, with the headline following the day you are on and springing back to the latest when you let go. The range switch re-fetches through the app and the chart holds its old render while the new closes land. Several instruments become a scroll-snapped shelf of chips with the chosen one large; two to four being compared are overlaid as percentages from the range’s start, with end labels on the lines and a table beneath. Filed figures are small bars with the growth labelled, margins as meters, and every number says the period it covers and the day it was filed. Nothing is ever called live, and nothing is advice.',
      },
    },
  },
  args: { quotes: sampleQuotes(), locale: 'en-GB' },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 560, marginInline: 'auto' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof QuotesCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** One share, up on the day, with a month of closes and a working range switch. */
export const OneShare: Story = {
  args: { onRange: pretendRange({ AAPL: 257.2 }) },
};

/** A share that fell: the caret turns down, the word says so, the line keeps its colour. */
export const Down: Story = {
  args: {
    quotes: (() => {
      const series = sampleSeries({ end: 231.4, drift: -0.09 });
      const base = sampleQuotes();
      const first = base.items[0];
      return {
        items: [
          {
            ...(first ?? { symbol: 'AAPL', price: 0, asOf: '', source: 'Stooq' }),
            price: series.closes.at(-1) ?? 231.4,
            previousClose: series.closes.at(-2) ?? 234,
            change: -2.86,
            changePercent: -1.22,
            dayRange: { low: 230.1, high: 235.8 },
            spark: { period: '1M' as const, values: series.closes },
          },
        ],
        series: [series],
      };
    })(),
    onRange: pretendRange({ AAPL: 231.4 }),
  },
};

/** An index: no company behind it, so no market cap and no currency of its own. */
export const AnIndex: Story = {
  args: {
    quotes: (() => {
      const series = sampleSeries({ symbol: '^SPX', end: 6842.1, drift: 0.04, wobble: 42 });
      return {
        items: [
          {
            symbol: '^SPX',
            name: 'S&P 500',
            class: 'index' as const,
            price: series.closes.at(-1) ?? 6842.1,
            previousClose: series.closes.at(-2) ?? 6820,
            change: 18.4,
            changePercent: 0.27,
            asOf: '2026-10-09T20:00:00Z',
            delayed: true,
            dayState: 'closed' as const,
            spark: { period: '1M' as const, values: series.closes },
            source: 'Stooq',
          },
        ],
        series: [series],
      };
    })(),
    onRange: pretendRange({ '^SPX': 6842.1 }),
  },
};

/** Eight instruments: a scroll-snapped shelf of chips, the chosen one large. */
export const Shelf: Story = {
  args: { quotes: sampleShelf(), onRange: pretendRange({ AAPL: 257.2, MSFT: 512.4 }) },
};

/** Three compared: percentages from the range’s start, end labels, and a table. */
export const Compared: Story = {
  args: {
    quotes: sampleCompare(),
    onRange: pretendRange({ AAPL: 257.2, MSFT: 512.4, NVDA: 188.65 }),
  },
};

/** A symbol nobody had: said plainly above the card, never quietly dropped. */
export const NotFound: Story = {
  args: {
    quotes: { ...sampleQuotes(), missing: ['NOTATICKER', 'Nortel'] },
  },
};

/** A price with nothing else fetched: the card draws gaps, never zeroes. */
export const BareQuote: Story = {
  args: {
    quotes: {
      items: [
        {
          symbol: 'AIR.PA',
          name: 'Airbus SE',
          class: 'stock',
          currency: 'EUR',
          price: 214.3,
          asOf: '2026-10-09T16:30:00Z',
          delayed: true,
          source: 'Yahoo Finance',
        },
      ],
    },
  },
};

/** Phone width: the tiles go two by two and the move keeps its words. */
export const Phone: Story = {
  args: { quotes: sampleQuotes(), onRange: pretendRange({ AAPL: 257.2 }) },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 340, marginInline: 'auto' }}>
        <Story />
      </div>
    ),
  ],
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

/** In the chat: the card is the answer, and the reply is a sentence. */
export const InAChat: Story = {
  render: (args) => (
    <InChat
      ask="What’s AAPL at?"
      answer="$257.20 at Tuesday’s close, a touch up on the day — delayed, not live."
    >
      <QuotesCard {...args} />
    </InChat>
  ),
  args: { quotes: sampleQuotes(), onRange: pretendRange({ AAPL: 257.2 }) },
  decorators: [(Story) => <Story />],
};
