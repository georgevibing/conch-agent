/**
 * Coins, for every model: **CoinGecko's public API** (`api.coingecko.com/api/v3`),
 * keyless. What a coin is called, what it costs, how much of it there is, its
 * highs and lows, its history, and how crypto as a whole is doing.
 *
 * CoinGecko is an **aggregator**: its price is an average across the exchanges
 * it reads, not the price on any one of them. Every card and every tool text
 * says so.
 *
 * Only a coin's id or symbol and a currency leave this computer, through the
 * same SSRF-guarded public fetcher as `web_fetch`, with a User-Agent naming
 * Conch. A name is sent to `/search` only when it already looks like a coin's
 * name (a few short words), so nothing a chat read can ride along in it.
 *
 * Keyless means about thirty calls a minute. This file keeps well under that:
 *
 * - **A limiter** in this process (`RATE`), so a busy chat can't trip it.
 * - **A cache** per kind of answer (`TTL`): markets a minute, a coin's profile ten,
 *   history five to fifteen by range, names a day.
 * - **Busy** when CoinGecko says 429, or the limiter is spent: no call is made
 *   until it has rested, what was already read is kept and served (its own time
 *   on it), and the caller falls back to Stooq for the price and the chart.
 */
import type { CoinAlternative, FinancePeriod } from '@conch/protocol';

import { getOutside, numOf, rec, strOf, type OutsideDeps } from './outside';

const API = 'https://api.coingecko.com/api/v3';

/** How long each kind of answer is worth keeping. */
export const COIN_TTL = {
  markets: 60_000,
  coin: 10 * 60_000,
  search: 24 * 3_600_000,
  global: 60_000,
  /** A day's chart goes stale fastest; a year's hardly moves. */
  chart: (period: FinancePeriod) =>
    period === '1D' ? 5 * 60_000 : period === '1W' ? 10 * 60_000 : 15 * 60_000,
};

/** What is served while CoinGecko is busy, at most this old. */
const STALE_MAX = 6 * 3_600_000;
/** The most answers kept at once. */
const CACHE_MAX = 300;

/**
 * Calls a minute, below the keyless limit of about thirty: other programs on
 * this computer (or this computer's network) may be asking too.
 */
export const RATE = { calls: 24, windowMs: 60_000 };
/** How long to rest after a 429 that didn't say. */
const REST_MS = 60_000;

/** The keyless API reaches back only a year; past that, Stooq's daily closes. */
export const COIN_HISTORY_DAYS = 365;

/** CoinGecko is busy: nothing was asked, and nothing older was kept. */
export class CoinGeckoBusy extends Error {
  constructor() {
    super('CoinGecko is busy right now (it allows only so many requests a minute).');
  }
}

/** A coin as Conch names it. */
export interface CoinRef {
  id: string;
  /** Upper case, as people write it: `BTC`. */
  symbol: string;
  name: string;
  rank?: number;
}

/** A coin's market figures, from `/coins/markets`. Fields nobody sent are absent. */
export interface CoinMarket {
  id: string;
  symbol: string;
  name: string;
  price: number;
  rank?: number;
  marketCap?: number;
  fullyDiluted?: number;
  volume24h?: number;
  high24h?: number;
  low24h?: number;
  change24h?: number;
  changePercent24h?: number;
  circulating?: number;
  total?: number;
  max?: number;
  /** The source sent `max_supply: null`: there is no maximum. */
  unlimited?: boolean;
  ath?: { price: number; date: string; fromPercent?: number };
  atl?: { price: number; date: string; fromPercent?: number };
  changes: Partial<Record<'1h' | '24h' | '7d' | '30d' | '1y', number>>;
  /** The last week, hourly. */
  spark?: number[];
  asOf: string;
}

/** What a coin is, from `/coins/{id}`. */
export interface CoinProfile {
  id: string;
  about?: string;
  genesis?: string;
  algorithm?: string;
  categories?: string[];
}

/** A price over time, from `/coins/{id}/market_chart`. */
export interface CoinChart {
  /** Instants in ms and prices, oldest first. */
  times: number[];
  prices: number[];
}

/** Crypto as a whole, from `/global`. */
export interface CoinGlobal {
  totalMarketCap: number;
  volume24h?: number;
  change24h?: number;
  btc?: number;
  eth?: number;
  coinsTracked?: number;
  asOf: string;
}

