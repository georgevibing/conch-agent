/**
 * Money, for every model (ADR 0060 §7): `quote` for what things cost now,
 * `price_history` for what one of them cost over a stretch of time, and
 * `fundamentals` for how a company is doing out of its own filings. The
 * person sees a card; the model reads a compact summary and answers the
 * question in a sentence or two.
 *
 * Sources, all keyless and named on the card:
 *
 * - **Stooq** (`stooq.com`): one CSV row for the last session, one CSV file of
 *   daily closes. Delayed, and said to be.
 * - **Yahoo Finance's chart endpoint**: a fallback only, for listings and
 *   ranges Stooq doesn't carry. Undocumented, so it may break; when it does,
 *   the card shows what it has (`market.ts`).
 * - **SEC EDGAR**: the ticker list and `companyconcept`, for US filers only.
 *
 * What never happens here: a number that wasn't fetched, a price called live,
 * or a word of advice. The tools' descriptions say so to every model, and the
 * text they return repeats it.
 */
import {
  changeWord,
  FinancePeriod,
  FUNDAMENTALS_MAX,
  PriceSeries,
  QUOTES_MAX,
  SERIES_MAX,
  type CompanyFundamentals,
  type FiledSeries,
  type FundamentalsView,
  type InstrumentClass,
  type MarketState,
  type Quote,
  type QuotesView,
} from '@conch/protocol';
import { z } from 'zod';

import type { ToolContext } from '../conversations/manager';
import type { HostTool } from '../engines/types';
import {
  CONCEPTS,
  EMPLOYEES,
  findFiler,
  readConcept,
  readFilers,
  SHARES,
  seriesOf,
  type ConceptAnswer,
  type ConceptRequest,
  type Filer,
  type FilerIndex,
} from './filings';
import {
  readHistory,
  readQuote,
  stooqSymbol,
  thin,
  type MarketHistory,
  type MarketQuote,
  type StooqSymbol,
} from './market';
import { CARD_NOTE, OutsideError, type OutsideDeps } from './outside';

/** The currency an exchange quotes in, where Stooq's suffix says it plainly. */
const SUFFIX_CURRENCY: Record<string, string> = {
  us: 'USD',
  uk: 'GBP',
  de: 'EUR',
  fr: 'EUR',
  it: 'EUR',
  es: 'EUR',
  nl: 'EUR',
  be: 'EUR',
  pt: 'EUR',
  at: 'EUR',
  ie: 'EUR',
  fi: 'EUR',
  ch: 'CHF',
  jp: 'JPY',
  ca: 'CAD',
  au: 'AUD',
  nz: 'NZD',
  pl: 'PLN',
  se: 'SEK',
  no: 'NOK',
  dk: 'DKK',
  cz: 'CZK',
  hu: 'HUF',
  tr: 'TRY',
  br: 'BRL',
  mx: 'MXN',
  hk: 'HKD',
  sg: 'SGD',
  in: 'INR',
  kr: 'KRW',
  tw: 'TWD',
  cn: 'CNY',
};

/** How long each kind of answer is worth keeping. Prices go stale; filings don't. */
const TTL = {
  quote: 60_000,
  history: 15 * 60_000,
  filers: 24 * 3_600_000,
  concept: 12 * 3_600_000,
};
/** The most answers kept at once, so a long chat can't grow the cache without bound. */
const CACHE_MAX = 400;

/** How many outside requests run at once, so a comparison doesn't flood a service. */
const AT_ONCE = 4;

/** An instrument as Conch found it: what to ask each source, and what to call it. */
export interface Resolved {
  /** What the card shows and the model reads back: `AAPL`, `^SPX`, `BTC-USD`. */
  symbol: string;
  stooq: StooqSymbol;
  name?: string;
  /** Its number with the US regulator, when it files there. */
  filer?: Filer;
  currency?: string;
  class: InstrumentClass;
}

/** Run `work` over `items`, a few at a time. */
async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  return out;
}

/**
 * One reader of market data for the whole gateway: it caches, so a card's
 * range switch, a second question about the same ticker and a comparison that
 * repeats a symbol don't ask a public service again. The promise is cached, so
 * eight chips asking for the same price make one request.
 */
