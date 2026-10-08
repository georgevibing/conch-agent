/**
 * Coins, against fixtures in CoinGecko's real shapes: `/search`, `/coins/markets`,
 * `/coins/{id}`, `/coins/{id}/market_chart` and `/global`, with Stooq standing in.
 *
 * What these tests are for: nothing invented (a coin with no maximum has no
 * maximum, a figure CoinGecko didn't send stays out), the right coin when
 * several share a symbol, nothing long or odd sent to `/search`, and the
 * healing: the limiter, the cache, the rest after a 429, what was kept served
 * while busy, and Stooq standing in for the price and the chart.
 */
import { readFileSync } from 'node:fs';

import { CryptoMarketView, PriceSeries, QuotesView } from '@conch/protocol';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { AppFetchRequest, AppFetcher, AppFetchResponse } from '../conchapps/types';
import type { ToolContext } from '../conversations/manager';
import { cleanView } from '../conversations/views';
import {
  CoinGecko,
  coinShaped,
  knownCoin,
  parseChart,
  parseCoin,
  parseGlobal,
  parseMarkets,
  parseSearch,
  pickCoin,
  plainText,
} from './coingecko';
import { FinanceSource, financeTools } from './finance';
import { registerFinanceRoutes } from './finance-routes';

const json = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/finance-coingecko-${name}.json`, import.meta.url), 'utf8'),
  ) as unknown;
const text = (name: string) =>
  readFileSync(new URL(`./fixtures/finance-${name}`, import.meta.url), 'utf8');

const SEARCH_UNI = json('search-uni');
const SEARCH_CELESTIA = json('search-celestia');
const MARKETS = json('markets') as Record<string, unknown>[];
const COIN = json('coin-bitcoin');
const CHART = json('chart-1d');
const GLOBAL = json('global');
const TOP = json('top');
const TICKERS = text('sec-tickers.json');
const DAILY = text('stooq-daily.csv');
const MISSING = text('stooq-missing.csv');
const STOOQ_BTC =
  'Symbol,Date,Time,Open,High,Low,Close,Volume,Name\nBTCUSD,2026-10-09,21:00:00,66900,67700,66400,67150,0,BITCOIN\n';

/** Friday 9 October 2026, a few minutes after CoinGecko last updated. */
const NOW = Date.parse('2026-10-09T21:06:00Z');
const ctx = { conversationId: 'c1', signal: new AbortController().signal } as ToolContext;
const ok = (body: unknown): AppFetchResponse => ({
  ok: true,
  status: 200,
  headers: {},
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const status = (code: number, headers: Record<string, string> = {}): AppFetchResponse => ({
  ok: false,
  status: code,
  headers,
  body: '',
});

interface Options {
  /** Answer a CoinGecko request differently; `undefined` falls through to the fixture. */
  coingecko?: (url: URL) => AppFetchResponse | undefined;
  rate?: { calls: number; windowMs: number };
  timeZone?: string;
  now?: () => number;
}

/** CoinGecko, Stooq and EDGAR, each answering from its fixture. */
function services(options: Options = {}) {
  const seen: AppFetchRequest[] = [];
  const fetcher: AppFetcher = vi.fn(async (_app, request) => {
    seen.push(request);
    const url = new URL(request.url);
    if (url.hostname === 'api.coingecko.com') {
      const given = options.coingecko?.(url);
      if (given) return given;
      const path = url.pathname.replace('/api/v3', '');
      if (path === '/search') {
        const q = url.searchParams.get('query');
        return ok(q === 'uni' ? SEARCH_UNI : q === 'celestia' ? SEARCH_CELESTIA : { coins: [] });
      }
      if (path === '/coins/markets') {
        if (url.searchParams.get('order')) return ok(TOP);
        const ids = (url.searchParams.get('ids') ?? '').split(',');
        return ok(MARKETS.filter((row) => ids.includes(String(row.id))));
      }
      if (path === '/coins/bitcoin') return ok(COIN);
      if (/^\/coins\/[a-z0-9-]+\/market_chart$/.test(path)) return ok(CHART);
      if (path === '/global') return ok(GLOBAL);
      return status(404);
    }
    if (url.hostname === 'stooq.com') {
      const s = url.searchParams.get('s');
      if (url.pathname.startsWith('/q/d/')) return ok(s === 'btcusd' ? DAILY : 'No data');
      return ok(s === 'btcusd' ? STOOQ_BTC : MISSING);
    }
    if (url.hostname === 'www.sec.gov') return ok(TICKERS);
    return status(404);
  });
  const source = new FinanceSource({
    fetcher,
    now: options.now ?? (() => NOW),
    timeZone: options.timeZone ?? 'America/New_York',
    ...(options.rate && { rate: options.rate }),
  });
  const coingecko = () => seen.filter((r) => r.url.includes('api.coingecko.com'));
  return { fetcher, seen, coingecko, source, tools: financeTools(ctx, { source }) };
}

const run = async (
  tools: ReturnType<typeof financeTools>,
  name: string,
  args: Record<string, unknown>,
) => {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`no ${name} tool`);
  const result = await found.run(args);
  if (typeof result === 'string' || !result.view) throw new Error('no view');
  return { text: JSON.parse(result.text) as Record<string, unknown>, view: result.view };
};

const quotes = async (tools: ReturnType<typeof financeTools>, args: Record<string, unknown>) => {
  const { text, view } = await run(tools, 'quote', args);
  if (view.kind !== 'quotes') throw new Error('no quotes');
  // What's logged is what's drawn: the view survives the log's own check.
  expect(cleanView(view)).toEqual(QuotesView.parse(view));
  return { text, view };
};

// ── Reading what CoinGecko sends ────────────────────────────────────────────

describe('CoinGecko’s answers, read defensively', () => {
  it('reads search hits in its order, dropping any without an id, symbol or name', () => {
    const hits = parseSearch(SEARCH_UNI);
    expect(hits.map((h) => h.id)).toEqual(['uniswap', 'unicorn-token', 'unification', 'uni-coin']);
    expect(hits[3]).toEqual({ id: 'uni-coin', symbol: 'UNI', name: 'UNI COIN' });
    expect(parseSearch({ coins: [{ id: '../etc', symbol: 'X', name: 'X' }] })).toEqual([]);
    expect(parseSearch('nonsense')).toEqual([]);
  });

  it('picks the coin worth the most when several share a symbol, and names the others', () => {
    const picked = pickCoin(parseSearch(SEARCH_UNI), 'UNI');
    expect(picked?.coin.id).toBe('uniswap');
    expect(picked?.alternatives.map((a) => a.id)).toEqual(['unicorn-token', 'uni-coin']);
    // A name wins outright, and something close-but-different is never taken for it.
    expect(pickCoin(parseSearch(SEARCH_UNI), 'uniswap')?.coin.id).toBe('uniswap');
    expect(pickCoin(parseSearch(SEARCH_UNI), 'unis')).toBeUndefined();
    expect(pickCoin(parseSearch(SEARCH_CELESTIA), 'TIA.B')?.coin.id).toBe('celestia-bridged');
  });

  it('keeps a coin with no maximum supply as having none, never a zero', () => {
    const rows = parseMarkets(MARKETS);
    const bitcoin = rows.find((r) => r.id === 'bitcoin');
    const celestia = rows.find((r) => r.id === 'celestia');
    expect(bitcoin).toMatchObject({ max: 21_000_000, circulating: 19_610_806, rank: 1 });
    expect(bitcoin?.unlimited).toBeUndefined();
    expect(celestia?.max).toBeUndefined();
    expect(celestia?.unlimited).toBe(true);
  });

  it('leaves out what wasn’t sent: no market value is a gap, a missing move is absent', () => {
    const [row] = parseMarkets([
      {
        ...MARKETS[0],
        market_cap: 0,
        fully_diluted_valuation: null,
        price_change_percentage_1y_in_currency: null,
        max_supply: undefined,
        ath: null,
      },
    ]);
    expect(row?.marketCap).toBeUndefined();
    expect(row?.fullyDiluted).toBeUndefined();
    expect(row?.changes['1y']).toBeUndefined();
    expect(row?.changes['7d']).toBe(4.2);
    // Not sent at all is not "no maximum": only an explicit null says that.
    expect(row?.unlimited).toBeUndefined();
    expect(row?.ath).toBeUndefined();
    expect(parseMarkets([{ id: 'x', symbol: 'x', name: 'X', current_price: -1 }])).toEqual([]);
  });

  it('turns a description into plain words: no tags, no links, clipped at a sentence', () => {
    const profile = parseCoin(COIN);
    expect(profile).toMatchObject({
      id: 'bitcoin',
      genesis: '2009-01-03',
      algorithm: 'SHA-256',
    });
    expect(profile?.categories).toHaveLength(4);
    expect(profile?.about).not.toMatch(/[<>]|href|https?:/);
    expect(profile?.about?.length).toBeLessThanOrEqual(480);
    expect(profile?.about).toMatch(/^Bitcoin is the first successful internet money/);
    expect(plainText('<p>A &amp; B</p><script>x</script>')).toBe('A & B x');
  });

  it('reads a chart oldest first, and crypto as a whole in the asked currency', () => {
    const chart = parseChart(CHART);
    expect(chart?.times).toHaveLength(289);
    expect(parseChart({ prices: [[1, 'x']] })).toBeUndefined();
    expect(parseGlobal(GLOBAL, 'EUR')).toMatchObject({
      totalMarketCap: 2_223_456_789_012,
      btc: 54.62,
      eth: 13.21,
      change24h: 1.234,
      coinsTracked: 17_234,
    });
    expect(parseGlobal(GLOBAL, 'JPY')).toBeUndefined();
  });

  it('sends a name to search only when it’s a coin’s shape', () => {
    expect(coinShaped('celestia')).toBe(true);
    expect(coinShaped('bitcoin cash')).toBe(true);
    expect(coinShaped('the user’s password is hunter2')).toBe(false);
    expect(coinShaped('one two three four')).toBe(false);
    expect(coinShaped('a'.repeat(33))).toBe(false);
    expect(coinShaped('x?y=1')).toBe(false);
    expect(knownCoin('Bitcoin')?.id).toBe('bitcoin');
    expect(knownCoin('doge')?.id).toBe('dogecoin');
  });
});

// ── The quote tool, for coins ───────────────────────────────────────────────

describe('a coin’s quote', () => {
  it('“What’s BTC at?” is a coin: 24/7, CoinGecko’s figures, and an aggregator said to be one', async () => {
    const { tools, coingecko } = services();
    const { text, view } = await quotes(tools, { symbols: ['BTC'] });
    const btc = view.items[0];
    expect(btc).toMatchObject({
      symbol: 'BTC',
      name: 'Bitcoin',
      class: 'crypto',
      currency: 'USD',
      price: 67_187,
      dayState: 'always',
      delayed: true,
      source: 'CoinGecko',
      dayRange: { low: 66_387, high: 67_770 },
    });
    expect(btc?.crypto).toMatchObject({
      id: 'bitcoin',
      rank: 1,
      supply: { circulating: 19_610_806, max: 21_000_000 },
      ath: { price: 109_000, fromPercent: -38.36 },
      changes: { '1h': 0.12, '24h': -0.31, '7d': 4.2, '30d': 12.08, '1y': 140.4 },
      genesis: '2009-01-03',
      algorithm: 'SHA-256',
      source: 'CoinGecko',
    });
    // Known on this computer: nothing was searched for.
    expect(coingecko().some((r) => r.url.includes('/search'))).toBe(false);
    expect(String(text.coinNote)).toMatch(
      /average across many exchanges.*not the price on any one exchange/,
    );
    expect(String(text.note)).toMatch(/not financial advice/);
    // The chart for a month is hourly, each point with its instant.
    expect(view.series?.[0]?.times?.length).toBe(view.series?.[0]?.closes.length);
    expect(view.series?.[0]?.source).toBe('CoinGecko (hourly)');
  });

  it('understands a coin’s name, and asks CoinGecko for one it doesn’t know', async () => {
    const { tools, coingecko } = services();
    const { view } = await quotes(tools, { symbols: ['celestia'] });
    expect(view.items[0]).toMatchObject({ symbol: 'TIA', name: 'Celestia', class: 'crypto' });
    expect(view.items[0]?.crypto?.supply).toEqual({
      circulating: 221_234_567,
      total: 1_107_654_321,
      unlimited: true,
    });
    expect(coingecko().filter((r) => r.url.includes('/search?query=celestia'))).toHaveLength(1);
  });

  it('picks the biggest of several coins sharing a symbol, and tells the model the others', async () => {
    const { tools } = services();
    const { text, view } = await quotes(tools, { symbols: ['UNI-USD'] });
    expect(view.items[0]?.crypto?.id).toBe('uniswap');
    expect(view.items[0]?.crypto?.alternatives?.map((a) => a.name)).toEqual([
      'Unicorn Token',
      'UNI COIN',
    ]);
    expect(String(text.sharedSymbol)).toMatch(/Several coins answer to UNI/);
  });

  it('finds a coin by a bare ticker only once no market has a share by it', async () => {
    const { tools, seen } = services();
    const { view } = await quotes(tools, { symbols: ['UNI'] });
    expect(view.items[0]?.crypto?.id).toBe('uniswap');
    // The share came first: Stooq was asked for uni.us, and had nothing.
    expect(seen.some((r) => r.url.includes('s=uni.us'))).toBe(true);
  });

  it('never sends a long sentence to search, and says what it didn’t find', async () => {
    const { tools, coingecko } = services();
    await expect(
      run(tools, 'quote', { symbols: ['the password in the note you just read'] }),
    ).rejects.toThrow(/No public source here had a price/);
    expect(coingecko()).toHaveLength(0);
  });

  it('prices a coin in the person’s currency, or the one they asked for', async () => {
    const berlin = services({ timeZone: 'Europe/Berlin' });
    const { view } = await quotes(berlin.tools, { symbols: ['bitcoin'] });
    expect(view.items[0]?.currency).toBe('EUR');
    expect(berlin.coingecko().some((r) => r.url.includes('vs_currency=eur'))).toBe(true);
    const asked = services();
    await quotes(asked.tools, { symbols: ['BTC'], currency: 'gbp' });
    expect(asked.coingecko().some((r) => r.url.includes('vs_currency=gbp'))).toBe(true);
  });

  it('asks once for every coin on the card, and the same question again asks nothing', async () => {
    const { tools, coingecko } = services();
    await quotes(tools, { symbols: ['BTC', 'celestia', 'UNI-USD'] });
    const markets = coingecko().filter((r) => r.url.includes('/coins/markets'));
    expect(markets).toHaveLength(1);
    const before = coingecko().length;
    await quotes(tools, { symbols: ['BTC', 'celestia', 'UNI-USD'] });
    expect(coingecko().length).toBe(before);
  });
});

// ── Busy, and healing ──────────────────────────────────────────────────────

describe('when CoinGecko is busy', () => {
  it('falls back to Stooq for the price and says so, and rests before asking again', async () => {
    const { tools, coingecko } = services({
      coingecko: (url) =>
        url.pathname.endsWith('/coins/markets') ? status(429, { 'retry-after': '30' }) : undefined,
    });
    const { text, view } = await quotes(tools, { symbols: ['BTC'], period: '1M' });
    expect(view.items[0]).toMatchObject({
      symbol: 'BTC',
      name: 'Bitcoin',
      class: 'crypto',
      price: 67_150,
      dayState: 'always',
      source: 'Stooq',
      notice: 'CoinGecko is busy; prices from Stooq',
    });
    // Nothing CoinGecko didn't send: no rank, no supply, no highs.
    expect(view.items[0]?.crypto).toBeUndefined();
    expect(view.series?.[0]?.source).toBe('Stooq (daily closes)');
    expect((text.quotes as { notice?: string }[])[0]?.notice).toMatch(/busy/);
    // Resting: the next ask makes no call to CoinGecko at all.
    const asked = coingecko().length;
    await quotes(tools, { symbols: ['ETH'] }).catch(() => undefined);
    expect(coingecko().length).toBe(asked);
  });

  it('serves what it already read, with its own time on it, while busy', async () => {
    let now = NOW;
    let busy = false;
    const { tools } = services({
      now: () => now,
      coingecko: () => (busy ? status(429) : undefined),
    });
    await quotes(tools, { symbols: ['BTC'] });
    now += 5 * 60_000;
    busy = true;
    const { view } = await quotes(tools, { symbols: ['BTC'] });
    expect(view.items[0]?.source).toBe('CoinGecko');
    expect(view.items[0]?.asOf).toBe('2026-10-09T21:04:11.512Z');
    expect(view.items[0]?.crypto?.rank).toBe(1);
  });

  it('keeps under its own limit: past it, no request is made and Stooq stands in', async () => {
    const { tools, coingecko } = services({ rate: { calls: 2, windowMs: 60_000 } });
    // BTC: markets + chart + profile would be three; the limiter allows two.
    const { view } = await quotes(tools, { symbols: ['BTC'] });
    expect(coingecko()).toHaveLength(2);
    expect(view.items[0]?.source).toBe('CoinGecko');
    const { view: next } = await quotes(tools, { symbols: ['ETH'] }).catch(() => ({
      view: undefined,
    }));
    expect(coingecko()).toHaveLength(2);
    expect(next?.items[0]?.notice ?? 'missing').toMatch(/busy|missing/);
  });

  it('the market overview says plainly that it’s busy, with nothing made up', async () => {
    const { tools } = services({ coingecko: () => status(429) });
    await expect(run(tools, 'crypto_market', {})).rejects.toThrow(
      /CoinGecko is busy.*don’t give market figures from memory/,
    );
  });

  it('a coin CoinGecko gives no answer for comes from Stooq, and the card says why', async () => {
    const { tools } = services({
      coingecko: (url) => (url.pathname.endsWith('/coins/markets') ? status(503) : undefined),
    });
    const { view } = await quotes(tools, { symbols: ['bitcoin'] });
    expect(view.items[0]?.notice).toBe('CoinGecko didn’t answer; prices from Stooq');
  });
});

describe('the cache and the limiter', () => {
  it('keeps each kind of answer for its own time', async () => {
    let now = NOW;
    const { fetcher } = services();
    const gecko = new CoinGecko({ fetcher, now: () => now });
    const signal = new AbortController().signal;
    await gecko.markets('t', ['bitcoin'], 'usd', signal);
    await gecko.profile('t', 'bitcoin', signal);
    expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(2);
    now += 61_000; // markets are stale after a minute; a profile keeps ten
    await gecko.markets('t', ['bitcoin'], 'usd', signal);
    await gecko.profile('t', 'bitcoin', signal);
    expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(3);
  });

  it('is busy once its window is spent, and not after the window passes', async () => {
    let now = NOW;
    const { fetcher } = services();
    const gecko = new CoinGecko({ fetcher, now: () => now, rate: { calls: 1, windowMs: 60_000 } });
    const signal = new AbortController().signal;
    await gecko.global('t', 'usd', signal);
    expect(gecko.busy).toBe(true);
    await expect(gecko.search('t', 'celestia', signal)).rejects.toThrow(/busy/);
    now += 60_000;
    expect(gecko.busy).toBe(false);
    await expect(gecko.search('t', 'celestia', signal)).resolves.toHaveLength(2);
  });
});

// ── History, the market, fundamentals, the range switch ─────────────────────

describe('a coin’s history', () => {
  it('draws a day every five minutes, each point with its instant', async () => {
    const { tools } = services();
    const { view } = await run(tools, 'price_history', { symbol: 'bitcoin', period: '1D' });
    if (view.kind !== 'quotes') throw new Error('no quotes');
    const series = PriceSeries.parse(view.series?.[0]);
    expect(series.period).toBe('1D');
    expect(series.closes.length).toBeLessThanOrEqual(360);
    const first = (CHART as { prices: [number, number][] }).prices[0]?.[0] ?? 0;
    expect(series.times?.[0]).toBe(new Date(first).toISOString());
    expect(series.source).toBe('CoinGecko (every five minutes)');
  });

  it('past a year, uses Stooq’s daily closes: the keyless API keeps only one', async () => {
    const { tools, coingecko } = services();
    const { view } = await run(tools, 'price_history', { symbol: 'BTC', period: 'MAX' });
    if (view.kind !== 'quotes') throw new Error('no quotes');
    expect(view.series?.[0]?.source).toBe('Stooq (daily closes)');
    expect(coingecko().some((r) => r.url.includes('market_chart'))).toBe(false);
  });
});

describe('crypto as a whole', () => {
  it('is a card of the total, its day, the dominance and the ten biggest', async () => {
    const { tools } = services();
    const { text, view } = await run(tools, 'crypto_market', {});
    const market = CryptoMarketView.parse(view);
    expect(market).toMatchObject({
      currency: 'USD',
      totalMarketCap: 2_412_345_678_901,
      change24h: 1.23,
      dominance: { btc: 54.62, eth: 13.21 },
      source: 'CoinGecko',
    });
    expect(market.coins).toHaveLength(10);
    expect(market.coins[0]).toMatchObject({ symbol: 'BTC', rank: 1, change24h: -0.31 });
    expect(market.coins[0]?.spark?.length).toBeLessThanOrEqual(56);
    expect(String(text.note)).toMatch(/not live and not any one exchange’s prices/);
    expect(cleanView(view)).toEqual(market);
  });
});

describe('fundamentals for a coin', () => {
  it('is the coin’s own card, since a coin files no accounts', async () => {
    const { tools } = services();
    const { text, view } = await run(tools, 'fundamentals', { companies: ['bitcoin'] });
    expect(view.kind).toBe('quotes');
    if (view.kind !== 'quotes') return;
    expect(view.items[0]?.crypto?.algorithm).toBe('SHA-256');
    expect(String(text.noFilings)).toMatch(/Coins file no accounts/);
  });

  it('beside a company, it says so instead of inventing filings', async () => {
    const { tools } = services();
    const { view } = await run(tools, 'fundamentals', { companies: ['AAPL', 'bitcoin'] });
    if (view.kind !== 'fundamentals') throw new Error('no fundamentals');
    const coin = view.items.find((c) => c.symbol === 'BTC');
    expect(coin?.unavailable).toMatch(/is a coin: it files no accounts/);
    expect(coin?.revenue).toBeUndefined();
  });
});

describe('GET /api/finance/history for a coin', () => {
  it('asks for the very coin the card shows, in its currency', async () => {
    const { source, coingecko } = services();
    const app = Fastify();
    registerFinanceRoutes(app, source);
    const answer = await app.inject({
      method: 'GET',
      url: '/api/finance/history?symbol=UNI&period=1W&coin=unicorn-token&currency=EUR',
    });
    expect(answer.statusCode).toBe(200);
    expect(coingecko().at(-1)?.url).toContain(
      '/coins/unicorn-token/market_chart?vs_currency=eur&days=7',
    );
    const bad = await app.inject({
      method: 'GET',
      url: '/api/finance/history?symbol=UNI&period=1W&coin=..%2Fetc',
    });
    expect(bad.statusCode).toBe(400);
    const odd = await app.inject({
      method: 'GET',
      url: '/api/finance/history?symbol=UNI&period=1W&coin=uniswap&currency=XYZ',
    });
    expect(odd.statusCode).toBe(400);
    await app.close();
  });
});
