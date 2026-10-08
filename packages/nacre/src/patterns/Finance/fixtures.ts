/**
 * Made-up prices and filings, for the stories and the tests. Nothing here is a
 * real figure: the shapes match what Stooq and SEC EDGAR really send, so the
 * card can be read in every state without asking anybody for data.
 */
import type {
  CompanyFigures,
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