export class FinanceSource {
  readonly #deps: Pick<OutsideDeps, 'fetcher'>;
  readonly #now: () => number;
  readonly #cache = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor(deps: Pick<OutsideDeps, 'fetcher'> & { now?: () => number }) {
    this.#deps = { fetcher: deps.fetcher };
    this.#now = deps.now ?? Date.now;
  }

  /** How many answers are being kept: for the tests that prove the cache works. */
  get cached(): number {
    return this.#cache.size;
  }

  #once<T>(key: string, ttl: number, make: () => Promise<T>): Promise<T> {
    const now = this.#now();
    const held = this.#cache.get(key);
    if (held && now - held.at < ttl) return held.value as Promise<T>;
    const value = make();
    this.#cache.set(key, { at: now, value });
    // A failure is never cached: the next ask tries again.
    value.catch(() => this.#cache.delete(key));
    if (this.#cache.size > CACHE_MAX) {
      const oldest = this.#cache.keys().next();
      if (!oldest.done) this.#cache.delete(oldest.value);
    }
    return value;
  }

  /** The regulator's ticker list, kept for a day. */
  filers(id: string, signal: AbortSignal): Promise<FilerIndex> {
    return this.#once('filers', TTL.filers, () => readFilers(this.#deps, id, signal));
  }

  /**
   * What a person meant: a ticker, an index, a coin, a currency pair, or a
   * company by name (looked up in the regulator's own list).
   */
  async resolve(id: string, query: string, signal: AbortSignal): Promise<Resolved | undefined> {
    const text = query.trim().replace(/^\$/, '').slice(0, 60);
    if (!text) return undefined;
    const index = await this.filers(id, signal).catch(() => undefined);
    const filer = index ? findFiler(index, text) : undefined;
    /**
     * A company the regulator knows by that name wins over reading the words
     * as a ticker: "Apple" is a company, not a ticker called APPLE. A ticker
     * that is already its own (`AAPL`), and anything the regulator doesn't
     * know (`^SPX`, `AIR.PA`, `BTC-USD`), is taken as written.
     */
    const canonical = filer && filer.ticker !== text.toUpperCase() ? filer.ticker : text;
    const found = stooqSymbol(canonical) ?? (filer ? stooqSymbol(filer.ticker) : undefined);
    if (!found) return undefined;
    const suffix = /\.([a-z]{2,3})$/.exec(found.s)?.[1];
    const pairCurrency =
      found.class === 'fx' || found.class === 'crypto'
        ? found.s.slice(-3).toUpperCase()
        : undefined;
    return {
      symbol: canonical.toUpperCase(),
      stooq: found,
      ...(filer && { filer, name: filer.name }),
      ...((pairCurrency ?? (suffix ? SUFFIX_CURRENCY[suffix] : undefined)) && {
        currency: pairCurrency ?? SUFFIX_CURRENCY[suffix ?? ''],
      }),
      class: found.class,
    };
  }

  #rawQuote(id: string, at: Resolved, signal: AbortSignal): Promise<MarketQuote | undefined> {
    return this.#once(`q:${at.stooq.s}`, TTL.quote, () =>
      readQuote(this.#deps, id, at.symbol, at.stooq, signal),
    );
  }

  #rawHistory(
    id: string,
    at: Resolved,
    period: FinancePeriod,
    signal: AbortSignal,
  ): Promise<MarketHistory | undefined> {
    return this.#once(`h:${at.stooq.s}:${period}`, TTL.history, () =>
      readHistory({ ...this.#deps, now: this.#now }, id, at.stooq, period, signal),
    );
  }

  #concept(
    id: string,
    cik: string,
    concept: ConceptRequest,
    signal: AbortSignal,
  ): Promise<ConceptAnswer | undefined> {
    return this.#once(`c:${cik}:${concept.label}`, TTL.concept, () =>
      readConcept(this.#deps, id, cik, concept, signal),
    );
  }

  /** A price, with its spark and (for a US filer) what the company is worth at it. */
  async quote(
    id: string,
    at: Resolved,
    period: FinancePeriod,
    signal: AbortSignal,
    options: { cap?: boolean } = {},
  ): Promise<{ quote: Quote; history?: MarketHistory } | undefined> {
    const [raw, history] = await Promise.all([
      this.#rawQuote(id, at, signal),
      this.#rawHistory(id, at, period, signal).catch(() => undefined),
    ]);
    if (!raw) return undefined;
    const currency = raw.currency ?? at.currency;
    const previous =
      raw.previousClose ??
      // The close before this one, from the history we already have: not a guess.
      (history && history.closes.length >= 2 && history.dates.at(-1) === raw.asOf.slice(0, 10)
        ? history.closes.at(-2)
        : history?.closes.at(-1) !== raw.price
          ? history?.closes.at(-1)
          : undefined);
    const change = previous !== undefined && previous > 0 ? raw.price - previous : undefined;
    const marketCap =
      options.cap && at.filer && currency === 'USD'
        ? await this.#marketCap(id, at.filer, raw.price, signal)
        : undefined;
    const quote: Quote = {
      symbol: at.symbol,
      ...((raw.name ?? at.name) && { name: (raw.name ?? at.name ?? '').slice(0, 140) }),
      ...(raw.exchange && { exchange: raw.exchange }),
      ...(currency && { currency }),
      class: at.class,
      price: raw.price,
      ...(change !== undefined && { change: round(change, 4) }),
      ...(change !== undefined &&
        previous !== undefined && { changePercent: round((change / previous) * 100, 3) }),
      asOf: raw.asOf,
      // No source here promises anything but a delayed price or a close.
      delayed: true,
      ...(raw.low !== undefined &&
        raw.high !== undefined &&
        raw.high >= raw.low && { dayRange: { low: raw.low, high: raw.high } }),
      ...(previous !== undefined && { previousClose: previous }),
      ...(raw.open !== undefined && { open: raw.open }),
      ...(raw.volume !== undefined && { volume: raw.volume }),
      ...(marketCap && { marketCap }),
      dayState: stateOf(raw.asOf, this.#now()),
      ...(history && {
        spark: { period, values: thin(history.closes, 80).map((v) => round(v, 4)) },
      }),
      source: raw.source,
    };
    return { quote, ...(history && { history }) };
  }

  /** What the whole company is worth at this price, from the share count it filed. */
  async #marketCap(
    id: string,
    filer: Filer,
    price: number,
    signal: AbortSignal,
  ): Promise<Quote['marketCap']> {
    const answer = await this.#concept(id, filer.cik, SHARES, signal).catch(() => undefined);
    const figure = seriesOf(SHARES, answer, 'annual', 1)?.points.at(-1);
    if (!figure || figure.value <= 0) return undefined;
    const value = figure.value * price;
    if (!Number.isFinite(value) || value > 1e16) return undefined;
    return {
      value: Math.round(value),
      shares: figure.value,
      ...(figure.filed && { filed: figure.filed }),
      source: 'SEC EDGAR',
    };
  }

  /** Daily closes over a period, as the card charts them. */
  async history(
    id: string,
    at: Resolved,
    period: FinancePeriod,
    signal: AbortSignal,
  ): Promise<PriceSeries | undefined> {
    const history = await this.#rawHistory(id, at, period, signal);
    return history ? seriesFor(at, period, history) : undefined;
  }

  /**
   * How one company is doing, from its filings. A company that doesn't file
   * with the US regulator comes back with `unavailable` saying so, never with
   * figures from somewhere else.
   */
  async fundamentals(
    id: string,
    query: string,
    basis: 'annual' | 'quarterly',
    signal: AbortSignal,
  ): Promise<CompanyFundamentals> {
    const at = await this.resolve(id, query, signal);
    const name = at?.name ?? at?.symbol ?? query.slice(0, 140);
    const symbol = at?.symbol ?? query.trim().slice(0, 24).toUpperCase();
    const bare: CompanyFundamentals = { symbol, name, basis };
    if (!at?.filer)
      return {
        ...bare,
        unavailable:
          at && at.class !== 'stock' && at.class !== 'etf'
            ? `${name} isn’t a company that files accounts: there are no fundamentals for ${at.class === 'index' ? 'an index' : at.class === 'fx' ? 'a currency pair' : `a ${at.class}`}.`
            : `${name} doesn’t file with the US SEC, so there are no figures from filings here. Only US filers (and foreign companies that file a 20-F) do.`,
      };
    const filer = at.filer;
    const answers = await inBatches(CONCEPTS, AT_ONCE, async (concept) => {
      const answer = await this.#concept(id, filer.cik, concept, signal).catch(() => undefined);
      return [concept.label, { answer, series: seriesOf(concept, answer, basis) }] as const;
    });
    const read = new Map(answers);
    const pick = (label: string) => read.get(label)?.series;
    const revenue = pick('Revenue');
    const netIncome = pick('Net income');
    const grossProfit = pick('Gross profit');
    const eps = pick('Earnings per share');
    const dividendPerShare = pick('Dividend per share');
    const [employeesAnswer, priced] = await Promise.all([
      this.#concept(id, filer.cik, EMPLOYEES, signal).catch(() => undefined),
      this.quote(id, at, '1M', signal).catch(() => undefined),
    ]);
    const employees = seriesOf(EMPLOYEES, employeesAnswer, 'annual', 1)?.points.at(-1);
    // Price ÷ the last whole year's earnings per share. Said to be worked out.
    const lastEps = eps?.points.at(-1);
    const price = priced?.quote.price;
    const priceEarnings =
      lastEps && lastEps.value > 0 && price !== undefined && price > 0
        ? {
            value: round(price / lastEps.value, 2),
            price,
            asOf: priced?.quote.asOf ?? '',
            period: lastEps.period,
          }
        : undefined;
    const nothing = !revenue && !netIncome && !eps;
    return {
      ...bare,
      name: answers.find(([, a]) => a.answer?.entityName)?.[1].answer?.entityName ?? name,
      cik: filer.cik,
      // Every us-gaap figure this reads is reported in US dollars.
      ...(!nothing && { currency: 'USD' }),
      ...(revenue && { revenue }),
      ...(grossProfit && { grossProfit }),
      ...(netIncome && { netIncome }),
      ...(eps && { eps }),
      ...(dividendPerShare && { dividendPerShare }),
      ...(employees && { employees }),
      ...(priceEarnings && priceEarnings.asOf && { priceEarnings }),
      ...(nothing && {
        unavailable: `The SEC has no ${basis} XBRL figures filed for ${name}. A newly listed or newly registered company often has none yet.`,
      }),
    };
  }
}