/**
 * Coins people name by name or by ticker, known on this computer, so asking
 * for "bitcoin" or "doge" sends nothing to `/search`. Tickers here are only
 * those that already meant a coin (`market.ts` `CRYPTO`); any other ticker is
 * a share first, and a coin only if no market has it as one.
 */
const KNOWN: readonly (CoinRef & { names: string[] })[] = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', names: ['bitcoin', 'btc', 'xbt'] },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', names: ['ethereum', 'ether', 'eth'] },
  { id: 'solana', symbol: 'SOL', name: 'Solana', names: ['solana', 'sol'] },
  { id: 'ripple', symbol: 'XRP', name: 'XRP', names: ['xrp', 'ripple'] },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano', names: ['cardano', 'ada'] },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', names: ['dogecoin', 'doge'] },
  { id: 'litecoin', symbol: 'LTC', name: 'Litecoin', names: ['litecoin', 'ltc'] },
  { id: 'bitcoin-cash', symbol: 'BCH', name: 'Bitcoin Cash', names: ['bitcoin cash', 'bch'] },
  { id: 'polkadot', symbol: 'DOT', name: 'Polkadot', names: ['polkadot', 'dot'] },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', names: ['avalanche', 'avax'] },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink', names: ['chainlink', 'link'] },
  { id: 'monero', symbol: 'XMR', name: 'Monero', names: ['monero', 'xmr'] },
  { id: 'tron', symbol: 'TRX', name: 'TRON', names: ['tron', 'trx'] },
  {
    id: 'ethereum-classic',
    symbol: 'ETC',
    name: 'Ethereum Classic',
    names: ['ethereum classic', 'etc'],
  },
  { id: 'tether', symbol: 'USDT', name: 'Tether', names: ['tether'] },
  { id: 'usd-coin', symbol: 'USDC', name: 'USDC', names: ['usd coin', 'usdc coin'] },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB', names: ['binance coin'] },
  { id: 'shiba-inu', symbol: 'SHIB', name: 'Shiba Inu', names: ['shiba inu', 'shiba'] },
  { id: 'stellar', symbol: 'XLM', name: 'Stellar', names: ['stellar', 'stellar lumens'] },
  { id: 'the-open-network', symbol: 'TON', name: 'Toncoin', names: ['toncoin'] },
  { id: 'uniswap', symbol: 'UNI', name: 'Uniswap', names: ['uniswap'] },
];
const BY_NAME = new Map(KNOWN.flatMap((coin) => coin.names.map((n) => [n, coin] as const)));
const BY_ID = new Map(KNOWN.map((coin) => [coin.id, coin] as const));

/** A coin named in words or by one of the tickers that already meant a coin. */
export function knownCoin(text: string): CoinRef | undefined {
  const found = BY_NAME.get(text.trim().toLowerCase().replace(/\s+/g, ' '));
  return found && { id: found.id, symbol: found.symbol, name: found.name };
}

/**
 * Whether words could be a coin's name or symbol, and so may be sent to
 * `/search`: letters, digits, a space, dot or hyphen; at most three words and
 * thirty-two characters. Anything longer stays on this computer (ADR 0028).
 */
export function coinShaped(text: string): boolean {
  const t = text.trim();
  return /^[A-Za-z0-9][A-Za-z0-9 .-]{0,31}$/.test(t) && t.split(/\s+/).length <= 3;
}

/** A symbol as the card writes it, or nothing when it can't be one. */
const symbolOf = (raw: unknown): string | undefined => {
  const s = strOf(raw)?.toUpperCase();
  return s && /^[A-Z0-9.-]{1,24}$/.test(s) ? s : undefined;
};

/** A coin id as CoinGecko writes it, checked. */
export const coinIdOf = (raw: unknown): string | undefined => {
  const s = strOf(raw);
  return s && /^[a-z0-9][a-z0-9-]{0,79}$/.test(s) ? s : undefined;
};

/** A rank, if it's a real one. */
const rankOf = (raw: unknown): number | undefined => {
  const n = numOf(raw);
  return n !== undefined && Number.isInteger(n) && n > 0 && n <= 1e6 ? n : undefined;
};

/** An amount that can't be negative: a negative one is a broken parse, so it's dropped. */
const amount = (raw: unknown): number | undefined => {
  const n = numOf(raw);
  return n !== undefined && n >= 0 && n <= 1e18 ? n : undefined;
};

