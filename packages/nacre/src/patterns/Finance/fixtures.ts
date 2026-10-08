/**
 * Made-up prices and filings, for the stories and the tests. Nothing here is a
 * real figure: the shapes match what Stooq and SEC EDGAR really send, so the
 * card can be read in every state without asking anybody for data.
 */
import type {
  CompanyFigures,
  CryptoMarketData,
  FinancePeriod,
  FiledFigure,
  PriceSeries,
  Quote,
  QuotesData,
} from './types';

const DAY = 86_400_000;
/** A fixed Friday, so a story looks the same every run. */
export const SAMPLE_NOW = Date.parse('2026-10-09T20:00:00Z');

const date = (offset: number) => new Date(SAMPLE_NOW + offset * DAY).toISOString().slice(0, 10);

/** Trading days back from the sample day, weekends skipped. */
function sessions(count: number, every = 1): string[] {
  const days: string[] = [];
  for (let back = 0; days.length < count; back += every) {
    const at = new Date(SAMPLE_NOW - back * DAY);
    const weekday = at.getUTCDay();
    if (every === 1 && (weekday === 0 || weekday === 6)) continue;
    days.push(at.toISOString().slice(0, 10));
  }
  return days.reverse();
}

/** A believable walk: a trend plus a wobble, the same numbers every run. */
function walk(end: number, count: number, drift: number, wobble: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const f = i / Math.max(1, count - 1);
    const base = end / (1 + drift) + (end - end / (1 + drift)) * f;
    const wave =
      Math.sin(i * 0.9) * wobble +
      Math.sin(i * 0.31 + 1.7) * wobble * 0.6 +
      Math.cos(i * 2.3) * wobble * 0.25;
    return Math.round((base + wave) * 100) / 100;
  });
}

export function sampleSeries(
  options: {
    symbol?: string;
    period?: FinancePeriod;
    end?: number;
    points?: number;
    drift?: number;
    wobble?: number;
    currency?: string;
    every?: number;
  } = {},
): PriceSeries {
  const {
    symbol = 'AAPL',
    period = '1M',
    end = 257.2,
    points = 22,
    drift = 0.07,
    wobble = 2.1,
    currency = 'USD',
    every = 1,
  } = options;
  const dates = sessions(points, every);
  const closes = walk(end, points, drift, wobble);
  return {
    symbol,
    period,
    dates,
    closes,
    currency,
    source: 'Stooq (daily closes)',
    note: `Daily closes from ${dates[0]} to ${dates.at(-1)}.`,
  };
}

export function sampleQuote(options: Partial<Quote> & { series?: PriceSeries } = {}): Quote {
  const series = options.series ?? sampleSeries();
  const price = options.price ?? series.closes.at(-1) ?? 257.2;
  const previous = options.previousClose ?? series.closes.at(-2) ?? price;
  const change = options.change ?? Math.round((price - previous) * 100) / 100;
  const { series: _ignored, ...rest } = options;
  return {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    exchange: 'NASDAQ',
    currency: 'USD',
    class: 'stock',
    price,
    change,
    changePercent: Math.round((change / previous) * 10000) / 100,
    asOf: new Date(SAMPLE_NOW - 10 * 3_600_000).toISOString(),
    delayed: true,
    dayRange: {
      low: Math.round(price * 0.988 * 100) / 100,
      high: Math.round(price * 1.007 * 100) / 100,
    },
    previousClose: previous,
    open: previous,
    volume: 41_234_567,
    marketCap: {
      value: Math.round(price * 14_840_390_000),
      shares: 14_840_390_000,
      filed: date(-344),
      source: 'SEC EDGAR',
    },
    dayState: 'closed',
    spark: { period: series.period, values: series.closes },
    source: 'Stooq',
    ...rest,
  };
}

/** One instrument, with a month of closes. */
export function sampleQuotes(): QuotesData {
  const series = sampleSeries();
  return { items: [sampleQuote({ series })], series: [series] };
}

