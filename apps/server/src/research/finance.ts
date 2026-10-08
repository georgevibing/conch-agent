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
 * - **CoinGecko** for coins (`coingecko.ts`): names, market figures, supply,
 *   highs and lows, history. An aggregator's average, never one exchange's
 *   price; when it's busy, Stooq's price and chart stand in, and the card says so.
 *
 * What never happens here: a number that wasn't fetched, a price called live,
 * or a word of advice. The tools' descriptions say so to every model, and the
 * text they return repeats it.
 */
import {
  changeWord,
  COIN_CURRENCIES,
  CryptoMarketView,
  FinancePeriod,
  FUNDAMENTALS_MAX,
  homeCurrency,
  MARKET_COINS_MAX,
  PriceSeries,
  QUOTES_MAX,
  SERIES_MAX,
  type CoinAlternative,
  type CoinCurrency,
  type CompanyFundamentals,
  type CryptoDetails,
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
  chartDays,
  CoinGecko,
  CoinGeckoBusy,
  coinShaped,
  COIN_HISTORY_DAYS,
  knownById,
  knownCoin,
  pickCoin,
  type CoinChart,
  type CoinMarket,
  type CoinProfile,
  type CoinRef,
} from './coingecko';
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
  /** A coin, as CoinGecko knows it, and the others that share its symbol. */
  coin?: CoinRef & { alternatives?: CoinAlternative[] };
}

/** Currencies a coin can be asked for in, written as a person might: `eur`, `EUR`. */
export function coinCurrency(raw: unknown): CoinCurrency | undefined {
  const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return (COIN_CURRENCIES as readonly string[]).includes(code) ? (code as CoinCurrency) : undefined;
}

/** What the card says when CoinGecko couldn't answer and Stooq stood in. */
const BUSY_NOTICE = 'CoinGecko is busy; prices from Stooq';
const DOWN_NOTICE = 'CoinGecko didn’t answer; prices from Stooq';

/** Significant figures, so a coin at $0.00001234 keeps its digits and a big one loses its noise. */
const sig = (value: number, figures = 8) => Number(value.toPrecision(figures));

/** A move as the protocol bounds it. */
const move = (value: number | undefined) =>
  value === undefined || !Number.isFinite(value) || value < -100 ? undefined : Math.min(value, 1e9);

/**
 * A coin against a currency: `BTC-USD`, `ETH/EUR`, `BTCUSD`, `SOL-USDT`.
 * Without a dash or a slash, only a few currencies, so `AAPL` stays a share.
 */
const COIN_PAIR =
  /^([A-Za-z0-9]{2,10})(?:([-/])(?=(?:USD|EUR|GBP|JPY|CHF|CAD|AUD|USDT)$)|(?=(?:USD|EUR|USDT)$))(USD|EUR|GBP|JPY|CHF|CAD|AUD|USDT)$/i;
/** A base that is itself a currency: `EURUSD` is a currency pair, not a coin. */
const FX =
  /^(?:USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD|SEK|NOK|DKK|PLN|CZK|HUF|TRY|ZAR|MXN|BRL|CNY|HKD|SGD|INR|KRW|ILS|RON)$/i;

/** Stooq's own form for a coin against the dollar or the euro: `btcusd`. */
const stooqCoin = (symbol: string, vs: 'USD' | 'EUR') => {
  const base = symbol.replace(/[-/].*$/, '');
  return {
    s: `${base}${vs}`.toLowerCase(),
    yahoo: `${base.toUpperCase()}-${vs}`,
    class: 'crypto' as const,
  };
};

/** A coin, as the rest of the money tools take an instrument. */
function coinResolved(coin: CoinRef, alternatives: CoinAlternative[], currency?: string): Resolved {
  return {
    symbol: coin.symbol,
    stooq: stooqCoin(coin.symbol, currency === 'EUR' ? 'EUR' : 'USD'),
    name: coin.name,
    ...(currency && coinCurrency(currency) && { currency }),
    class: 'crypto',
    coin: { ...coin, ...(alternatives.length && { alternatives }) },
  };
}