/** `/search`'s coins, in its order (it ranks by market value), read defensively. */
export function parseSearch(body: unknown): CoinRef[] {
  const coins = rec(body).coins;
  if (!Array.isArray(coins)) return [];
  return coins.flatMap((raw) => {
    const coin = rec(raw);
    const id = coinIdOf(coin.id);
    const symbol = symbolOf(coin.symbol);
    const name = strOf(coin.name)?.slice(0, 140);
    if (!id || !symbol || !name) return [];
    const rank = rankOf(coin.market_cap_rank);
    return [{ id, symbol, name, ...(rank && { rank }) }];
  });
}

/**
 * The coin someone meant, from `/search`'s answer: one whose symbol, id or
 * name is exactly what they wrote. Several coins often share a symbol, so the
 * one worth the most (the best rank) is chosen and the others are kept, so the
 * person can be told. Nothing close-but-different is ever taken for it.
 */
export function pickCoin(
  hits: readonly CoinRef[],
  query: string,
): { coin: CoinRef; alternatives: CoinAlternative[] } | undefined {
  const want = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!want) return undefined;
  const byRank = (a: CoinRef, b: CoinRef) => (a.rank ?? 1e9) - (b.rank ?? 1e9);
  const exact = hits.filter((h) => h.symbol.toLowerCase() === want).sort(byRank);
  const named = hits.filter((h) => h.id === want || h.name.toLowerCase() === want).sort(byRank);
  // A name wins over a symbol ("uniswap" is Uniswap), else the best-ranked symbol.
  const coin = named[0] ?? exact[0];
  if (!coin) return undefined;
  const alternatives = exact
    .filter((h) => h.id !== coin.id)
    .slice(0, 4)
    .map(({ id, symbol, name, rank }) => ({ id, symbol, name, ...(rank && { rank }) }));
  return { coin, alternatives };
}

/** The ISO instant of a date the source wrote, or nothing. */
const instantOf = (raw: unknown): string | undefined => {
  const s = strOf(raw);
  if (!s) return undefined;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
};

/** `/coins/markets`, one coin per row. A row without a price is no row. */
export function parseMarkets(body: unknown): CoinMarket[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((raw) => {
    const row = rec(raw);
    const id = coinIdOf(row.id);
    const symbol = symbolOf(row.symbol);
    const name = strOf(row.name)?.slice(0, 140);
    const price = amount(row.current_price);
    if (!id || !symbol || !name || price === undefined || price <= 0) return [];
    const extreme = (p: unknown, d: unknown, f: unknown) => {
      const at = amount(p);
      const date = instantOf(d);
      const from = numOf(f);
      return at !== undefined && at > 0 && date
        ? { price: at, date, ...(from !== undefined && from >= -100 && { fromPercent: from }) }
        : undefined;
    };
    const ath = extreme(row.ath, row.ath_date, row.ath_change_percentage);
    const atl = extreme(row.atl, row.atl_date, row.atl_change_percentage);
    const changes: CoinMarket['changes'] = {};
    for (const [key, field] of [
      ['1h', 'price_change_percentage_1h_in_currency'],
      ['24h', 'price_change_percentage_24h_in_currency'],
      ['7d', 'price_change_percentage_7d_in_currency'],
      ['30d', 'price_change_percentage_30d_in_currency'],
      ['1y', 'price_change_percentage_1y_in_currency'],
    ] as const) {
      const value = numOf(row[field]);
      if (value !== undefined && value >= -100) changes[key] = value;
    }
    const percent24h = numOf(row.price_change_percentage_24h);
    if (changes['24h'] === undefined && percent24h !== undefined && percent24h >= -100)
      changes['24h'] = percent24h;
    const sparkRaw = rec(row.sparkline_in_7d).price;
    const spark = Array.isArray(sparkRaw)
      ? sparkRaw.flatMap((v) => {
          const n = amount(v);
          return n !== undefined && n > 0 ? [n] : [];
        })
      : [];
    const rank = rankOf(row.market_cap_rank);
    const marketCap = amount(row.market_cap);
    const fullyDiluted = amount(row.fully_diluted_valuation);
    const volume24h = amount(row.total_volume);
    const high24h = amount(row.high_24h);
    const low24h = amount(row.low_24h);
    const change24h = numOf(row.price_change_24h);
    const circulating = amount(row.circulating_supply);
    const total = amount(row.total_supply);
    const max = amount(row.max_supply);
    return [
      {
        id,
        symbol,
        name,
        price,
        ...(rank && { rank }),
        // CoinGecko sends 0 for a market value it hasn't worked out: that's a gap, not a zero.
        ...(marketCap && { marketCap }),
        ...(fullyDiluted && { fullyDiluted }),
        ...(volume24h !== undefined && { volume24h }),
        ...(high24h && low24h && high24h >= low24h && { high24h, low24h }),
        ...(change24h !== undefined && { change24h }),
        ...(percent24h !== undefined && percent24h >= -100 && { changePercent24h: percent24h }),
        ...(circulating && { circulating }),
        ...(total && { total }),
        ...(max ? { max } : 'max_supply' in row && row.max_supply === null && { unlimited: true }),
        ...(ath && { ath }),
        ...(atl && { atl }),
        changes,
        ...(spark.length > 1 && { spark }),
        asOf: instantOf(row.last_updated) ?? new Date().toISOString(),
      },
    ];
  });
}