/** A shelf: eight instruments of different kinds, one chosen. */
export function sampleShelf(): QuotesData {
  const made: { symbol: string; name: string; end: number; drift: number; currency?: string }[] = [
    { symbol: 'AAPL', name: 'Apple Inc.', end: 257.2, drift: 0.07 },
    { symbol: 'MSFT', name: 'Microsoft Corp.', end: 512.4, drift: -0.03 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', end: 188.65, drift: 0.19 },
    { symbol: '^SPX', name: 'S&P 500', end: 6842.1, drift: 0.02 },
    { symbol: 'BTC-USD', name: 'Bitcoin', end: 94_210.5, drift: -0.11 },
    { symbol: 'EURUSD', name: 'Euro / US dollar', end: 1.0842, drift: 0.004 },
    { symbol: 'AIR.PA', name: 'Airbus SE', end: 214.3, drift: 0.05, currency: 'EUR' },
    { symbol: 'TSLA', name: 'Tesla, Inc.', end: 402.11, drift: -0.08 },
  ];
  const series = made.map((m) =>
    sampleSeries({
      symbol: m.symbol,
      end: m.end,
      drift: m.drift,
      wobble: m.end * 0.009,
      currency: m.currency ?? 'USD',
    }),
  );
  return {
    items: made.map((m, k) => {
      const s = series[k];
      const price = s?.closes.at(-1) ?? m.end;
      const previous = s?.closes.at(-2) ?? price;
      return sampleQuote({
        series: s,
        symbol: m.symbol,
        name: m.name,
        currency: m.currency ?? 'USD',
        class: m.symbol.startsWith('^')
          ? 'index'
          : m.symbol.includes('-')
            ? 'crypto'
            : m.symbol === 'EURUSD'
              ? 'fx'
              : 'stock',
        price,
        previousClose: previous,
        change: Math.round((price - previous) * 100) / 100,
        exchange: m.symbol.endsWith('.PA') ? 'Euronext Paris' : undefined,
        // An index has no currency and nothing behind it to be worth something.
        ...(m.symbol.startsWith('^')
          ? { marketCap: undefined, volume: undefined, currency: undefined }
          : m.symbol.includes('-') || m.symbol === 'EURUSD'
            ? { marketCap: undefined, volume: undefined }
            : {}),
      });
    }),
    series,
    missing: ['PLTRX'],
  };
}

/** Three instruments to compare, normalised from the range's start. */
export function sampleCompare(): QuotesData {
  const shelf = sampleShelf();
  return {
    items: shelf.items.slice(0, 3),
    series: shelf.series?.slice(0, 3),
    compare: true,
  };
}

const filed = (value: number, year: number): FiledFigure => ({
  value,
  period: `CY${year}`,
  periodEnd: `${year}-09-27`,
  form: '10-K',
  filed: `${year}-10-30`,
});

export function sampleCompany(options: Partial<CompanyFigures> = {}): CompanyFigures {
  const years = [2021, 2022, 2023, 2024, 2025];
  return {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    cik: '320193',
    currency: 'USD',
    basis: 'annual',
    revenue: {
      label: 'Revenue',
      unit: 'currency',
      tag: 'RevenueFromContractWithCustomerExcludingAssessedTax',
      points: [365_817, 394_328, 383_285, 391_035, 416_161].map((v, i) =>
        filed(v * 1e6, years[i] ?? 2025),
      ),
    },
    grossProfit: {
      label: 'Gross profit',
      unit: 'currency',
      tag: 'GrossProfit',
      points: [152_836, 170_782, 169_148, 180_683, 198_900].map((v, i) =>
        filed(v * 1e6, years[i] ?? 2025),
      ),
    },
    netIncome: {
      label: 'Net income',
      unit: 'currency',
      tag: 'NetIncomeLoss',
      points: [94_680, 99_803, 96_995, 93_736, 112_010].map((v, i) =>
        filed(v * 1e6, years[i] ?? 2025),
      ),
    },
    eps: {
      label: 'Earnings per share',
      unit: 'perShare',
      tag: 'EarningsPerShareDiluted',
      points: [5.61, 6.11, 6.13, 6.08, 7.48].map((v, i) => filed(v, years[i] ?? 2025)),
    },
    dividendPerShare: {
      label: 'Dividend per share',
      unit: 'perShare',
      tag: 'CommonStockDividendsPerShareDeclared',
      points: [0.85, 0.9, 0.94, 0.98, 1.04].map((v, i) => filed(v, years[i] ?? 2025)),
    },
    employees: { value: 164_000, period: 'CY2025', periodEnd: '2025-09-27', filed: '2025-10-30' },
    priceEarnings: {
      value: 34.4,
      price: 257.2,
      asOf: new Date(SAMPLE_NOW - 10 * 3_600_000).toISOString(),
      period: 'CY2025',
    },
    ...options,
  };
}

/** A company that files elsewhere: the card says so instead of guessing. */
export function sampleNotFiled(): CompanyFigures {
  return {
    symbol: 'AIR.PA',
    name: 'Airbus SE',
    basis: 'annual',
    unavailable:
      'Airbus doesn’t file with the US SEC, so there are no figures from filings here. Only US filers (and foreign companies that file a 20-F) do.',
  };
}

/** A loss-making year, so the card can be read with a negative bar. */
export function sampleLosses(): CompanyFigures {
  const years = [2022, 2023, 2024, 2025];
  return {
    symbol: 'RVN',
    name: 'Ravenline Motors, Inc.',
    cik: '1888888',
    currency: 'USD',
    basis: 'annual',
    revenue: {
      label: 'Revenue',
      unit: 'currency',
      tag: 'Revenues',
      points: [1_658, 3_072, 4_970, 6_140].map((v, i) => filed(v * 1e6, years[i] ?? 2025)),
    },
    netIncome: {
      label: 'Net income',
      unit: 'currency',
      tag: 'NetIncomeLoss',
      points: [-6_752, -5_432, -4_690, -2_118].map((v, i) => filed(v * 1e6, years[i] ?? 2025)),
    },
    eps: {
      label: 'Earnings per share',
      unit: 'perShare',
      tag: 'EarningsPerShareDiluted',
      points: [-7.4, -5.74, -4.69, -2.02].map((v, i) => filed(v, years[i] ?? 2025)),
    },
    employees: { value: 17_900, period: 'CY2025', periodEnd: '2025-09-27', filed: '2025-10-30' },
  };
}

// ── Coins ───────────────────────────────────────────────────────────────────

/**
 * A coin's walk: the same believable shape, kept to six significant figures
 * rather than cents (a coin at $0.11 moves in fractions of one), and ending
 * exactly on the price the card shows.
 */
function fine(end: number, count: number, drift: number, wobble: number): number[] {
  const values = Array.from({ length: count }, (_, i) => {
    const f = i / Math.max(1, count - 1);
    const base = end / (1 + drift) + (end - end / (1 + drift)) * f;
    const wave =
      Math.sin(i * 0.45) * wobble +
      Math.sin(i * 0.13 + 1.7) * wobble * 0.8 +
      Math.cos(i * 1.7) * wobble * 0.15;
    return Number((base + wave * (1 - f * 0.6)).toPrecision(6));
  });
  values[values.length - 1] = end;
  return values;
}

/** How far apart a coin's points are, and how many, for each range CoinGecko draws. */
const COIN_STEPS: Partial<Record<FinancePeriod, { points: number; every: number }>> = {
  '1D': { points: 288, every: 5 * 60_000 },
  '1W': { points: 168, every: 3_600_000 },
  '1M': { points: 180, every: 4 * 3_600_000 },
  '1Y': { points: 365, every: DAY },
};

/** A coin's prices over a range, every point with its instant, as CoinGecko answers. */
export function sampleCoinSeries(
  options: { symbol?: string; period?: FinancePeriod; end?: number; drift?: number } = {},
): PriceSeries {
  const { symbol = 'BTC', period = '1M', end = 67_187, drift = 0.12 } = options;
  const step = COIN_STEPS[period] ?? { points: 180, every: 4 * 3_600_000 };
  const closes = fine(end, step.points, drift, end * 0.009);
  const times = closes.map((_, i) =>
    new Date(SAMPLE_NOW - (step.points - 1 - i) * step.every).toISOString(),
  );
  return {
    symbol,
    period,
    dates: times.map((t) => t.slice(0, 10)),
    closes,
    ...(period !== '1Y' && { times }),
    currency: 'USD',
    source:
      period === '1D'
        ? 'CoinGecko (every five minutes)'
        : period === '1Y'
          ? 'CoinGecko (daily)'
          : 'CoinGecko (hourly)',
  };
}

/** Bitcoin: ranked first, at most 21 million, well below its high. */
export function sampleCoin(options: Partial<Quote> = {}): Quote {
  const price = options.price ?? 67_187;
  return {
    symbol: 'BTC',
    name: 'Bitcoin',
    currency: 'USD',
    class: 'crypto',
    price,
    change: -211.6,
    changePercent: -0.31,
    asOf: new Date(SAMPLE_NOW + 64 * 60_000).toISOString(),
    delayed: true,
    dayRange: { low: 66_387, high: 67_770 },
    dayState: 'always',
    spark: { period: '1W', values: walk(price, 42, 0.04, price * 0.006) },
    crypto: {
      id: 'bitcoin',
      rank: 1,
      marketCap: 1_317_802_988_326,
      fullyDiluted: 1_410_927_000_000,
      volume24h: 31_260_929_299,
      supply: { circulating: 19_610_806, total: 21_000_000, max: 21_000_000 },
      ath: { price: 109_000, date: '2025-01-20T09:11:54.494Z', fromPercent: -38.36 },
      atl: { price: 67.81, date: '2013-07-06T00:00:00.000Z', fromPercent: 98_987.2 },
      changes: { '1h': 0.12, '24h': -0.31, '7d': 4.2, '30d': 12.08, '1y': 140.4 },
      about:
        'Bitcoin is the first successful internet money based on peer-to-peer technology; whereby no central bank or authority is involved in the transaction and production of the Bitcoin currency. It was created by an anonymous individual or group under the name Satoshi Nakamoto. The source code is available publicly as an open source project.',
      genesis: '2009-01-03',
      algorithm: 'SHA-256',
      categories: ['Cryptocurrency', 'Layer 1 (L1)'],
      source: 'CoinGecko',
    },
    source: 'CoinGecko',
    ...options,
  };
}

/** Bitcoin with a month of hourly prices. */
export function sampleCoinQuotes(): QuotesData {
  const series = sampleCoinSeries();
  return { items: [sampleCoin()], series: [series] };
}

/**
 * A smaller coin with no maximum supply: new coins keep being made, so there
 * is no fully diluted value to say either, and it's far below its high.
 */
export function sampleSmallCoin(): QuotesData {
  const series = sampleCoinSeries({ symbol: 'TIA', end: 4.1234, drift: -0.14 });
  return {
    items: [
      {
        symbol: 'TIA',
        name: 'Celestia',
        currency: 'USD',
        class: 'crypto',
        price: 4.1234,
        change: 0.0812,
        changePercent: 2.01,
        asOf: new Date(SAMPLE_NOW + 64 * 60_000).toISOString(),
        delayed: true,
        dayRange: { low: 3.98, high: 4.31 },
        dayState: 'always',
        crypto: {
          id: 'celestia',
          rank: 62,
          marketCap: 912_345_678,
          volume24h: 81_234_567,
          supply: { circulating: 221_234_567, total: 1_107_654_321, unlimited: true },
          ath: { price: 20.85, date: '2024-02-10T14:34:49.131Z', fromPercent: -80.22 },
          atl: { price: 1.59, date: '2023-10-31T17:24:21.164Z', fromPercent: 159.3 },
          changes: { '1h': -0.4, '24h': 2.01, '7d': 9.8, '30d': -14.2, '1y': -61.9 },
          source: 'CoinGecko',
        },
        source: 'CoinGecko',
      },
    ],
    series: [series],
  };
}

/** Several coins sharing a symbol: the one worth the most, with the others named. */
export function sampleSharedSymbol(): QuotesData {
  const series = sampleCoinSeries({ symbol: 'UNI', end: 9.87, drift: 0.06 });
  const coin = sampleCoin({
    symbol: 'UNI',
    name: 'Uniswap',
    price: 9.87,
    change: -0.15,
    changePercent: -1.5,
    dayRange: { low: 9.61, high: 10.12 },
  });
  return {
    items: [
      {
        ...coin,
        crypto: {
          id: 'uniswap',
          rank: 25,
          marketCap: 5_923_456_789,
          fullyDiluted: 9_870_000_000,
          volume24h: 212_345_678,
          supply: { circulating: 600_483_073, total: 1e9, max: 1e9 },
          ath: { price: 44.92, date: '2021-05-03T05:25:04.822Z', fromPercent: -78.03 },
          changes: { '1h': 0.05, '24h': -1.5, '7d': -3.1, '30d': 6.4, '1y': 22 },
          alternatives: [
            { id: 'unicorn-token', symbol: 'UNI', name: 'Unicorn Token', rank: 3412 },
            { id: 'uni-coin', symbol: 'UNI', name: 'UNI COIN' },
          ],
          source: 'CoinGecko',
        },
      },
    ],
    series: [series],
  };
}

/** CoinGecko was busy, so Stooq's price stands in, and the card says so. */
export function sampleBusyCoin(): QuotesData {
  const series = { ...sampleSeries({ symbol: 'BTC', end: 67_150, wobble: 900 }), currency: 'USD' };
  return {
    items: [
      {
        symbol: 'BTC',
        name: 'Bitcoin',
        currency: 'USD',
        class: 'crypto',
        price: 67_150,
        change: -310,
        changePercent: -0.46,
        asOf: '2026-10-09T21:00:00Z',
        delayed: true,
        dayRange: { low: 66_400, high: 67_700 },
        dayState: 'always',
        notice: 'CoinGecko is busy; prices from Stooq',
        source: 'Stooq',
      },
    ],
    series: [series],
  };
}

/** Crypto as a whole: the total, its day, the dominance and ten coins. */
export function sampleMarket(): CryptoMarketData {
  const rows: [string, string, string, number, number, number][] = [
    ['bitcoin', 'BTC', 'Bitcoin', 67_187, -0.31, 4.2],
    ['ethereum', 'ETH', 'Ethereum', 2_612.4, 1.42, 6.1],
    ['tether', 'USDT', 'Tether', 1.0002, 0.01, 0.02],
    ['binancecoin', 'BNB', 'BNB', 581.2, 0.8, 2.2],
    ['solana', 'SOL', 'Solana', 148.73, 3.12, 11.4],
    ['usd-coin', 'USDC', 'USDC', 0.9999, 0, -0.01],
    ['ripple', 'XRP', 'XRP', 0.5312, -1.12, -2.4],
    ['dogecoin', 'DOGE', 'Dogecoin', 0.1123, 2.41, 8.8],
    ['the-open-network', 'TON', 'Toncoin', 5.21, -0.42, 1.2],
    ['tron', 'TRX', 'TRON', 0.1563, 0.32, 0.9],
  ];
  return {
    currency: 'USD',
    totalMarketCap: 2_412_345_678_901,
    change24h: 1.23,
    volume24h: 81_234_567_890,
    dominance: { btc: 54.62, eth: 13.21 },
    coinsTracked: 17_234,
    coins: rows.map(([id, symbol, name, price, change24h, change7d], i) => ({
      id,
      symbol,
      name,
      rank: i + 1,
      price,
      change24h,
      change7d,
      spark: fine(price, 42, change7d / 100, price * (Math.abs(change7d) < 0.1 ? 0.0004 : 0.01)),
    })),
    asOf: new Date(SAMPLE_NOW + 64 * 60_000).toISOString(),
    source: 'CoinGecko',
  };
}
