/**
 * Prices, for every model: what something costs now and what it cost before.
 *
 * From **Stooq** (`stooq.com`), which needs no key and no account: one CSV row
 * for the last session, and one CSV file of daily closes for the history.
 * Where Stooq has nothing — a listing it doesn't carry — **Yahoo Finance's
 * chart endpoint** is tried instead. That endpoint is undocumented and can
 * change or go away without notice, so it is a fallback only, every field is
 * read defensively, and a card that gets less simply shows less.
 *
 * Only the symbol and the range leave this computer, through the same
 * SSRF-guarded public fetcher as `web_fetch`. Everything that comes back is
 * data, never words for a model to follow.
 *
 * Honesty rules that this file keeps, not the card:
 *
 * - A price is a **close or a delayed last**, never a tick. `delayed` is true
 *   unless a source promises otherwise, and no source here does.
 * - A field nobody sent is left out, so nothing downstream can show a zero
 *   where a number was missing.
 * - A symbol nobody has comes back as `undefined`, and the tool says so.
 */
import { PERIOD_DAYS, type FinancePeriod, type InstrumentClass } from '@conch/protocol';

import { getOutside, OutsideError, numOf, rec, strOf, type OutsideDeps } from './outside';

const STOOQ_QUOTE = 'https://stooq.com/q/l/';
const STOOQ_DAILY = 'https://stooq.com/q/d/l/';
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/';

/** The shape of a price as a source last read it: fields nobody sent are absent. */
export interface MarketQuote {
  /** The symbol as the person wrote it. */
  symbol: string;
  name?: string;
  exchange?: string;
  currency?: string;
  price: number;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  volume?: number;
  /** When the price is from, as an ISO instant. */
  asOf: string;
  /** "Stooq" or "Yahoo Finance". */
  source: string;
}

/** Daily closes, oldest first. */
export interface MarketHistory {
  dates: string[];
  closes: number[];
  currency?: string;
  source: string;
}

/** `aapl.us`, `^spx`, `btcusd`: the form Stooq knows a symbol by. */
export interface StooqSymbol {
  /** What Stooq is asked for. */
  s: string;
  /** What Yahoo is asked for, when the fallback is tried. */
  yahoo: string;
  class: InstrumentClass;
}

/** Yahoo's exchange suffixes to the country suffixes Stooq uses. */
const SUFFIXES: Record<string, string> = {
  L: 'uk',
  DE: 'de',
  F: 'de',
  PA: 'fr',
  MI: 'it',
  MC: 'es',
  AS: 'nl',
  BR: 'be',
  LS: 'pt',
  VI: 'at',
  SW: 'ch',
  ST: 'se',
  HE: 'fi',
  CO: 'dk',
  OL: 'no',
  WA: 'pl',
  PR: 'cz',
  BD: 'hu',
  IR: 'ie',
  IS: 'tr',
  TO: 'ca',
  AX: 'au',
  NZ: 'nz',
  T: 'jp',
  HK: 'hk',
  SI: 'sg',
  KS: 'kr',
  TW: 'tw',
  NS: 'in',
  BO: 'in',
  SA: 'br',
  MX: 'mx',
  SS: 'cn',
  SZ: 'cn',
};
/** Those same suffixes, the other way, so a foreign ticker can be asked of Yahoo too. */
const YAHOO_SUFFIX = new Map(Object.entries(SUFFIXES).map(([y, s]) => [s, y]));

/** Crypto people name by its ticker alone; Stooq quotes each against the dollar. */
const CRYPTO = new Set([
  'BTC',
  'ETH',
  'SOL',
  'XRP',
  'ADA',
  'DOGE',
  'LTC',
  'BCH',
  'DOT',
  'AVAX',
  'LINK',
  'XMR',
  'TRX',
  'ETC',
]);

/** ISO 4217 codes common enough that a six-letter pair is surely a currency pair. */
const CURRENCIES = new Set([
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CHF',
  'CAD',
  'AUD',
  'NZD',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'HUF',
  'TRY',
  'ZAR',
  'MXN',
  'BRL',
  'CNY',
  'HKD',
  'SGD',
  'INR',
  'KRW',
  'ILS',
  'RON',
]);