/** What CoinGecko says about a coin, in the protocol's shape: what it didn't send stays out. */
function cryptoDetails(
  market: CoinMarket,
  coin: NonNullable<Resolved['coin']>,
  profile: CoinProfile | undefined,
): CryptoDetails {
  const supply = {
    ...(market.circulating !== undefined && { circulating: market.circulating }),
    ...(market.total !== undefined && { total: market.total }),
    ...(market.max !== undefined && { max: market.max }),
    ...(market.unlimited && { unlimited: true }),
  };
  const changes = Object.fromEntries(
    Object.entries(market.changes).flatMap(([k, v]) => {
      const m = move(v);
      return m === undefined ? [] : [[k, round(m, 2)]];
    }),
  );
  const extreme = (e: NonNullable<CoinMarket['ath']>) => {
    const from = move(e.fromPercent);
    return {
      price: sig(e.price),
      date: e.date,
      ...(from !== undefined && { fromPercent: round(from, 2) }),
    };
  };
  const rank = market.rank ?? coin.rank;
  return {
    id: coin.id,
    ...(rank && { rank }),
    ...(market.marketCap !== undefined && { marketCap: Math.round(market.marketCap) }),
    ...(market.fullyDiluted !== undefined && { fullyDiluted: Math.round(market.fullyDiluted) }),
    ...(market.volume24h !== undefined && { volume24h: Math.round(market.volume24h) }),
    ...(Object.keys(supply).length && { supply }),
    ...(market.ath && { ath: extreme(market.ath) }),
    ...(market.atl && { atl: extreme(market.atl) }),
    ...(Object.keys(changes).length && { changes }),
    ...(coin.alternatives?.length && { alternatives: coin.alternatives }),
    ...(profile?.about && { about: profile.about }),
    ...(profile?.genesis && { genesis: profile.genesis }),
    ...(profile?.algorithm && { algorithm: profile.algorithm }),
    ...(profile?.categories?.length && { categories: profile.categories }),
    source: 'CoinGecko',
  };
}

/** The most points a coin's chart carries to the card: plenty to scrub, little to send. */
const COIN_POINTS = 360;

