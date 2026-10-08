/**
 * Money, as the card draws it. Mirrors `QuotesView` and `FundamentalsView` in
 * `@conch/protocol` structurally; Nacre stays dependency-free.
 *
 * Every optional field here is optional on purpose: a figure nobody fetched is
 * absent, and the card draws a gap rather than a number nobody read.
 */

/** The stretches of time the price chart draws. */
export const FINANCE_PERIODS = ['1W', '1M', '3M', '6M', '1Y', '5Y'] as const;
export type FinancePeriod = (typeof FINANCE_PERIODS)[number] | 'MAX';

export type MarketState = 'open' | 'closed' | 'pre' | 'post' | 'unknown';

export type InstrumentClass = 'stock' | 'etf' | 'index' | 'crypto' | 'fx' | 'commodity' | 'unknown';

/** Daily closes, oldest first: `dates` and `closes` run together. */
export interface PriceSeries {
  symbol: string;
  period: FinancePeriod;
  dates: string[];
  closes: number[];
  currency?: string;
  /** Who the closes are from: "Stooq (daily closes)". */
  source: string;
  note?: string;
}

/** A sparkline's worth of closes: the shape without the dates. */
export interface PriceSpark {
  period: FinancePeriod;
  values: number[];
}

/** What a whole company is worth at this price, and the share count it used. */
export interface MarketCap {
  value: number;
  shares: number;
  filed?: string;
  source: string;
}

export interface Quote {
  symbol: string;
  name?: string;
  exchange?: string;
  currency?: string;
  class?: InstrumentClass;
  price: number;
  change?: number;
  changePercent?: number;
  /** When this price is from, as an ISO instant. */
  asOf: string;
  /** Said plainly on the card. */
  delayed?: boolean;
  dayRange?: { low: number; high: number };
  previousClose?: number;
  open?: number;
  volume?: number;
  marketCap?: MarketCap;
  dayState?: MarketState;
  spark?: PriceSpark;
  /** Who the price is from: "Stooq". */
  source: string;
}

/** One figure out of one filing, with everything needed to say where it came from. */
export interface FiledFigure {
  value: number;
  /** The period in the filing's own words: "CY2025". */
  period: string;
  periodEnd?: string;
  /** "10-K", "10-Q". */
  form?: string;
  filed?: string;
}

/** One measure across periods, oldest first. */
export interface FiledSeries {
  label: string;
  unit: 'currency' | 'shares' | 'perShare' | 'people' | 'percent';
  /** The XBRL tag it came from, so a figure can be traced. */
  tag?: string;
  points: FiledFigure[];
}

export interface CompanyFigures {
  symbol: string;
  name: string;
  cik?: string;
  currency?: string;
  basis: 'annual' | 'quarterly';
  revenue?: FiledSeries;
  grossProfit?: FiledSeries;
  netIncome?: FiledSeries;
  eps?: FiledSeries;
  dividendPerShare?: FiledSeries;
  employees?: FiledFigure;
  priceEarnings?: { value: number; price: number; asOf: string; period: string };
  /** Why there's nothing to show, in plain words. */
  unavailable?: string;
}

/** Prices for one to eight instruments, as the card takes them. */
export interface QuotesData {
  items: Quote[];
  /** Symbols nobody had a price for, as they were asked for. */
  missing?: string[];
  /** The person is comparing: overlay them from the range's start. */
  compare?: boolean;
  series?: PriceSeries[];
}

/** One company's filed figures, or two to four side by side. */
export interface FundamentalsData {
  items: CompanyFigures[];
  /** Whose filings these are: "SEC EDGAR". */
  source?: string;
}
