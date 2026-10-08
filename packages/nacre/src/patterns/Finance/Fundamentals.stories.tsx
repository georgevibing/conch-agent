import type { Meta, StoryObj } from '@storybook/react-vite';

import { InChat } from '../ToolViews/fixtures';
import { Fundamentals } from './FinanceCard';
import { sampleCompany, sampleLosses, sampleNotFiled } from './fixtures';

const meta = {
  title: 'Patterns/Chat/Finance Fundamentals',
  component: Fundamentals,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'How a company is doing, out of its own filings with the US regulator (ADR 0060 §7). Revenue and net income are small bars, one per financial year, with the latest year’s growth labelled in words; margins are meters that say they were worked out from the revenue and the profit of the same period; and every figure can tell you where it came from — the period it covers, the form it was filed on and the day it was filed, one press away. A company that files elsewhere says so plainly rather than showing numbers from somewhere else, and a loss-making year draws its bar the other way with the word “down” beside it. Nothing here is advice.',
      },
    },
  },
  args: { locale: 'en-GB' },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 620, marginInline: 'auto' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Fundamentals>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One company's filings: revenue and income as bars, margins as meters. */
export const OneCompany: Story = {
  args: { fundamentals: { items: [sampleCompany()], source: 'SEC EDGAR' }, locale: 'en-GB' },
};

/** Three companies side by side, each figure with its period and filing date. */
export const CompaniesCompared: Story = {
  args: {
    fundamentals: {
      items: [
        sampleCompany(),
        sampleCompany({
          symbol: 'MSFT',
          name: 'Microsoft Corp.',
          cik: '789019',
          revenue: {
            label: 'Revenue',
            unit: 'currency',
            tag: 'RevenueFromContractWithCustomerExcludingAssessedTax',
            points: [168_088, 198_270, 211_915, 245_122, 281_724].map((v, i) => ({
              value: v * 1e6,
              period: `CY${2021 + i}`,
              periodEnd: `${2021 + i}-06-30`,
              form: '10-K',
              filed: `${2021 + i}-07-30`,
            })),
          },
          netIncome: {
            label: 'Net income',
            unit: 'currency',
            tag: 'NetIncomeLoss',
            points: [61_271, 72_738, 72_361, 88_136, 101_832].map((v, i) => ({
              value: v * 1e6,
              period: `CY${2021 + i}`,
              periodEnd: `${2021 + i}-06-30`,
              form: '10-K',
              filed: `${2021 + i}-07-30`,
            })),
          },
          grossProfit: undefined,
          eps: {
            label: 'Earnings per share',
            unit: 'perShare',
            tag: 'EarningsPerShareDiluted',
            points: [8.05, 9.65, 9.68, 11.8, 13.56].map((v, i) => ({
              value: v,
              period: `CY${2021 + i}`,
              periodEnd: `${2021 + i}-06-30`,
              form: '10-K',
              filed: `${2021 + i}-07-30`,
            })),
          },
          dividendPerShare: {
            label: 'Dividend per share',
            unit: 'perShare',
            tag: 'CommonStockDividendsPerShareDeclared',
            points: [2.24, 2.48, 2.72, 3.0, 3.32].map((v, i) => ({
              value: v,
              period: `CY${2021 + i}`,
              periodEnd: `${2021 + i}-06-30`,
              form: '10-K',
              filed: `${2021 + i}-07-30`,
            })),
          },
          priceEarnings: {
            value: 37.8,
            price: 512.4,
            asOf: '2026-10-09T20:00:00Z',
            period: 'CY2025',
          },
          employees: { value: 228_000, period: 'CY2025', filed: '2025-07-30' },
        }),
        sampleLosses(),
      ],
      source: 'SEC EDGAR',
    },
    locale: 'en-GB',
  },
};

/** A company that files elsewhere: the card says so instead of inventing figures. */
export const NoFilings: Story = {
  args: {
    fundamentals: { items: [sampleNotFiled()], source: 'SEC EDGAR' },
    locale: 'en-GB',
  },
};

/** A loss-making year: the bar goes the other way and says "down" in words. */
export const Losses: Story = {
  args: { fundamentals: { items: [sampleLosses()], source: 'SEC EDGAR' }, locale: 'en-GB' },
};

/** In the chat: the card is the figures, and the reply is the judgement. */
export const InAChat: Story = {
  render: (args) => (
    <InChat
      ask="How is Apple doing financially?"
      answer="Revenue grew about 6% in its last financial year and profit rather more, so margins widened — from the filings, not advice."
    >
      <Fundamentals {...args} />
    </InChat>
  ),
  args: { fundamentals: { items: [sampleCompany()], source: 'SEC EDGAR' } },
  decorators: [(Story) => <Story />],
};
