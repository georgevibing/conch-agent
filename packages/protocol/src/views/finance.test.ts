import { describe, expect, it } from 'vitest';

import { ToolView } from '../chat-cards';
import {
  changeWord,
  CompanyFundamentals,
  CryptoMarketView,
  FundamentalsView,
  homeCurrency,
  PriceSeries,
  Quote,
  QuotesView,
} from './finance';

const quote = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  exchange: 'NASDAQ',
  currency: 'USD',
  class: 'stock' as const,
  price: 257.2,
  change: 1.7,
  changePercent: 0.67,
  asOf: '2026-10-07T20:00:00Z',
  delayed: true,
  dayRange: { low: 254.1, high: 258.3 },
  previousClose: 255.5,
  open: 255.5,
  volume: 41_234_567,
  dayState: 'closed' as const,
  spark: { period: '1M' as const, values: [250, 252, 257.2] },
  source: 'Stooq',
};

describe('the quotes view', () => {
  it('is one of the tool views, every figure with its time and its source', () => {
    const view = ToolView.parse({
      kind: 'quotes',
      items: [quote],
      missing: ['NOTATICKER'],
      series: [
        {
          symbol: 'AAPL',
          period: '1M',
          dates: ['2026-09-07', '2026-10-07'],
          closes: [250, 257.2],
          currency: 'USD',
          source: 'Stooq (daily closes)',
        },
      ],
    });
    expect(view.kind).toBe('quotes');
    if (view.kind !== 'quotes') return;
    expect(view.items[0]?.delayed).toBe(true);
    expect(view.items[0]?.asOf).toBe('2026-10-07T20:00:00Z');
  });

  it('assumes a price is delayed, and that nobody said which market state', () => {
    const bare = Quote.parse({ symbol: 'AAPL', price: 257.2, asOf: '2026-10-07', source: 'Stooq' });
    expect(bare.delayed).toBe(true);
    expect(bare.dayState).toBe('unknown');
    expect(bare.class).toBe('unknown');
    // Nothing was fetched, so nothing is there to draw: never a zero in its place.
    expect(bare.change).toBeUndefined();
    expect(bare.previousClose).toBeUndefined();
    expect(bare.marketCap).toBeUndefined();
  });

  it('refuses what can’t be a price, a symbol or a currency', () => {
    const base = { price: 1, asOf: '2026-10-07', source: 'Stooq' };
    expect(Quote.safeParse({ ...base, symbol: 'AA PL' }).success).toBe(false);
    expect(Quote.safeParse({ ...base, symbol: '<script>' }).success).toBe(false);
    expect(Quote.safeParse({ ...base, symbol: 'AAPL', price: -1 }).success).toBe(false);
    expect(Quote.safeParse({ ...base, symbol: 'AAPL', price: Number.NaN }).success).toBe(false);
    expect(Quote.safeParse({ ...base, symbol: 'AAPL', currency: 'dollars' }).success).toBe(false);
    expect(Quote.safeParse({ ...base, symbol: 'AAPL', volume: 1.5 }).success).toBe(false);
    // Indices, crypto pairs and foreign listings are symbols people really write.
    for (const symbol of ['^SPX', 'BTC-USD', 'AIR.PA', 'EURUSD'])
      expect(Quote.safeParse({ ...base, symbol }).success).toBe(true);
  });

  it('holds one to eight instruments', () => {
    expect(QuotesView.safeParse({ kind: 'quotes', items: [] }).success).toBe(false);
    const many = Array.from({ length: 9 }, () => quote);
    expect(QuotesView.safeParse({ kind: 'quotes', items: many }).success).toBe(false);
    expect(QuotesView.safeParse({ kind: 'quotes', items: many.slice(0, 8) }).success).toBe(true);
  });

  it('keeps a series’ dates and closes to a size a card can draw', () => {
    const big = Array.from({ length: 1401 }, () => '2026-10-07');
    expect(
      PriceSeries.safeParse({ symbol: 'AAPL', period: 'MAX', dates: big, closes: [], source: 'S' })
        .success,
    ).toBe(false);
  });
});

describe('the fundamentals view', () => {
  const figure = {
    value: 416_161_000_000,
    period: 'CY2025',
    periodEnd: '2025-09-27',
    form: '10-K',
    filed: '2025-10-30',
  };

  it('carries the period and the filing date with every figure', () => {
    const view = ToolView.parse({
      kind: 'fundamentals',
      items: [
        {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          cik: '320193',
          currency: 'USD',
          basis: 'annual',
          revenue: { label: 'Revenue', unit: 'currency', tag: 'Revenues', points: [figure] },
        },
      ],
      source: 'SEC EDGAR',
    });
    expect(view.kind).toBe('fundamentals');
    if (view.kind !== 'fundamentals') return;
    expect(view.items[0]?.revenue?.points[0]?.filed).toBe('2025-10-30');
    expect(view.source).toBe('SEC EDGAR');
  });

  it('says plainly when a company has no filings here, instead of inventing them', () => {
    const company = CompanyFundamentals.parse({
      symbol: 'AIR.PA',
      name: 'Airbus SE',
      basis: 'annual',
      unavailable: 'Airbus doesn’t file with the US SEC, so there are no figures here.',
    });
    expect(company.revenue).toBeUndefined();
    expect(company.netIncome).toBeUndefined();
    expect(company.unavailable).toMatch(/doesn’t file/);
  });

  it('names SEC EDGAR by default, and compares at most four companies', () => {
    const one = { symbol: 'A', name: 'A', basis: 'annual' as const };
    expect(FundamentalsView.parse({ kind: 'fundamentals', items: [one] }).source).toBe('SEC EDGAR');
    expect(
      FundamentalsView.safeParse({ kind: 'fundamentals', items: Array(5).fill(one) }).success,
    ).toBe(false);
  });
});