/** Stooq's own names for the indexes people ask about, including Yahoo's spellings. */
const INDEXES: Record<string, string> = {
  '^SPX': '^spx',
  '^GSPC': '^spx',
  '^DJI': '^dji',
  '^IXIC': '^ndq',
  '^NDQ': '^ndq',
  '^NDX': '^ndx',
  '^RUT': '^rut',
  '^VIX': '^vix',
  '^FTSE': '^ukx',
  '^UKX': '^ukx',
  '^GDAXI': '^dax',
  '^DAX': '^dax',
  '^FCHI': '^cac',
  '^CAC': '^cac',
  '^N225': '^nkx',
  '^NKX': '^nkx',
  '^HSI': '^hsi',
  '^STOXX50E': '^sx5e',
  '^SX5E': '^sx5e',
  '^WIG20': '^wig20',
};

/**
 * The form Stooq (and Yahoo) know a symbol by, or nothing when it isn't a
 * symbol at all. Plain American tickers get `.us`; a Yahoo suffix is turned
 * into Stooq's country suffix; an index keeps its caret; crypto and currency
 * pairs are quoted against the dollar the way Stooq does.
 */
export function stooqSymbol(raw: string): StooqSymbol | undefined {
  const text = raw.trim().replace(/^\$/, '');
  if (!text || !/^[A-Za-z0-9^.\-/=]{1,24}$/.test(text)) return undefined;
  const upper = text.toUpperCase();

  if (upper.startsWith('^')) {
    const known = INDEXES[upper];
    return { s: known ?? upper.toLowerCase(), yahoo: upper, class: 'index' };
  }

  // Currency pairs, however they're written: EURUSD, EUR/USD, EURUSD=X.
  const pair = /^([A-Z]{3})[/-]?([A-Z]{3})(?:=X)?$/.exec(upper);
  if (pair?.[1] && pair[2] && CURRENCIES.has(pair[1]) && CURRENCIES.has(pair[2]))
    return {
      s: `${pair[1]}${pair[2]}`.toLowerCase(),
      yahoo: `${pair[1]}${pair[2]}=X`,
      class: 'fx',
    };

  // Crypto, by its own ticker or against a currency: BTC, BTC-USD, BTCUSD.
  const coin = /^([A-Z]{2,5})(?:[-/]?(USD|EUR|USDT))?$/.exec(upper);
  if (coin?.[1] && CRYPTO.has(coin[1])) {
    const against = coin[2] === 'EUR' ? 'EUR' : 'USD';
    return {
      s: `${coin[1]}${against}`.toLowerCase(),
      yahoo: `${coin[1]}-${against}`,
      class: 'crypto',
    };
  }

  const dotted = /^([A-Z0-9]{1,12})\.([A-Z]{1,3})$/.exec(upper);
  if (dotted?.[1] && dotted[2]) {
    const ticker = dotted[1];
    const given = dotted[2];
    // Already a Stooq country suffix (`air.fr`), or a Yahoo one to turn round.
    const country = YAHOO_SUFFIX.has(given.toLowerCase())
      ? given.toLowerCase()
      : SUFFIXES[given]?.toLowerCase();
    if (!country) return undefined;
    const yahooSuffix = YAHOO_SUFFIX.get(country) ?? given;
    return {
      s: `${ticker}.${country}`.toLowerCase(),
      yahoo: `${ticker}.${yahooSuffix}`,
      class: 'stock',
    };
  }

  // A plain ticker: American listings are what `.us` means to Stooq.
  if (/^[A-Z]{1,6}(?:[.-][A-Z])?$/.test(upper))
    return { s: `${upper.replace('.', '-')}.us`.toLowerCase(), yahoo: upper, class: 'stock' };
  return undefined;
}

/** A CSV line's cells. These feeds never quote a field, so a split is enough. */
const cells = (line: string) => line.trim().split(',');

/** A number a feed sent, or nothing: `N/D`, an empty cell and a zero price are all nothing. */
const cell = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/** `2026-10-07` + `21:00:04` as the instant it names, UTC (Stooq's times are UTC). */
function instant(date: string | undefined, time: string | undefined): string | undefined {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const clock = time && /^\d{2}:\d{2}(:\d{2})?$/.test(time) ? time : '00:00:00';
  return `${date}T${clock.length === 5 ? `${clock}:00` : clock}Z`;
}

/**
 * Stooq's one-line quote (`f=sd2t2ohlcvn`), read by its own header so a
 * change in the order can't shift a price into the volume. `undefined` when
 * Stooq has no such symbol (its row says `N/D`).
 */