/** HTML in a coin's description, as plain text: tags gone, entities read, clipped at a sentence. */
export function plainText(html: string, most = 480): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, '’')
    .replace(/&lt;/g, '‹')
    .replace(/&gt;/g, '›')
    .replace(/&#\d+;|&\w+;/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (text.length <= most) return text;
  const cut = text.slice(0, most);
  const stop = cut.lastIndexOf('. ');
  return stop > most * 0.5 ? cut.slice(0, stop + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
}

/** `/coins/{id}`: what the coin is. Only plain words come out of it. */
export function parseCoin(body: unknown): CoinProfile | undefined {
  const coin = rec(body);
  const id = coinIdOf(coin.id);
  if (!id) return undefined;
  const english = strOf(rec(coin.description).en);
  const about = english ? plainText(english) : undefined;
  const genesis = strOf(coin.genesis_date);
  const algorithm = strOf(coin.hashing_algorithm)?.slice(0, 60);
  const categories = Array.isArray(coin.categories)
    ? coin.categories
        .flatMap((c) => {
          const s = strOf(c);
          return s && s.length <= 60 ? [s] : [];
        })
        .slice(0, 4)
    : [];
  return {
    id,
    ...(about && { about }),
    ...(genesis && /^\d{4}-\d{2}-\d{2}$/.test(genesis) && { genesis }),
    ...(algorithm && { algorithm }),
    ...(categories.length && { categories }),
  };
}

/** `/coins/{id}/market_chart`'s prices, oldest first. */
export function parseChart(body: unknown): CoinChart | undefined {
  const prices = rec(body).prices;
  if (!Array.isArray(prices)) return undefined;
  const times: number[] = [];
  const values: number[] = [];
  for (const pair of prices) {
    if (!Array.isArray(pair)) continue;
    const at = numOf(pair[0]);
    const price = amount(pair[1]);
    if (at === undefined || price === undefined || price <= 0) continue;
    if (times.length && at <= (times.at(-1) ?? 0)) continue;
    times.push(at);
    values.push(price);
  }
  return times.length >= 2 ? { times, prices: values } : undefined;
}

/** `/global`: crypto as a whole, in the asked currency. */
export function parseGlobal(body: unknown, currency: string): CoinGlobal | undefined {
  const data = rec(rec(body).data);
  const code = currency.toLowerCase();
  const total = amount(rec(data.total_market_cap)[code]);
  if (!total) return undefined;
  const volume = amount(rec(data.total_volume)[code]);
  const share = rec(data.market_cap_percentage);
  const pct = (v: unknown) => {
    const n = numOf(v);
    return n !== undefined && n >= 0 && n <= 100 ? n : undefined;
  };
  const btc = pct(share.btc);
  const eth = pct(share.eth);
  const change = numOf(data.market_cap_change_percentage_24h_usd);
  const coins = numOf(data.active_cryptocurrencies);
  const updated = numOf(data.updated_at);
  return {
    totalMarketCap: total,
    ...(volume !== undefined && { volume24h: volume }),
    // The source gives the day's move in dollars only; as a percentage, it's the same in any currency.
    ...(change !== undefined && change >= -100 && { change24h: change }),
    ...(btc !== undefined && { btc }),
    ...(eth !== undefined && { eth }),
    ...(coins !== undefined && Number.isInteger(coins) && coins >= 0 && { coinsTracked: coins }),
    asOf: new Date((updated ?? Date.now() / 1000) * 1000).toISOString(),
  };
}

/** How many days of chart to ask for, for each range. `undefined`: past what the keyless API keeps. */
export function chartDays(period: FinancePeriod): number | undefined {
  switch (period) {
    case '1D':
      return 1;
    case '1W':
      return 7;
    case '1M':
      return 30;
    case '3M':
      return 90;
    case '6M':
      return 180;
    case '1Y':
      return COIN_HISTORY_DAYS;
    default:
      return undefined;
  }
}

export interface CoinGeckoDeps extends Pick<OutsideDeps, 'fetcher'> {
  now?: () => number;
  /** Calls allowed in each window: the tests make it small. */
  rate?: { calls: number; windowMs: number };
}

/**
 * The one CoinGecko reader for the whole gateway: limited, cached, and honest
 * about being busy. Answers in flight are shared, so eight chips asking for the
 * same coin make one request.
 */
export class CoinGecko {
  readonly #deps: Pick<OutsideDeps, 'fetcher'>;
  readonly #now: () => number;
  readonly #rate: { calls: number; windowMs: number };
  /** When each of the last calls in the window was made. */
  readonly #calls: number[] = [];
  #restUntil = 0;
  readonly #cache = new Map<string, { at: number; value: unknown }>();
  readonly #flying = new Map<string, Promise<unknown>>();

  constructor(deps: CoinGeckoDeps) {
    this.#deps = { fetcher: deps.fetcher };
    this.#now = deps.now ?? Date.now;
    this.#rate = deps.rate ?? RATE;
  }

  /** CoinGecko asked to be left alone, or the limiter is spent. */
  get busy(): boolean {
    return this.#now() < this.#restUntil || !this.#room(false);
  }

  /** How many answers are kept: for the tests that prove the cache works. */
  get cached(): number {
    return this.#cache.size;
  }

  /** Whether a call may be made now; `take` spends it. */
  #room(take: boolean): boolean {
    const now = this.#now();
    while (this.#calls.length && now - (this.#calls[0] ?? 0) >= this.#rate.windowMs)
      this.#calls.shift();
    if (this.#calls.length >= this.#rate.calls) return false;
    if (take) this.#calls.push(now);
    return true;
  }

  #keep(key: string, value: unknown) {
    this.#cache.delete(key);
    this.#cache.set(key, { at: this.#now(), value });
    if (this.#cache.size > CACHE_MAX) {
      const oldest = this.#cache.keys().next();
      if (!oldest.done) this.#cache.delete(oldest.value);
    }
  }

  /**
   * A cached answer while it's fresh; otherwise one call. While CoinGecko is
   * busy, what was kept is served as it was (up to `STALE_MAX`); with nothing
   * kept, `CoinGeckoBusy`.
   */
  async #get<T>(
    key: string,
    ttl: number,
    path: string,
    read: (body: unknown) => T,
    id: string,
    signal: AbortSignal,
  ): Promise<T> {
    const held = this.#cache.get(key);
    const now = this.#now();
    if (held && now - held.at < ttl) return held.value as T;
    const flying = this.#flying.get(key);
    if (flying) return flying as Promise<T>;
    const stale = () => {
      if (held && now - held.at < STALE_MAX) return held.value as T;
      throw new CoinGeckoBusy();
    };
    if (now < this.#restUntil || !this.#room(true)) return stale();
    const work = (async () => {
      const response = await getOutside(this.#deps, id, `${API}${path}`, signal);
      if (response.status === 429) {
        const after = Number(response.headers['retry-after']);
        this.#restUntil =
          this.#now() +
          (Number.isFinite(after) && after > 0 ? Math.min(after, 600) * 1000 : REST_MS);
        return stale();
      }
      if (response.status === 404) {
        const value = read(undefined);
        this.#keep(key, value);
        return value;
      }
      if (response.refused || !response.ok || response.bodyBase64) {
        if (held) return held.value as T;
        throw new Error(`CoinGecko didn’t answer (${response.status || 'no connection'}).`);
      }
      let body: unknown;
      try {
        body = JSON.parse(response.body) as unknown;
      } catch {
        if (held) return held.value as T;
        throw new Error('CoinGecko sent something that isn’t its usual answer.');
      }
      const value = read(body);
      this.#keep(key, value);
      return value;
    })();
    this.#flying.set(key, work);
    try {
      return await work;
    } finally {
      this.#flying.delete(key);
    }
  }

  /** Coins whose name or symbol is what was asked, best-ranked first. */
  search(id: string, query: string, signal: AbortSignal): Promise<CoinRef[]> {
    const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!coinShaped(q)) return Promise.resolve([]);
    return this.#get(
      `s:${q}`,
      COIN_TTL.search,
      `/search?query=${encodeURIComponent(q)}`,
      parseSearch,
      id,
      signal,
    );
  }

  /**
   * Market figures for up to eight coins, in one call for all the ones not
   * already fresh. A coin CoinGecko doesn't have is simply absent.
   */
  async markets(
    id: string,
    ids: readonly string[],
    currency: string,
    signal: AbortSignal,
  ): Promise<Map<string, CoinMarket>> {
    const vs = currency.toLowerCase();
    const wanted = [...new Set(ids.filter((c) => coinIdOf(c)))].slice(0, 8);
    const out = new Map<string, CoinMarket>();
    const now = this.#now();
    const missing: string[] = [];
    for (const coin of wanted) {
      const held = this.#cache.get(`m:${vs}:${coin}`);
      if (held && now - held.at < COIN_TTL.markets) out.set(coin, held.value as CoinMarket);
      else missing.push(coin);
    }
    if (!missing.length) return out;
    const key = `mq:${vs}:${missing.sort().join(',')}`;
    const path = `/coins/markets?vs_currency=${encodeURIComponent(vs)}&ids=${missing
      .map(encodeURIComponent)
      .join(',')}&sparkline=true&price_change_percentage=1h,24h,7d,30d,1y`;
    let rows: CoinMarket[];
    try {
      rows = await this.#get(key, COIN_TTL.markets, path, parseMarkets, id, signal);
    } catch (error) {
      // Busy: whatever each coin was last read as, if it was.
      const kept = missing.flatMap((coin) => {
        const held = this.#cache.get(`m:${vs}:${coin}`);
        return held && now - held.at < STALE_MAX ? [held.value as CoinMarket] : [];
      });
      if (!kept.length && !out.size) throw error;
      rows = kept;
    }
    for (const row of rows) {
      this.#keep(`m:${vs}:${row.id}`, row);
      out.set(row.id, row);
    }
    return out;
  }

  /** The biggest coins by market value, with their week's shape. */
  top(id: string, currency: string, count: number, signal: AbortSignal): Promise<CoinMarket[]> {
    const vs = currency.toLowerCase();
    const n = Math.min(Math.max(1, Math.round(count)), 10);
    return this.#get(
      `top:${vs}:${n}`,
      COIN_TTL.markets,
      `/coins/markets?vs_currency=${encodeURIComponent(vs)}&order=market_cap_desc&per_page=${n}&page=1&sparkline=true&price_change_percentage=24h,7d`,
      parseMarkets,
      id,
      signal,
    );
  }

  /** What a coin is: its words, its first day, its algorithm and its kinds. */
  profile(id: string, coin: string, signal: AbortSignal): Promise<CoinProfile | undefined> {
    if (!coinIdOf(coin)) return Promise.resolve(undefined);
    return this.#get(
      `c:${coin}`,
      COIN_TTL.coin,
      `/coins/${encodeURIComponent(coin)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`,
      parseCoin,
      id,
      signal,
    );
  }

  /** A coin's prices over a range, as fine as the source keeps them for it. */
  chart(
    id: string,
    coin: string,
    currency: string,
    period: FinancePeriod,
    signal: AbortSignal,
  ): Promise<CoinChart | undefined> {
    const days = chartDays(period) ?? COIN_HISTORY_DAYS;
    const vs = currency.toLowerCase();
    if (!coinIdOf(coin)) return Promise.resolve(undefined);
    return this.#get(
      `h:${vs}:${coin}:${days}`,
      COIN_TTL.chart(period),
      `/coins/${encodeURIComponent(coin)}/market_chart?vs_currency=${encodeURIComponent(vs)}&days=${days}`,
      parseChart,
      id,
      signal,
    );
  }

  /** Crypto as a whole. */
  global(id: string, currency: string, signal: AbortSignal): Promise<CoinGlobal | undefined> {
    return this.#get(
      `g:${currency.toLowerCase()}`,
      COIN_TTL.global,
      '/global',
      (body) => parseGlobal(body, currency),
      id,
      signal,
    );
  }
}

/** A coin known on this computer by its CoinGecko id. */
export const knownById = (coin: string): CoinRef | undefined => {
  const found = BY_ID.get(coin);
  return found && { id: found.id, symbol: found.symbol, name: found.name };
};