/** A coin's prices as the protocol's series: the instant of each when they're hours or minutes apart. */
export function coinSeriesFor(
  symbol: string,
  period: FinancePeriod,
  currency: string,
  chart: CoinChart,
): PriceSeries {
  const n = chart.times.length;
  const step = n <= COIN_POINTS ? 1 : (n - 1) / (COIN_POINTS - 1);
  const picks =
    n <= COIN_POINTS
      ? chart.times.map((_, i) => i)
      : Array.from({ length: COIN_POINTS }, (_, i) => Math.round(i * step));
  const times = picks.map((i) => new Date(chart.times[i] ?? 0).toISOString());
  const closes = picks.map((i) => sig(chart.prices[i] ?? 0));
  const days = chartDays(period) ?? COIN_HISTORY_DAYS;
  const fine = days <= 90;
  const first = times[0]?.slice(0, 10);
  const last = times.at(-1)?.slice(0, 10);
  const capped = chartDays(period) === undefined;
  return PriceSeries.parse({
    symbol,
    period,
    dates: times.map((t) => t.slice(0, 10)),
    closes,
    ...(fine && { times }),
    currency,
    source:
      days === 1
        ? 'CoinGecko (every five minutes)'
        : fine
          ? 'CoinGecko (hourly)'
          : 'CoinGecko (daily)',
    ...(first && {
      note: capped
        ? `From ${first} to ${last}: CoinGecko’s free API reaches back one year.`
        : `${fine ? 'Prices' : 'Daily prices'} from ${first} to ${last}, averaged across exchanges.`,
    }),
  });
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

  /** Coins: limited, cached and honest about being busy. */
  readonly coins: CoinGecko;
  readonly #timeZone: string | undefined;

  constructor(
    deps: Pick<OutsideDeps, 'fetcher'> & {
      now?: () => number;
      /** Where this computer is, for the currency a coin is priced in. */
      timeZone?: string;
      /** CoinGecko's calls a minute: the tests make it small. */
      rate?: { calls: number; windowMs: number };
    },
  ) {
    this.#deps = { fetcher: deps.fetcher };
    this.#now = deps.now ?? Date.now;
    this.#timeZone = deps.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.coins = new CoinGecko({
      fetcher: deps.fetcher,
      now: this.#now,
      ...(deps.rate && { rate: deps.rate }),
    });
  }

  /** The currency a coin is priced in: the one asked for, else the one this computer's time zone suggests. */
  currencyFor(asked?: string): CoinCurrency {
    return coinCurrency(asked) ?? homeCurrency(this.#timeZone);
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

    // A coin people name, known on this computer: "bitcoin", "doge", "BTC", "ETH-EUR".
    const pair = COIN_PAIR.exec(text);
    const base = pair?.[1];
    const quoted = pair?.[3]?.toUpperCase();
    const against = quoted === 'USDT' ? 'USD' : quoted;
    const isFx = base ? FX.test(base) : false;
    const known = knownCoin(text) ?? (base && !isFx ? knownCoin(base) : undefined);
    if (known) return coinResolved(known, [], against);
    // A ticker against a currency, with a dash or a slash, is a coin: SOL-USD, PEPE/EUR.
    if (base && pair?.[2] && !isFx) {
      const found = await this.findCoin(id, base, signal).catch(() => undefined);
      if (found) return { ...found, ...(against && { currency: against }) };
    }

    const index = await this.filers(id, signal).catch(() => undefined);
    const filer = index ? findFiler(index, text) : undefined;
    /**
     * Words in lower case that no company is called ("solana", "render") are
     * looked for as a coin's name. A ticker in capitals is a share first; it's
     * looked for as a coin only once no market has a price for it (`quote`).
     */
    if (!filer && /[a-z]/.test(text) && coinShaped(text)) {
      const found = await this.findCoin(id, text, signal).catch(() => undefined);
      if (found) return found;
    }
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

  /**
   * A coin by its name or symbol, from CoinGecko's own search: the one worth
   * the most among those that answer to it exactly, with the others named.
   * Nothing close-but-different is taken for it.
   */
  async findCoin(id: string, query: string, signal: AbortSignal): Promise<Resolved | undefined> {
    const known = knownCoin(query);
    if (known) return coinResolved(known, []);
    if (!coinShaped(query)) return undefined;
    const hits = await this.coins.search(id, query, signal);
    const picked = pickCoin(hits, query);
    return picked && coinResolved(picked.coin, picked.alternatives);
  }

  /** A coin the card already named by its id (the range switch). */
  coinById(coin: string, symbol: string): Resolved {
    return coinResolved(
      knownById(coin) ?? { id: coin, symbol: symbol.toUpperCase(), name: symbol },
      [],
    );
  }

  /** One call for the market figures of every coin a card holds. */
  async warmCoins(id: string, ats: readonly Resolved[], currency: string, signal: AbortSignal) {
    const groups = new Map<string, string[]>();
    for (const at of ats) {
      if (!at.coin) continue;
      const vs = at.currency ?? currency;
      groups.set(vs, [...(groups.get(vs) ?? []), at.coin.id]);
    }
    await Promise.all(
      [...groups].map(([vs, ids]) =>
        this.coins.markets(id, ids, vs, signal).catch(() => undefined),
      ),
    );
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
    options: { cap?: boolean; currency?: string; profile?: boolean } = {},
  ): Promise<{ quote: Quote; series?: PriceSeries } | undefined> {
    if (at.coin) return this.#coinQuote(id, at, at.coin, period, signal, options);
    const got = await this.#stooqQuote(id, at, period, signal, options);
    return (
      got && {
        quote: got.quote,
        ...(got.history && { series: seriesFor(at, period, got.history) }),
      }
    );
  }

  /**
   * A coin's price from CoinGecko, with everything it knows beside it. When
   * CoinGecko is busy or doesn't answer, Stooq's price and closes stand in,
   * and the card says so; a coin CoinGecko doesn't list is Stooq's alone.
   */
  async #coinQuote(
    id: string,
    at: Resolved,
    coin: NonNullable<Resolved['coin']>,
    period: FinancePeriod,
    signal: AbortSignal,
    options: { currency?: string; profile?: boolean },
  ): Promise<{ quote: Quote; series?: PriceSeries } | undefined> {
    const currency = at.currency ?? this.currencyFor(options.currency);
    let market: CoinMarket | undefined;
    let notice: string | undefined;
    try {
      market = (await this.coins.markets(id, [coin.id], currency, signal)).get(coin.id);
    } catch (error) {
      signal.throwIfAborted();
      notice = error instanceof CoinGeckoBusy ? BUSY_NOTICE : DOWN_NOTICE;
    }
    if (!market) {
      // Stooq quotes coins against the dollar or the euro only.
      const vs = currency === 'EUR' ? 'EUR' : 'USD';
      const fallback: Resolved = {
        ...at,
        stooq: stooqCoin(coin.symbol, vs),
        currency: vs,
        coin: undefined,
      };
      const got = await this.#stooqQuote(id, fallback, period, signal, {});
      if (!got) return undefined;
      return {
        quote: {
          ...got.quote,
          // Stooq names a coin in capitals ("BITCOIN"); CoinGecko's name reads better.
          name: coin.name,
          ...(notice && { notice: vs === currency ? notice : `${notice}, in ${vs}` }),
        },
        ...(got.history && { series: seriesFor(fallback, period, got.history) }),
      };
    }
    const [series, profile] = await Promise.all([
      this.coinSeries(id, at, coin.id, currency, period, signal).catch(() => undefined),
      options.profile
        ? this.coins.profile(id, coin.id, signal).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
    const quote: Quote = {
      symbol: at.symbol,
      name: market.name,
      currency,
      class: 'crypto',
      price: sig(market.price),
      ...(market.change24h !== undefined && { change: sig(market.change24h, 6) }),
      ...(move(market.changePercent24h ?? market.changes['24h']) !== undefined && {
        changePercent: round(
          Math.min(move(market.changePercent24h ?? market.changes['24h']) ?? 0, 100_000),
          3,
        ),
      }),
      asOf: market.asOf,
      // An aggregator's figure, refreshed every minute or so: never a live tick.
      delayed: true,
      ...(market.low24h !== undefined &&
        market.high24h !== undefined && {
          dayRange: { low: sig(market.low24h), high: sig(market.high24h) },
        }),
      dayState: 'always',
      ...(market.spark && {
        spark: { period: '1W' as const, values: thin(market.spark, 80).map((v) => sig(v, 6)) },
      }),
      crypto: cryptoDetails(market, coin, profile),
      source: 'CoinGecko',
    };
    return { quote, ...(series && { series }) };
  }

  /**
   * A coin's prices over a range. CoinGecko for the year it keeps without a
   * key (minutes apart for a day, hourly to three months, daily past that);
   * Stooq's daily closes for five years and more, or whenever CoinGecko is busy.
   */
  async coinSeries(
    id: string,
    at: Resolved,
    coin: string,
    currency: string,
    period: FinancePeriod,
    signal: AbortSignal,
  ): Promise<PriceSeries | undefined> {
    const fromStooq = async () => {
      const vs = currency === 'EUR' ? 'EUR' : 'USD';
      const daily: Resolved = { ...at, stooq: stooqCoin(at.symbol, vs), currency: vs };
      const history = await this.#rawHistory(id, daily, period, signal).catch(() => undefined);
      return history && seriesFor(daily, period, history);
    };
    if (chartDays(period) === undefined) {
      const long = await fromStooq();
      if (long) return long;
    }
    let chart: CoinChart | undefined;
    try {
      chart = await this.coins.chart(id, coin, currency, period, signal);
    } catch {
      signal.throwIfAborted();
      // A day of five-minute prices has no daily stand-in worth drawing.
      return period === '1D' ? undefined : fromStooq();
    }
    return chart && coinSeriesFor(at.symbol, period, currency, chart);
  }

  async #stooqQuote(
    id: string,
    at: Resolved,
    period: FinancePeriod,
    signal: AbortSignal,
    options: { cap?: boolean },
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
      // A coin never closes; anything else is closed only when a session provably ended.
      dayState: at.class === 'crypto' ? 'always' : stateOf(raw.asOf, this.#now()),
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
    currency?: string,
  ): Promise<PriceSeries | undefined> {
    if (at.coin)
      return this.coinSeries(
        id,
        at,
        at.coin.id,
        at.currency ?? this.currencyFor(currency),
        period,
        signal,
      );
    const history = await this.#rawHistory(id, at, period, signal);
    return history ? seriesFor(at, period, history) : undefined;
  }

  /**
   * Crypto as a whole: CoinGecko's total, its day's move, bitcoin's and
   * ether's share of it, and the biggest coins. There's no stand-in for this
   * one: busy with nothing kept is a plain sentence, never figures from elsewhere.
   */
  async market(id: string, currency: string, signal: AbortSignal): Promise<CryptoMarketView> {
    let busy = false;
    const [global, top] = await Promise.all([
      this.coins.global(id, currency, signal).catch((error: unknown) => {
        busy = error instanceof CoinGeckoBusy;
        return undefined;
      }),
      this.coins.top(id, currency, MARKET_COINS_MAX, signal).catch(() => undefined),
    ]);
    signal.throwIfAborted();
    if (busy)
      throw new OutsideError(
        'CoinGecko is busy right now (it allows only so many requests a minute). Say so and offer to look again in a minute; don’t give market figures from memory.',
      );
    if (!global)
      throw new OutsideError(
        'CoinGecko didn’t answer for the crypto market. Try again in a moment, or use web_search; don’t give market figures from memory.',
      );
    const coins = top ?? [];
    return CryptoMarketView.parse({
      kind: 'crypto-market',
      currency,
      totalMarketCap: Math.round(global.totalMarketCap),
      ...(global.change24h !== undefined && { change24h: round(global.change24h, 2) }),
      ...(global.volume24h !== undefined && { volume24h: Math.round(global.volume24h) }),
      ...(global.btc !== undefined && {
        dominance: {
          btc: round(global.btc, 2),
          ...(global.eth !== undefined && { eth: round(global.eth, 2) }),
        },
      }),
      ...(global.coinsTracked !== undefined && { coinsTracked: global.coinsTracked }),
      coins: coins.slice(0, MARKET_COINS_MAX).map((c) => ({
        id: c.id,
        symbol: c.symbol,
        name: c.name,
        ...(c.rank && { rank: c.rank }),
        price: sig(c.price),
        ...(move(c.changes['24h']) !== undefined && {
          change24h: round(move(c.changes['24h']) ?? 0, 2),
        }),
        ...(move(c.changes['7d']) !== undefined && {
          change7d: round(move(c.changes['7d']) ?? 0, 2),
        }),
        ...(c.marketCap !== undefined && { marketCap: Math.round(c.marketCap) }),
        ...(c.spark && { spark: thin(c.spark, 56).map((v) => sig(v, 6)) }),
      })),
      asOf: global.asOf,
      source: 'CoinGecko',
      ...(!coins.length && {
        notice: 'CoinGecko is busy; the biggest coins will be back in a minute',
      }),
    });
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
            ? at.class === 'crypto'
              ? `${name} is a coin: it files no accounts, so there are no figures from filings. Its supply, market value and all-time high are on its price card (the quote tool).`
              : `${name} isn’t a company that files accounts: there are no fundamentals for ${at.class === 'index' ? 'an index' : at.class === 'fx' ? 'a currency pair' : `a ${at.class}`}.`
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
      this.#stooqQuote(id, at, '1M', signal, {}).catch(() => undefined),
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
  const coins = view.items.filter((q) => q.class === 'crypto');
  const shared = coins.filter((q) => q.crypto?.alternatives?.length);
  return JSON.stringify({
    note: `${CARD_NOTE} Prices here are delayed closes, never live ticks: say so if you mention timing. This is information, not financial advice — don’t suggest buying, selling or holding.`,
    ...(coins.length && {
      coinNote:
        'A coin’s price from CoinGecko is an aggregator’s average across many exchanges, refreshed about every minute: not the price on any one exchange, and not live. Coins trade 24/7, so there is no close. Say so if it matters.',
    }),
    ...(shared.length && {
      sharedSymbol: `Several coins answer to ${shared.map((q) => q.symbol).join(', ')}. The card shows the one worth the most; the others are listed under alternatives. If the person might have meant another, name it and ask.`,
    }),
    period,
    quotes: view.items.map((q) => ({
      ...(q.crypto && {
        coin: {
          id: q.crypto.id,
          ...(q.crypto.rank && { rank: q.crypto.rank }),
          ...(q.crypto.marketCap !== undefined && { marketCap: q.crypto.marketCap }),
          ...(q.crypto.fullyDiluted !== undefined && { fullyDiluted: q.crypto.fullyDiluted }),
          ...(q.crypto.volume24h !== undefined && { volume24h: q.crypto.volume24h }),
          ...(q.crypto.supply && {
            supply: {
              ...q.crypto.supply,
              ...(q.crypto.supply.unlimited && { max: 'no maximum: new coins keep being made' }),
            },
          }),
          ...(q.crypto.ath && { allTimeHigh: q.crypto.ath }),
          ...(q.crypto.atl && { allTimeLow: q.crypto.atl }),
          ...(q.crypto.changes && { changePercent: q.crypto.changes }),
          ...(q.crypto.alternatives?.length && { alternatives: q.crypto.alternatives }),
          ...(q.crypto.genesis && { genesis: q.crypto.genesis }),
          ...(q.crypto.algorithm && { algorithm: q.crypto.algorithm }),
        },
      }),
      ...(q.notice && { notice: q.notice }),
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
        'Say plainly that no public source here had a price for it, and ask for the exact ticker (for example AAPL, ^SPX, AIR.PA) or, for a coin, its name or SYMBOL-USD (bitcoin, SOL-USD). Never make a price up.',
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
    options: { currency?: string; profile?: boolean } = {},
  ): Promise<QuotesView> => {
    const asked = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, QUOTES_MAX);
    const currency = source.currencyFor(options.currency);
    const resolved = await inBatches(asked, AT_ONCE, async (query) => ({
      query,
      at: await source.resolve(id, query, ctx.signal).catch(() => undefined),
    }));
    // Every coin on the card in one call to CoinGecko, not one each.
    await source.warmCoins(
      id,
      resolved.flatMap((r) => (r.at ? [r.at] : [])),
      currency,
      ctx.signal,
    );
    const quoteOf = (at: Resolved) =>
      source
        .quote(id, at, period, ctx.signal, {
          cap: asked.length <= FUNDAMENTALS_MAX,
          currency,
          // One coin alone gets its profile too: what it is, its first day, its algorithm.
          profile: options.profile ?? asked.length === 1,
        })
        .catch(() => undefined);
    const priced = await inBatches(resolved, AT_ONCE, async ({ query, at }) => {
      const got = at ? await quoteOf(at) : undefined;
      if (got || !at || at.class !== 'stock' || at.filer || !coinShaped(query))
        return { query, at, got };
      // No market has a share by that ticker: it may be a coin's (PEPE, RNDR).
      const coin = await source.findCoin(id, query, ctx.signal).catch(() => undefined);
      return { query, at: coin ?? at, got: coin ? await quoteOf(coin) : undefined };
    });
    const items = priced.flatMap((p) => (p.got ? [p.got.quote] : []));
    const missing = priced.flatMap((p) => (p.got ? [] : [p.query.slice(0, 40)]));
    if (!items.length)
      throw new OutsideError(
        `No public source here had a price for ${missing.map((m) => `“${m}”`).join(', ')}. Check the ticker (AAPL, MSFT, ^SPX, AIR.PA for a Paris listing), or for a coin its name or SYMBOL-USD (bitcoin, SOL-USD), and try again, or use web_search. Don’t state a price you didn’t read.`,
      );
    const series = priced.flatMap((p) => (p.got?.series ? [p.got.series] : []));
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
        'Prices for 1 to 8 instruments, as a card with a chart, the day’s range, the previous close, volume and what the company is worth. Use it whenever the person asks what a share, index, fund, coin or currency is at, mentions a ticker, says a company or coin name and wants its price, or asks how something has moved. Pass tickers or names: "AAPL", "Apple", "MSFT", "^SPX" (S&P 500), "EURUSD", "AIR.PA" (a Paris listing); for a coin its name or symbol ("bitcoin", "solana", "doge", "BTC", "SOL-USD"). Set compare when the person is weighing several against each other: the card then overlays them from the range’s start. period sets the chart’s range; the card has its own switch, so 1M is usually right (1D for a coin’s day). currency (USD, EUR, GBP, JPY, CHF, CAD, AUD) is for coins only, when the person asks for one; otherwise the card uses the person’s own. Share prices come from Stooq (Yahoo Finance where Stooq has nothing) and are DELAYED closes, never live ticks — never call them live. A coin’s price, supply, rank and all-time high come from CoinGecko, an aggregator: its price is an average across exchanges, refreshed about every minute, not one exchange’s price — say so if it matters. Several coins can share a symbol: the card shows the one worth the most and the text lists the others. The card already shows every number, so reply with the judgement in a sentence or two, never a relisting. Say plainly when a symbol wasn’t found; never state a price you didn’t read. None of this is financial advice: don’t suggest buying, selling or holding.',
      aliases: {
        symbols: ['symbol', 'tickers', 'ticker', 'query', 'companies', 'coins', 'coin', 'q'],
        currency: ['vs', 'vs_currency', 'in'],
      },
      input: {
        symbols: z.union([Symbols.min(1).max(QUOTES_MAX), z.string().trim().min(1).max(60)]),
        period: FinancePeriod.default('1M'),
        compare: z.boolean().default(false),
        currency: z.string().trim().max(8).optional(),
      },
      run: async (raw) => {
        const given = raw.symbols;
        const queries = typeof given === 'string' ? [given] : Symbols.parse(given);
        const period = FinancePeriod.parse(raw.period ?? '1M');
        const view = await quotesView(queries, period, Boolean(raw.compare), {
          ...(typeof raw.currency === 'string' && { currency: raw.currency }),
        });
        return { text: quotesText(view, period), view };
      },
    },
    {
      name: 'price_history',
      effect: 'read',
      row: true,
      searchHint: 'price history chart over time performance year to date stock chart',
      description:
        'One instrument’s price over a stretch of time, as a chart the person can scrub: 1D (coins only), 1W, 1M, 3M, 6M, 1Y, 5Y or MAX. Use it when the person asks how something has done over a period, wants a chart, or asks whether a price is up or down over hours, weeks, months or years. Pass one ticker, company or coin name and a range. A share’s figures are daily closes from Stooq (Yahoo Finance as a fallback), delayed, with the dates they cover. A coin’s come from CoinGecko, averaged across exchanges: every five minutes for 1D, hourly to 3M, daily to a year; past a year (5Y, MAX) they’re Stooq’s daily closes where it has the coin. The card shows the chart and the numbers, so reply with what the shape means in a sentence or two, never a list of prices. Not financial advice: no buy, sell or hold.',
      aliases: {
        symbol: ['ticker', 'query', 'company', 'coin', 'q'],
        period: ['range', 'window'],
        currency: ['vs', 'vs_currency', 'in'],
      },
      input: {
        symbol: z.string().trim().min(1).max(60),
        period: FinancePeriod.default('1Y'),
        currency: z.string().trim().max(8).optional(),
      },
      run: async (raw) => {
        const period = FinancePeriod.parse(raw.period ?? '1Y');
        const view = await quotesView([String(raw.symbol)], period, false, {
          ...(typeof raw.currency === 'string' && { currency: raw.currency }),
        });
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
        if (!queries.length) throw new OutsideError('Say which company, by name or ticker.');
        // Coins file no accounts. Asked about only coins, the answer is each coin's own
        // card: what it is, its supply, its value and its highs, over a year.
        const kinds = await inBatches(queries, AT_ONCE, (query) =>
          source.resolve(id, query, ctx.signal).catch(() => undefined),
        );
        if (kinds.every((at) => at?.class === 'crypto')) {
          const view = await quotesView(queries, '1Y', false, { profile: true });
          return {
            text: JSON.stringify({
              ...(JSON.parse(quotesText(view, '1Y')) as Record<string, unknown>),
              noFilings:
                'Coins file no accounts, so there are no revenue or profit figures: this is the coin’s market card from CoinGecko (supply, market value, all-time high, what it is). Say so if the person asked for fundamentals.',
            }),
            view,
          };
        }
        const items = await inBatches(queries, 2, (query) =>
          source.fundamentals(id, query, basis, ctx.signal),
        );
        const view: FundamentalsView = { kind: 'fundamentals', items, source: 'SEC EDGAR' };
        return { text: fundamentalsText(view), view };
      },
    },
    {
      name: 'crypto_market',
      effect: 'read',
      row: true,
      searchHint: 'crypto market overview total market cap bitcoin dominance top coins',
      description:
        'How crypto as a whole is doing, as a card: what every coin CoinGecko tracks is worth together and its move over 24 hours, how much of it is bitcoin and ether (dominance), and the ten biggest coins with their week. Use it only when the person asks about the crypto market as a whole ("how’s crypto doing?", "is crypto up today?", "bitcoin dominance", "the top coins"); for one or a few coins, use quote instead. currency (USD, EUR, GBP, JPY, CHF, CAD, AUD) only when they ask for one. From CoinGecko, an aggregator: averages across exchanges, refreshed about every minute, not live and not any one exchange’s prices. The card shows every number, so reply with the gist in a sentence or two, never a relisting. Not financial advice: no buy, sell or hold, and no predictions.',
      aliases: { currency: ['vs', 'vs_currency', 'in'] },
      input: { currency: z.string().trim().max(8).optional() },
      run: async (raw) => {
        const currency = source.currencyFor(
          typeof raw.currency === 'string' ? raw.currency : undefined,
        );
        const view = await source.market(id, currency, ctx.signal);
        return { text: marketText(view), view };
      },
    },
  ];
}

/** Crypto as a whole, as the model reads it: the gist, small and flat. */
function marketText(view: CryptoMarketView): string {
  return JSON.stringify({
    note: `${CARD_NOTE} These are CoinGecko’s figures: averages across many exchanges, refreshed about every minute, not live and not any one exchange’s prices. This is information, not financial advice — don’t suggest buying, selling or holding, and don’t predict.`,
    market: {
      currency: view.currency,
      totalMarketCap: view.totalMarketCap,
      ...(view.change24h !== undefined && {
        change24h: view.change24h,
        direction: changeWord(view.change24h),
      }),
      ...(view.volume24h !== undefined && { volume24h: view.volume24h }),
      ...(view.dominance && {
        bitcoinDominance: view.dominance.btc,
        ...(view.dominance.eth !== undefined && { etherDominance: view.dominance.eth }),
      }),
      ...(view.coinsTracked !== undefined && { coinsTracked: view.coinsTracked }),
      asOf: view.asOf,
    },
    ...(view.notice && { notice: view.notice }),
    top: view.coins.map((c) => ({
      ...(c.rank && { rank: c.rank }),
      symbol: c.symbol,
      name: c.name,
      price: c.price,
      ...(c.change24h !== undefined && { change24h: c.change24h }),
      ...(c.change7d !== undefined && { change7d: c.change7d }),
    })),
  });
}