export function parseStooqQuote(csv: string, symbol: string): MarketQuote | undefined {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0];
  const row = lines[1];
  if (!head || !row) return undefined;
  const names = cells(head).map((n) => n.toLowerCase());
  const values = cells(row);
  const at = (name: string) => {
    const i = names.indexOf(name);
    return i < 0 ? undefined : values[i];
  };
  const price = cell(at('close'));
  const date = at('date');
  if (price === undefined || price <= 0 || !date || date === 'N/D') return undefined;
  const name = at('name');
  const open = cell(at('open'));
  const high = cell(at('high'));
  const low = cell(at('low'));
  const volume = cell(at('volume'));
  return {
    symbol,
    ...(name && name !== 'N/D' && { name: name.slice(0, 140) }),
    price,
    ...(open !== undefined && open > 0 && { open }),
    ...(high !== undefined && high > 0 && { high }),
    ...(low !== undefined && low > 0 && { low }),
    ...(volume !== undefined && volume >= 0 && { volume: Math.round(volume) }),
    asOf: instant(date, at('time')) ?? `${date}T00:00:00Z`,
    source: 'Stooq',
  };
}

/** Stooq's daily file (`Date,Open,High,Low,Close,Volume`), oldest first. */
export function parseStooqDaily(csv: string): MarketHistory | undefined {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0];
  if (!head || !/^date,/i.test(head)) return undefined;
  const names = cells(head).map((n) => n.toLowerCase());
  const dateAt = names.indexOf('date');
  const closeAt = names.indexOf('close');
  if (dateAt < 0 || closeAt < 0) return undefined;
  const dates: string[] = [];
  const closes: number[] = [];
  for (const line of lines.slice(1)) {
    const values = cells(line);
    const date = values[dateAt];
    const close = cell(values[closeAt]);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || close === undefined || close <= 0) continue;
    dates.push(date);
    closes.push(close);
  }
  if (!dates.length) return undefined;
  return { dates, closes, source: 'Stooq (daily closes)' };
}

/**
 * Yahoo's chart answer, read defensively: the endpoint is undocumented, so
 * every field is checked and anything missing is simply left out.
 */
export function parseYahooChart(body: unknown): { quote?: MarketQuote; history?: MarketHistory } {
  const results = rec(rec(body).chart).result;
  const first = rec(Array.isArray(results) ? results[0] : results);
  const meta = rec(first.meta);
  const currency = strOf(meta.currency)?.toUpperCase();
  const symbol = strOf(meta.symbol) ?? '';
  const times = Array.isArray(first.timestamp) ? first.timestamp : [];
  const quotes = Array.isArray(rec(first.indicators).quote)
    ? rec((rec(first.indicators).quote as unknown[])[0])
    : {};
  const closeList = Array.isArray(quotes.close) ? quotes.close : [];

  const dates: string[] = [];
  const closes: number[] = [];
  times.forEach((t, i) => {
    const seconds = numOf(t);
    const close = numOf(closeList[i]);
    if (seconds === undefined || close === undefined || close <= 0) return;
    const date = new Date(seconds * 1000).toISOString().slice(0, 10);
    dates.push(date);
    closes.push(close);
  });

  const price = numOf(meta.regularMarketPrice) ?? closes.at(-1);
  const previous = numOf(meta.chartPreviousClose) ?? numOf(meta.previousClose);
  const asOfSeconds = numOf(meta.regularMarketTime);
  const high = numOf(meta.regularMarketDayHigh);
  const low = numOf(meta.regularMarketDayLow);
  const volume = numOf(meta.regularMarketVolume);
  const exchange = strOf(meta.fullExchangeName) ?? strOf(meta.exchangeName);
  return {
    ...(price !== undefined &&
      price > 0 && {
        quote: {
          symbol: symbol.slice(0, 24),
          ...(exchange && { exchange: exchange.slice(0, 60) }),
          ...(currency && /^[A-Z]{3,5}$/.test(currency) && { currency }),
          price,
          ...(previous !== undefined && previous > 0 && { previousClose: previous }),
          ...(high !== undefined && high > 0 && { high }),
          ...(low !== undefined && low > 0 && { low }),
          ...(volume !== undefined && volume >= 0 && { volume: Math.round(volume) }),
          asOf: new Date((asOfSeconds ?? Date.now() / 1000) * 1000).toISOString(),
          source: 'Yahoo Finance',
        },
      }),
    ...(dates.length && {
      history: {
        dates,
        closes,
        ...(currency && /^[A-Z]{3,5}$/.test(currency) && { currency }),
        source: 'Yahoo Finance (daily closes)',
      },
    }),
  };
}