const round = (value: number, places: number) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

/**
 * What can honestly be said about the market from a price's timestamp: a
 * session that ended on an earlier day is closed; anything else is unknown,
 * and the card simply shows when the price is from.
 */
export function stateOf(asOf: string, now: number): MarketState {
  const at = Date.parse(asOf);
  if (!Number.isFinite(at)) return 'unknown';
  const today = new Date(now).toISOString().slice(0, 10);
  return asOf.slice(0, 10) < today && now - at > 12 * 3_600_000 ? 'closed' : 'unknown';
}

/** Daily closes as the protocol's series, thinned to what a card can draw. */
export function seriesFor(
  at: Resolved,
  period: FinancePeriod,
  history: MarketHistory,
): PriceSeries {
  const keep = Math.min(history.dates.length, SERIES_MAX);
  const from = history.dates.length - keep;
  const dates = history.dates.slice(from);
  const closes = history.closes.slice(from).map((v) => round(v, 4));
  const first = dates[0];
  return PriceSeries.parse({
    symbol: at.symbol,
    period,
    dates,
    closes,
    ...((history.currency ?? at.currency) && { currency: history.currency ?? at.currency }),
    source: history.source,
    ...(first && { note: `Daily closes from ${first} to ${dates.at(-1)}.` }),
  });
}