describe('a change in words', () => {
  it('never leaves direction to colour', () => {
    expect(changeWord(1.2)).toBe('up');
    expect(changeWord(-1.2)).toBe('down');
    expect(changeWord(0)).toBe('flat');
    expect(changeWord(undefined)).toBe('flat');
  });
});

describe('a coin', () => {
  const coin = {
    symbol: 'BTC',
    name: 'Bitcoin',
    currency: 'USD',
    class: 'crypto' as const,
    price: 67_187,
    change: -211.6,
    changePercent: -0.31,
    asOf: '2026-10-09T21:04:00Z',
    dayState: 'always' as const,
    source: 'CoinGecko',
    crypto: {
      id: 'bitcoin',
      rank: 1,
      marketCap: 1.32e12,
      fullyDiluted: 1.41e12,
      supply: { circulating: 19_610_806, total: 21e6, max: 21e6 },
      ath: { price: 109_000, date: '2025-01-21T00:00:00Z', fromPercent: -38.4 },
      atl: { price: 67.81, date: '2013-07-06T00:00:00Z', fromPercent: 98_987 },
      changes: { '1h': 0.1, '24h': -0.31, '7d': 4.2, '30d': 12, '1y': 140 },
      source: 'CoinGecko' as const,
    },
  };

  it('trades 24/7 and carries what an aggregator says about it', () => {
    const quote = Quote.parse(coin);
    expect(quote.dayState).toBe('always');
    expect(quote.crypto?.changes?.['1y']).toBe(140);
    // A move from its low can be a thousandfold: that's still a number.
    expect(quote.crypto?.atl?.fromPercent).toBe(98_987);
  });

  it('has no maximum supply said in so many words, never as zero', () => {
    const quote = Quote.parse({
      ...coin,
      crypto: { ...coin.crypto, supply: { circulating: 1.4e11, unlimited: true } },
    });
    expect(quote.crypto?.supply?.max).toBeUndefined();
    expect(quote.crypto?.supply?.unlimited).toBe(true);
  });

  it('refuses an id that isn’t CoinGecko’s shape, and any source but CoinGecko for its details', () => {
    expect(Quote.safeParse({ ...coin, crypto: { ...coin.crypto, id: '../x' } }).success).toBe(
      false,
    );
    expect(Quote.safeParse({ ...coin, crypto: { ...coin.crypto, source: 'Me' } }).success).toBe(
      false,
    );
  });

  it('can chart a day minute by minute, with the instant of each point', () => {
    const series = PriceSeries.parse({
      symbol: 'BTC',
      period: '1D',
      dates: ['2026-10-09', '2026-10-09'],
      closes: [67_000, 67_187],
      times: ['2026-10-09T20:59:00Z', '2026-10-09T21:04:00Z'],
      source: 'CoinGecko (every five minutes)',
    });
    expect(series.times).toHaveLength(2);
  });
});

describe('the crypto market', () => {
  it('is one of the tool views, with at most ten coins', () => {
    const one = { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 67_187, rank: 1 };
    const view = {
      kind: 'crypto-market',
      currency: 'USD',
      totalMarketCap: 2.41e12,
      change24h: 1.2,
      dominance: { btc: 54.1, eth: 13.2 },
      coins: [one],
      asOf: '2026-10-09T21:04:00Z',
      source: 'CoinGecko',
    };
    expect(ToolView.parse(view).kind).toBe('crypto-market');
    expect(CryptoMarketView.safeParse({ ...view, coins: Array(11).fill(one) }).success).toBe(false);
  });
});

describe('the currency someone counts in', () => {
  it('follows the time zone, and is dollars when it can’t tell', () => {
    expect(homeCurrency('Europe/Berlin')).toBe('EUR');
    expect(homeCurrency('Europe/Lisbon')).toBe('EUR');
    expect(homeCurrency('Europe/London')).toBe('GBP');
    expect(homeCurrency('Europe/Zurich')).toBe('CHF');
    expect(homeCurrency('Asia/Tokyo')).toBe('JPY');
    expect(homeCurrency('America/Toronto')).toBe('CAD');
    expect(homeCurrency('America/New_York')).toBe('USD');
    expect(homeCurrency('Europe/Warsaw')).toBe('USD');
    expect(homeCurrency(undefined)).toBe('USD');
  });
});