/** Yahoo's own word for a range, for each of ours. */
const YAHOO_RANGE: Record<FinancePeriod, string> = {
  '1D': '1d',
  '1W': '5d',
  '1M': '1mo',
  '3M': '3mo',
  '6M': '6mo',
  '1Y': '1y',
  '5Y': '5y',
  MAX: 'max',
};

const yyyymmdd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

/** A text answer from a public service, or a plain reason it didn't come. */
async function getText(
  deps: Pick<OutsideDeps, 'fetcher'>,
  id: string,
  url: string,
  signal: AbortSignal,
  service: string,
): Promise<string | undefined> {
  const response = await getOutside(deps, id, url, signal, 'text/csv, text/plain, */*');
  if (response.status === 404) return undefined;
  if (response.refused)
    throw new OutsideError(`${service} couldn’t be reached: ${response.refused}`);
  if (!response.ok || response.bodyBase64) return undefined;
  return response.body;
}

export interface MarketDeps extends Pick<OutsideDeps, 'fetcher'> {
  now?: () => number;
}

/** One instrument's last price, from Stooq, falling back to Yahoo. */
export async function readQuote(
  deps: MarketDeps,
  id: string,
  symbol: string,
  found: StooqSymbol,
  signal: AbortSignal,
): Promise<MarketQuote | undefined> {
  const url = new URL(STOOQ_QUOTE);
  url.searchParams.set('s', found.s);
  url.searchParams.set('f', 'sd2t2ohlcvn');
  url.searchParams.set('h', '');
  url.searchParams.set('e', 'csv');
  const csv = await getText(deps, id, url.href, signal, 'Stooq').catch(() => undefined);
  const quote = csv ? parseStooqQuote(csv, symbol) : undefined;
  if (quote) return quote;
  // Stooq doesn't carry it (or wouldn't answer): try the fallback, honestly labelled.
  const chart = await readChart(deps, id, found.yahoo, '1M', signal).catch(() => undefined);
  return chart?.quote ? { ...chart.quote, symbol } : undefined;
}

/** One instrument's daily closes over a period, from Stooq, falling back to Yahoo. */
export async function readHistory(
  deps: MarketDeps,
  id: string,
  found: StooqSymbol,
  period: FinancePeriod,
  signal: AbortSignal,
): Promise<MarketHistory | undefined> {
  const now = deps.now?.() ?? Date.now();
  const url = new URL(STOOQ_DAILY);
  url.searchParams.set('s', found.s);
  url.searchParams.set('i', 'd');
  if (period !== 'MAX') {
    // A few extra days, so a week that starts on a holiday still has its points.
    url.searchParams.set('d1', yyyymmdd(now - (PERIOD_DAYS[period] + 5) * 86_400_000));
    url.searchParams.set('d2', yyyymmdd(now));
  }
  const csv = await getText(deps, id, url.href, signal, 'Stooq').catch(() => undefined);
  const history = csv ? parseStooqDaily(csv) : undefined;
  if (history) return history;
  const chart = await readChart(deps, id, found.yahoo, period, signal).catch(() => undefined);
  return chart?.history;
}

/**
 * Yahoo Finance's chart endpoint. Undocumented: it can change its shape or
 * stop answering at any time, so it is only ever a fallback and never a
 * reason for a tool to fail.
 */
export async function readChart(
  deps: MarketDeps,
  id: string,
  yahooSymbol: string,
  period: FinancePeriod,
  signal: AbortSignal,
): Promise<{ quote?: MarketQuote; history?: MarketHistory } | undefined> {
  if (!/^[A-Za-z0-9^.\-=]{1,24}$/.test(yahooSymbol)) return undefined;
  const url = new URL(`${YAHOO_CHART}${encodeURIComponent(yahooSymbol)}`);
  url.searchParams.set('range', YAHOO_RANGE[period]);
  url.searchParams.set('interval', '1d');
  const response = await getOutside(deps, id, url.href, signal);
  if (!response.ok || response.refused || response.bodyBase64) return undefined;
  try {
    return parseYahooChart(JSON.parse(response.body) as unknown);
  } catch {
    return undefined;
  }
}

/** A series thinned to at most `most` points, keeping the first and the last. */
export function thin(values: readonly number[], most: number): number[] {
  if (values.length <= most) return [...values];
  const step = (values.length - 1) / (most - 1);
  return Array.from({ length: most }, (_, i) => values[Math.round(i * step)] ?? 0);
}
