/**
 * Money, as a card in the chat (ADR 0060 §7): what an instrument costs now
 * (`quotes`), its price over a stretch of time, and how a company is doing
 * from its own filings (`fundamentals`).
 *
 * Three rules hold this schema together, because money is the one place a
 * confident guess does real harm:
 *
 * 1. **Every figure says what it is, when it's from, and whose it is.** A
 *    quote carries `asOf`, `delayed` and `source`; every filed figure carries
 *    its `period`, the date the period ended and the date it was filed.
 * 2. **A figure that wasn't fetched isn't here.** Everything but the price
 *    itself is optional, so a card draws a gap rather than a number nobody
 *    read. Nothing is derived on the wire except where it says so.
 * 3. **Nothing is advice.** There is no field for a rating, a target or a
 *    recommendation, and no card may imply one.
 *
 * Everything in here came from outside Conch: plain text, drawn as text,
 * never markup and never a remote address.
 */
import { z } from 'zod';

/** A calendar date: `2026-10-08`. */
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** An instant, as the source gave it: `2026-10-08T21:00:00Z`. */
const When = z.string().min(4).max(40);
/** A price or an amount of money. Negative is allowed: a loss is a number too. */
const Amount = z.number().finite();
/** A price: never negative, and bounded so a broken parse can't become a card. */
const Price = z.number().finite().nonnegative().max(1e12);
/** An ISO 4217 code (`USD`, `EUR`), or a crypto ticker used as one (`USDT`). */
const Currency = z.string().regex(/^[A-Z]{3,5}$/, 'A currency code.');
/** A ticker as a person writes it: `AAPL`, `^SPX`, `BTC-USD`, `AIR.PA`. */
export const TickerSymbol = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[A-Za-z0-9^.:=\-/]+$/, 'A ticker symbol.');

/** The stretches of time a price chart draws. `MAX` is everything the source has. */
export const FINANCE_PERIODS = ['1W', '1M', '3M', '6M', '1Y', '5Y', 'MAX'] as const;
export const FinancePeriod = z.enum(FINANCE_PERIODS);
export type FinancePeriod = z.infer<typeof FinancePeriod>;

/** Where the market was when the price was read. `unknown` when the source doesn't say. */
export const MarketState = z.enum(['open', 'closed', 'pre', 'post', 'unknown']);
export type MarketState = z.infer<typeof MarketState>;

/** What kind of thing it is, so the card uses the right words. */
export const InstrumentClass = z.enum([
  'stock',
  'etf',
  'index',
  'crypto',
  'fx',
  'commodity',
  'unknown',
]);
export type InstrumentClass = z.infer<typeof InstrumentClass>;

/** The most instruments one quotes card holds. */
export const QUOTES_MAX = 8;
/** The most companies one fundamentals card compares. */
export const FUNDAMENTALS_MAX = 4;
/** The most points a price series carries (five years of trading days, with room). */
export const SERIES_MAX = 1400;

/**
 * A price over time, as the source closed each session: `dates` and `closes`
 * run together, oldest first. Daily closes, not ticks — the card says so.
 */
export const PriceSeries = z.object({
  symbol: TickerSymbol,
  period: FinancePeriod,
  /** One per close, oldest first. */
  dates: z.array(LocalDate).max(SERIES_MAX),
  closes: z.array(Price).max(SERIES_MAX),
  currency: Currency.optional(),
  /** "Stooq (daily closes)". */
  source: z.string().min(1).max(80),
  /** How far the dates reach, in words: "daily closes since 8 October 2021". */
  note: z.string().max(200).optional(),
});
export type PriceSeries = z.infer<typeof PriceSeries>;

/** A sparkline's worth of closes for a compact chip: no dates, just the shape. */
export const PriceSpark = z.object({
  period: FinancePeriod,
  values: z.array(Price).max(400),
});
export type PriceSpark = z.infer<typeof PriceSpark>;

/**
 * One instrument's price as a source last read it. `delayed` is on unless a
 * source says otherwise: Conch never implies a live tick.
 */
export const Quote = z.object({
  symbol: TickerSymbol,
  /** Its name, as the source names it: "Apple Inc." */
  name: z.string().max(140).optional(),
  /** Where it trades, when the source says: "NASDAQ". */
  exchange: z.string().max(60).optional(),
  currency: Currency.optional(),
  class: InstrumentClass.default('unknown'),
  price: Price,
  /** Change on the previous close, in the instrument's own currency. */
  change: Amount.optional(),
  /** The same change as a percentage of the previous close. */
  changePercent: z.number().finite().min(-100).max(100_000).optional(),
  /** When this price is from. */
  asOf: When,
  /** Said plainly on the card. True unless a source promises otherwise. */
  delayed: z.boolean().default(true),
  dayRange: z.object({ low: Price, high: Price }).optional(),
  previousClose: Price.optional(),
  open: Price.optional(),
  volume: z.number().int().nonnegative().max(1e15).optional(),
  /**
   * What the whole company is worth at this price. Worked out, not quoted, so
   * it carries the share count it multiplied and where that count came from —
   * the card says as much.
   */
  marketCap: z
    .object({
      value: z.number().nonnegative().max(1e16),
      /** Shares outstanding the figure used. */
      shares: z.number().positive().max(1e14),
      /** The day that share count was filed. */
      filed: LocalDate.optional(),
      /** Whose share count it is: "SEC EDGAR". */
      source: z.string().min(1).max(80),
    })
    .optional(),
  dayState: MarketState.default('unknown'),
  spark: PriceSpark.optional(),
  /** Who the price is from, for the card's small print: "Stooq". */
  source: z.string().min(1).max(80),
});
export type Quote = z.infer<typeof Quote>;