/** The numbers the model reads back, small and flat. Never the card again. */
function quotesText(view: QuotesView, period: FinancePeriod): string {
  return JSON.stringify({
    note: `${CARD_NOTE} Prices here are delayed closes, never live ticks: say so if you mention timing. This is information, not financial advice — don’t suggest buying, selling or holding.`,
    period,
    quotes: view.items.map((q) => ({
      symbol: q.symbol,
      ...(q.name && { name: q.name }),
      price: q.price,
      ...(q.currency && { currency: q.currency }),
      ...(q.change !== undefined && {
        change: q.change,
        changePercent: q.changePercent,
        direction: changeWord(q.change),
      }),
      asOf: q.asOf,
      delayed: q.delayed,
      ...(q.previousClose !== undefined && { previousClose: q.previousClose }),
      ...(q.dayRange && { dayLow: q.dayRange.low, dayHigh: q.dayRange.high }),
      ...(q.volume !== undefined && { volume: q.volume }),
      ...(q.marketCap && { marketCapUsd: q.marketCap.value, fromShares: q.marketCap.shares }),
      source: q.source,
    })),
    ...(view.series?.length && {
      range: view.series.map((s) => ({
        symbol: s.symbol,
        from: s.dates[0],
        to: s.dates.at(-1),
        start: s.closes[0],
        end: s.closes.at(-1),
        changePercent:
          s.closes[0] && s.closes.at(-1)
            ? round((((s.closes.at(-1) ?? 0) - s.closes[0]) / s.closes[0]) * 100, 2)
            : undefined,
        points: s.closes.length,
      })),
    }),
    ...(view.missing?.length && {
      notFound: view.missing,
      ifNotFound:
        'Say plainly that no public source here had a price for it, and ask for the exact ticker (for example AAPL, ^SPX, BTC-USD, AIR.PA). Never make a price up.',
    }),
  });
}

