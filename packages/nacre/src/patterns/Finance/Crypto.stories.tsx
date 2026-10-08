import type { Meta, StoryObj } from '@storybook/react-vite';

import { CardShare } from '../CardShare';
import { InChat } from '../ToolViews/fixtures';
import { CryptoMarket, QuotesCard } from './FinanceCard';
import {
  sampleBusyCoin,
  sampleCoin,
  sampleCoinQuotes,
  sampleCoinSeries,
  sampleMarket,
  sampleSharedSymbol,
  sampleSmallCoin,
} from './fixtures';
import type { FinancePeriod, QuotesData } from './types';

/** Which move a range shows, so the pretend chart goes the way its chip says. */
const MOVE_OF: Partial<Record<FinancePeriod, '24h' | '7d' | '30d' | '1y'>> = {
  '1D': '24h',
  '1W': '7d',
  '1M': '30d',
  '1Y': '1y',
};

/** A pretend range switch: the same made-up walk, at each range's own grain, moving as its chip says. */
const pretendRange = (quotes: QuotesData) =>
  async function range(symbol: string, period: FinancePeriod) {
    await new Promise((done) => setTimeout(done, 240));
    const quote = quotes.items.find((q) => q.symbol === symbol);
    const move = MOVE_OF[period];
    const change = (move && quote?.crypto?.changes?.[move]) ?? 5;
    return sampleCoinSeries({
      symbol,
      period,
      end: quote?.price ?? 67_187,
      drift: change / 100,
    });
  };

const share = (
  <CardShare
    what="card"
    apps={[{ id: 'telegram', kind: 'telegram', name: 'Telegram' }]}
    onSaveImage={() => undefined}
    onCopy={() => 'image'}
    onSend={() => undefined}
  />
);

const meta = {
  title: 'Patterns/Chat/Finance Crypto',
  component: QuotesCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A coin, in the finance family with its own character (ADR 0114 § Crypto). Its lettermark is round, in the coin’s own hue, with its rank beside it. A coin never closes, so the clock line says “24/7 · as of 21:04”. The moves over 1h, 24h, 7d, 30d and 1y are chips, and each is also the range: pressing 7d draws the week, 1h the last hour of the day. Under the chart, the market value beside the fully diluted value, the day’s range, a supply meter (of the maximum, or of what has been made, with “no maximum” said in words and the track running out into nothing) and a gauge of how far the price is below its all-time high. Every figure is CoinGecko’s, an average across exchanges, never one exchange’s price; the footer says so every time, and that none of it is advice.',
      },
    },
  },
  args: { quotes: sampleCoinQuotes(), locale: 'en-GB', share },
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

/** Bitcoin: ranked first, at most 21 million, 38% below its high. Press a chip to re-scale. */
export const Bitcoin: Story = {
  args: { onRange: pretendRange(sampleCoinQuotes()) },
};

/** A smaller coin with no maximum supply: said in words, and the meter has no end. */
export const NoMaximum: Story = {
  args: { quotes: sampleSmallCoin(), onRange: pretendRange(sampleSmallCoin()) },
};

/** Several coins share “UNI”: the one worth the most, with the others named under it. */
export const SharedSymbol: Story = {
  args: { quotes: sampleSharedSymbol(), onRange: pretendRange(sampleSharedSymbol()) },
};

/** CoinGecko was busy: Stooq’s price and closes stand in, and the card says so. */
export const Busy: Story = {
  args: { quotes: sampleBusyCoin() },
};

/** Without a way to fetch another range, the moves are a quiet row of facts. */
export const NoRangeSwitch: Story = {
  args: { quotes: sampleCoinQuotes() },
};

const shelf: QuotesData = {
  items: [
    sampleCoin(),
    ...sampleSmallCoin().items,
    ...sampleSharedSymbol().items,
    sampleCoin({
      symbol: 'ETH',
      name: 'Ethereum',
      price: 2612.4,
      change: 36.6,
      changePercent: 1.42,
    }),
  ],
  series: [sampleCoinSeries()],
};

/** Coins on a shelf: round marks in their own hues, the chosen one large. */
export const Shelf: Story = {
  args: { quotes: shelf, onRange: pretendRange(shelf) },
};

/** Phone width: the tiles go two by two, the chips keep their words. */
export const Phone: Story = {
  args: { onRange: pretendRange(sampleCoinQuotes()) },
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
      ask="What’s BTC at?"
      answer="About $67,190, a touch down on the day but up 12% over the month. That’s CoinGecko’s average across exchanges, not one exchange’s price."
    >
      <QuotesCard {...args} />
    </InChat>
  ),
  args: { onRange: pretendRange(sampleCoinQuotes()) },
  decorators: [(Story) => <Story />],
};

/** How crypto as a whole is doing: the total, its day, the dominance and the ten biggest. */
export const Market: StoryObj<typeof CryptoMarket> = {
  render: (args) => <CryptoMarket {...args} />,
  args: { market: sampleMarket(), locale: 'en-GB', share },
};

/** The market at phone width: the week’s shapes give way, the prices stay. */
export const MarketPhone: StoryObj<typeof CryptoMarket> = {
  render: (args) => <CryptoMarket {...args} />,
  args: { market: sampleMarket(), locale: 'en-GB', share },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 340, marginInline: 'auto' }}>
        <Story />
      </div>
    ),
  ],
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

/** “How’s crypto doing?” in the chat. */
export const MarketInAChat: StoryObj<typeof CryptoMarket> = {
  render: (args) => (
    <InChat
      ask="How’s crypto doing?"
      answer="A quiet, slightly green day: the whole market is up about 1%, and bitcoin is still more than half of it."
    >
      <CryptoMarket {...args} />
    </InChat>
  ),
  args: { market: sampleMarket(), locale: 'en-GB', share },
  decorators: [(Story) => <Story />],
};