/**
 * Prices for one to eight instruments. `missing` names what was asked for and
 * not found, so the card can say so instead of quietly dropping it.
 */
export const QuotesView = z.object({
  kind: z.literal('quotes'),
  items: z.array(Quote).min(1).max(QUOTES_MAX),
  /** Symbols nobody had a price for, as they were asked for. */
  missing: z.array(z.string().max(40)).max(QUOTES_MAX).optional(),
  /** The person is comparing: the card overlays them from the range's start. */
  compare: z.boolean().optional(),
  /** Full dated history for the chart, one per instrument it was fetched for. */
  series: z.array(PriceSeries).max(QUOTES_MAX).optional(),
});
export type QuotesView = z.infer<typeof QuotesView>;

/**
 * One figure out of one filing. It never stands alone: the period it covers,
 * the day that period ended, the form it was filed on and the day it was
 * filed all travel with it, so the card can show where it came from.
 */
export const FiledFigure = z.object({
  value: Amount,
  /** The period, in the filing's own words: "CY2025", "FY2025", "Q2 2025". */
  period: z.string().min(1).max(24),
  /** The last day of that period. */
  periodEnd: LocalDate.optional(),
  /** The form it was filed on: "10-K", "10-Q", "20-F". */
  form: z.string().max(12).optional(),
  /** The day it was filed with the regulator. */
  filed: LocalDate.optional(),
});
export type FiledFigure = z.infer<typeof FiledFigure>;

/** One measure across periods, oldest first, so the card can chart it. */
export const FiledSeries = z.object({
  /** "Revenue", "Net income". */
  label: z.string().min(1).max(40),
  /** How to read the values: money, a share count, or money per share. */
  unit: z.enum(['currency', 'shares', 'perShare', 'people', 'percent']),
  /** The XBRL tag it came from, so a figure can always be traced: "NetIncomeLoss". */
  tag: z.string().max(80).optional(),
  points: z.array(FiledFigure).min(1).max(16),
});
export type FiledSeries = z.infer<typeof FiledSeries>;

/**
 * How one company is doing, from what it filed. Margins aren't here: the card
 * works them out from revenue and income of the *same* period and labels them
 * as worked out, so no number appears that nobody filed.
 */
export const CompanyFundamentals = z.object({
  symbol: TickerSymbol,
  name: z.string().min(1).max(140),
  /** Its number with the US regulator, when it files there. */
  cik: z
    .string()
    .regex(/^\d{1,10}$/)
    .optional(),
  currency: Currency.optional(),
  /** Whether the figures are whole years or quarters. */
  basis: z.enum(['annual', 'quarterly']),
  revenue: FiledSeries.optional(),
  grossProfit: FiledSeries.optional(),
  netIncome: FiledSeries.optional(),
  /** Diluted earnings per share, as filed. */
  eps: FiledSeries.optional(),
  dividendPerShare: FiledSeries.optional(),
  employees: FiledFigure.optional(),
  /**
   * Price divided by the last filed year's earnings per share. Worked out,
   * not filed, so it carries the price and the period it used.
   */
  priceEarnings: z
    .object({
      value: z.number().finite().min(-10_000).max(10_000),
      price: Price,
      /** When that price was from. */
      asOf: When,
      /** The earnings period it divided into: "CY2025". */
      period: z.string().max(24),
    })
    .optional(),
  /** Why there's nothing to show, in plain words. Never a guess in its place. */
  unavailable: z.string().max(240).optional(),
});
export type CompanyFundamentals = z.infer<typeof CompanyFundamentals>;

/** One company's figures, or two to four side by side. */
export const FundamentalsView = z.object({
  kind: z.literal('fundamentals'),
  items: z.array(CompanyFundamentals).min(1).max(FUNDAMENTALS_MAX),
  /** Whose filings these are: "SEC EDGAR". */
  source: z.string().min(1).max(80).default('SEC EDGAR'),
});
export type FundamentalsView = z.infer<typeof FundamentalsView>;

// ── Reading them ────────────────────────────────────────────────────────────

/** How many trading days a period covers, roughly: what to ask a source for. */
export const PERIOD_DAYS: Record<FinancePeriod, number> = {
  '1W': 7,
  '1M': 31,
  '3M': 93,
  '6M': 186,
  '1Y': 366,
  '5Y': 1830,
  MAX: 40_000,
};

/** The period in words, for a chart's caption: "the last three months". */
export const PERIOD_WORDS: Record<FinancePeriod, string> = {
  '1W': 'the last week',
  '1M': 'the last month',
  '3M': 'the last three months',
  '6M': 'the last six months',
  '1Y': 'the last year',
  '5Y': 'the last five years',
  MAX: 'as far back as the source goes',
};

/** "up", "down" or "flat" — the word, so nothing is told by colour alone. */
export function changeWord(change: number | undefined): 'up' | 'down' | 'flat' {
  if (change === undefined || Math.abs(change) < 1e-9) return 'flat';
  return change > 0 ? 'up' : 'down';
}

/** What the market's state says in plain words: "Closed", "Open". */
export const MARKET_WORDS: Record<MarketState, string> = {
  open: 'Open',
  closed: 'Closed',
  pre: 'Before the open',
  post: 'After the close',
  unknown: '',
};