/** The filed figures the model reads back: the latest of each, with its period. */
function fundamentalsText(view: FundamentalsView): string {
  const last = (series: FiledSeries | undefined) => {
    const point = series?.points.at(-1);
    return point && { value: point.value, period: point.period, filed: point.filed };
  };
  return JSON.stringify({
    note: `${CARD_NOTE} Every figure is as filed, with its period and filing date on the card. This is information, not financial advice — don’t suggest buying, selling or holding.`,
    source: view.source,
    companies: view.items.map((c) => ({
      symbol: c.symbol,
      name: c.name,
      basis: c.basis,
      ...(c.currency && { currency: c.currency }),
      ...(c.unavailable && { noFigures: c.unavailable }),
      ...(last(c.revenue) && { revenue: last(c.revenue) }),
      ...(last(c.grossProfit) && { grossProfit: last(c.grossProfit) }),
      ...(last(c.netIncome) && { netIncome: last(c.netIncome) }),
      ...(last(c.eps) && { epsDiluted: last(c.eps) }),
      ...(last(c.dividendPerShare) && { dividendPerShare: last(c.dividendPerShare) }),
      ...(c.employees && { employees: c.employees.value, employeesFiled: c.employees.filed }),
      ...(c.priceEarnings && {
        priceEarnings: c.priceEarnings.value,
        priceEarningsNote: `Worked out from a delayed price of ${c.priceEarnings.price} and ${c.priceEarnings.period} earnings per share.`,
      }),
      periods: c.revenue?.points.map((p) => p.period) ?? [],
    })),
  });
}

const Symbols = z.array(z.string().trim().min(1).max(60));

export interface FinanceToolsDeps {
  source: FinanceSource;
}

/**
 * The three money tools. Each says the same three things to every model: use
 * it whenever a price, a ticker, a company's health or a comparison comes up;
 * the card already shows the numbers, so reply with the judgement; and none of
 * it is financial advice.
 */
