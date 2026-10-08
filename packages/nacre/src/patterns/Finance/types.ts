/**
 * Money, as the card draws it. Mirrors `QuotesView` and `FundamentalsView` in
 * `@conch/protocol` structurally; Nacre stays dependency-free.
 *
 * Every optional field here is optional on purpose: a figure nobody fetched is
 * absent, and the card draws a gap rather than a number nobody read.
 */

/** The stretches of time the price chart draws. */
export const FINANCE_PERIODS = ['1W', '1M', '3M', '6M', '1Y', '5Y'] as const;
export type FinancePeriod = (typeof FINANCE_PERIODS)[number] | '1D' | 'MAX';

/** `always`: what never closes (a coin trades 24/7). */
export type MarketState = 'open' | 'closed' | 'pre' | 'post' | 'always' | 'unknown';

export type InstrumentClass = 'stock' | 'etf' | 'index' | 'crypto' | 'fx' | 'commodity' | 'unknown';

/** Daily closes, oldest first: `dates` and `closes` run together. */
export interface PriceSeries {
  symbol: string;
  period: FinancePeriod;
  dates: string[];
  closes: number[];
  currency?: string;
  /** The instant of each point, when they're hours or minutes apart (a coin's day). */
  times?: string[];
  /** Who the closes are from: "Stooq (daily closes)", "CoinGecko (hourly)". */
  source: string;
  note?: string;
}

/** The stretches a coin's move is given over, shortest first. */
export const COIN_CHANGES = ['1h', '24h', '7d', '30d', '1y'] as const;
export type CoinChange = (typeof COIN_CHANGES)[number];

/** A price a coin reached once, when, and how far today's is from it (−38 is 38% below). */
export interface CoinExtreme {
  price: number;
  date: string;
  fromPercent?: number;
}

/** Another coin that answers to the same symbol. */
export interface CoinAlternative {
  id: string;
  symbol: string;
  name: string;
  rank?: number;
}

/**
 * What an aggregator says about a coin. Every amount is in the quote's
 * currency. `supply.max` is absent when there's no maximum, and `unlimited`
 * says so in words.
 */
export interface CryptoDetails {
  id: string;
  rank?: number;
  marketCap?: number;
  fullyDiluted?: number;
  volume24h?: number;
  supply?: { circulating?: number; total?: number; max?: number; unlimited?: boolean };
  ath?: CoinExtreme;
  atl?: CoinExtreme;
  changes?: Partial<Record<CoinChange, number>>;
  alternatives?: CoinAlternative[];
  about?: string;
  genesis?: string;
  algorithm?: string;
  categories?: string[];
  /** "CoinGecko". */
  source: string;
}

/** One coin in the market overview. */
export interface MarketCoin {
  id: string;
  symbol: string;
  name: string;
  rank?: number;
  price: number;
  change24h?: number;
  change7d?: number;
  marketCap?: number;
  /** The last week's shape. */
  spark?: number[];
}

/** Crypto as a whole, as the overview card takes it. */
export interface CryptoMarketData {
  currency: string;
  totalMarketCap: number;
  change24h?: number;
  volume24h?: number;
  /** Shares of the whole, in percent. */
  dominance?: { btc: number; eth?: number };
  coinsTracked?: number;
  coins: MarketCoin[];
  asOf: string;
  /** "CoinGecko". */
  source: string;
  notice?: string;
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
  /** A coin's aggregator figures. */
  crypto?: CryptoDetails;
  /** Said on the card about where this came from: "CoinGecko is busy; prices from Stooq". */
  notice?: string;
  /** Who the price is from: "Stooq", "CoinGecko". */
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