export function financeTools(ctx: ToolContext, { source }: FinanceToolsDeps): HostTool[] {
  const id = `finance-${ctx.conversationId}`;

  const quotesView = async (
    queries: string[],
    period: FinancePeriod,
    compare: boolean,
  ): Promise<QuotesView> => {
    const asked = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, QUOTES_MAX);
    const resolved = await inBatches(asked, AT_ONCE, async (query) => ({
      query,
      at: await source.resolve(id, query, ctx.signal).catch(() => undefined),
    }));
    const priced = await inBatches(resolved, AT_ONCE, async ({ query, at }) =>
      at
        ? {
            query,
            at,
            got: await source
              .quote(id, at, period, ctx.signal, { cap: asked.length <= FUNDAMENTALS_MAX })
              .catch(() => undefined),
          }
        : { query, at, got: undefined },
    );
    const items = priced.flatMap((p) => (p.got ? [p.got.quote] : []));
    const missing = priced.flatMap((p) => (p.got ? [] : [p.query.slice(0, 40)]));
    if (!items.length)
      throw new OutsideError(
        `No public source here had a price for ${missing.map((m) => `“${m}”`).join(', ')}. Check the ticker (AAPL, MSFT, ^SPX, BTC-USD, AIR.PA for a Paris listing) and try again, or use web_search. Don’t state a price you didn’t read.`,
      );
    const series = priced.flatMap((p) =>
      p.got?.history && p.at ? [seriesFor(p.at, period, p.got.history)] : [],
    );
    return {
      kind: 'quotes',
      items,
      ...(missing.length && { missing }),
      ...(compare && items.length >= 2 && { compare: true }),
      ...(series.length && { series }),
    };
  };

  return [
    {
      name: 'quote',
      effect: 'read',
      row: true,
      searchHint: 'stock share price ticker quote market index crypto currency exchange rate',
      description:
        'Prices for 1 to 8 instruments, as a card with a chart, the day’s range, the previous close, volume and what the company is worth. Use it whenever the person asks what a share, index, fund, coin or currency is at, mentions a ticker, says a company name and wants its price, or asks how something has moved. Pass tickers or company names: "AAPL", "Apple", "MSFT", "^SPX" (S&P 500), "BTC-USD", "EURUSD", "AIR.PA" (a Paris listing). Set compare when the person is weighing several against each other: the card then overlays them from the range’s start. period sets the chart’s range; the card has its own switch, so 1M is usually right. Prices come from Stooq (Yahoo Finance where Stooq has nothing) and are DELAYED closes, never live ticks — never call them live. The card already shows every number, so reply with the judgement in a sentence or two, never a relisting. Say plainly when a symbol wasn’t found; never state a price you didn’t read. None of this is financial advice: don’t suggest buying, selling or holding.',
      aliases: { symbols: ['symbol', 'tickers', 'ticker', 'query', 'companies', 'q'] },
      input: {
        symbols: z.union([Symbols.min(1).max(QUOTES_MAX), z.string().trim().min(1).max(60)]),
        period: FinancePeriod.default('1M'),
        compare: z.boolean().default(false),
      },
      run: async (raw) => {
        const given = raw.symbols;
        const queries = typeof given === 'string' ? [given] : Symbols.parse(given);
        const period = FinancePeriod.parse(raw.period ?? '1M');
        const view = await quotesView(queries, period, Boolean(raw.compare));
        return { text: quotesText(view, period), view };
      },
    },
    {
      name: 'price_history',
      effect: 'read',
      row: true,
      searchHint: 'price history chart over time performance year to date stock chart',
      description:
        'One instrument’s price over a stretch of time, as a chart the person can scrub: 1W, 1M, 3M, 6M, 1Y, 5Y or MAX. Use it when the person asks how something has done over a period, wants a chart, or asks whether a price is up or down over weeks, months or years. Pass one ticker or company name and a range. The figures are daily closes from Stooq (Yahoo Finance as a fallback), delayed, with the dates they cover. The card shows the chart and the numbers, so reply with what the shape means in a sentence or two, never a list of prices. Not financial advice: no buy, sell or hold.',
      aliases: { symbol: ['ticker', 'query', 'company', 'q'], period: ['range', 'window'] },
      input: {
        symbol: z.string().trim().min(1).max(60),
        period: FinancePeriod.default('1Y'),
      },
      run: async (raw) => {
        const period = FinancePeriod.parse(raw.period ?? '1Y');
        const view = await quotesView([String(raw.symbol)], period, false);
        if (!view.series?.length)
          throw new OutsideError(
            `No public source here had a price history for “${String(raw.symbol).slice(0, 40)}”. The current price is on the card; use web_search for the history, and don’t make figures up.`,
          );
        return { text: quotesText(view, period), view };
      },
    },
    {
      name: 'fundamentals',
      effect: 'read',
      row: true,
      searchHint: 'fundamentals revenue profit earnings margin eps dividend compare companies',
      description:
        'How 1 to 4 companies are doing, from their own filings with the US regulator: revenue, gross profit, net income, earnings per share and dividends per period, with employees and a worked-out price-to-earnings. Use it whenever the person asks how a company is doing, how big it is, whether it is profitable, how fast it is growing, or asks for two to four companies compared. Pass tickers or names ("AAPL", "Apple", "Microsoft"). basis is annual (whole years, from 10-Ks) or quarterly. Every figure carries the period it covers and the day it was filed, from SEC EDGAR. Only US filers have figures here: for a company that files elsewhere the card says so, and you must say so too rather than giving numbers from memory. The card shows the figures and their charts, so reply with the judgement — what the trend means, which company is doing better and why — in a sentence or two, never a relisting. Not financial advice: no buy, sell or hold, and no target prices.',
      aliases: { companies: ['company', 'symbols', 'symbol', 'tickers', 'ticker', 'query', 'q'] },
      input: {
        companies: z.union([
          Symbols.min(1).max(FUNDAMENTALS_MAX),
          z.string().trim().min(1).max(60),
        ]),
        basis: z.enum(['annual', 'quarterly']).default('annual'),
      },
      run: async (raw) => {
        const given = raw.companies;
        const queries = [
          ...new Set(
            (typeof given === 'string' ? [given] : Symbols.parse(given)).map((q) => q.trim()),
          ),
        ]
          .filter(Boolean)
          .slice(0, FUNDAMENTALS_MAX);
        const basis = raw.basis === 'quarterly' ? 'quarterly' : 'annual';
        const items = await inBatches(queries, 2, (query) =>
          source.fundamentals(id, query, basis, ctx.signal),
        );
        if (!items.length) throw new OutsideError('Say which company, by name or ticker.');
        const view: FundamentalsView = { kind: 'fundamentals', items, source: 'SEC EDGAR' };
        return { text: fundamentalsText(view), view };
      },
    },
  ];
}
