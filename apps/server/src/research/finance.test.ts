/**
 * The money tools, against fixtures taken from the real services' shapes: a
 * Stooq quote row and daily file, SEC EDGAR's ticker list and
 * `companyconcept`, and Yahoo's chart answer as the fallback.
 *
 * What these tests are really for: proving nothing is invented. A symbol
 * nobody has comes back named, not priced. A company that doesn't file says
 * so instead of carrying numbers. A field a service left out stays out. And
 * the same question twice asks a public service once.
 */
import { readFileSync } from 'node:fs';

import { FundamentalsView, PriceSeries, QuotesView, ToolView } from '@conch/protocol';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppFetchRequest, AppFetcher, AppFetchResponse } from '../conchapps/types';
import type { ToolContext } from '../conversations/manager';
import { cleanView } from '../conversations/views';
import { FinanceSource, financeTools, stateOf } from './finance';
import { registerFinanceRoutes } from './finance-routes';
import { findFiler, parseFilers, periodFigures } from './filings';
import { parseStooqDaily, parseStooqQuote, parseYahooChart, stooqSymbol, thin } from './market';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/finance-${name}`, import.meta.url), 'utf8');
const QUOTE = fixture('stooq-quote.csv');
const MISSING = fixture('stooq-missing.csv');
const DAILY = fixture('stooq-daily.csv');
const TICKERS = fixture('sec-tickers.json');
const REVENUE = fixture('sec-revenue.json');
const NET_INCOME = fixture('sec-netincome.json');
const EPS = fixture('sec-eps.json');
const SHARES = fixture('sec-shares.json');
const YAHOO = fixture('finance-yahoo-chart.json'.replace('finance-', ''));

const ctx = { conversationId: 'c1', signal: new AbortController().signal } as ToolContext;
const ok = (body: string): AppFetchResponse => ({ ok: true, status: 200, headers: {}, body });
const gone = (status: number): AppFetchResponse => ({ ok: false, status, headers: {}, body: '' });
/** Friday 9 October 2026, after the American close. */
const NOW = Date.parse('2026-10-09T23:30:00Z');

interface Answers {
  quote?: AppFetchResponse | Error;
  daily?: AppFetchResponse | Error;
  tickers?: AppFetchResponse | Error;
  concept?: (tag: string) => AppFetchResponse | Error;
  yahoo?: AppFetchResponse | Error;
}

/** Stooq, EDGAR and Yahoo, each answering from its fixture unless told otherwise. */
function services(answers: Answers = {}) {
  const seen: AppFetchRequest[] = [];
  const fetcher: AppFetcher = vi.fn(async (_app, request) => {
    seen.push(request);
    const url = new URL(request.url);
    const pick = (given: AppFetchResponse | Error | undefined, fallback: AppFetchResponse) => {
      if (given instanceof Error) throw given;
      return given ?? fallback;
    };
    if (url.hostname === 'stooq.com')
      return url.pathname.startsWith('/q/d/')
        ? pick(answers.daily, ok(DAILY))
        : pick(answers.quote, ok(QUOTE));
    if (url.hostname === 'www.sec.gov') return pick(answers.tickers, ok(TICKERS));
    if (url.hostname === 'data.sec.gov') {
      const tag = url.pathname.split('/').at(-1)?.replace('.json', '') ?? '';
      if (answers.concept) {
        const given = answers.concept(tag);
        if (given instanceof Error) throw given;
        return given;
      }
      if (tag === 'RevenueFromContractWithCustomerExcludingAssessedTax') return ok(REVENUE);
      if (tag === 'NetIncomeLoss') return ok(NET_INCOME);
      if (tag === 'EarningsPerShareDiluted') return ok(EPS);
      if (tag === 'EntityCommonStockSharesOutstanding') return ok(SHARES);
      return gone(404);
    }
    if (url.hostname === 'query1.finance.yahoo.com') return pick(answers.yahoo, ok(YAHOO));
    return gone(404);
  });
  const source = new FinanceSource({ fetcher, now: () => NOW });
  return { fetcher, seen, source, tools: financeTools(ctx, { source }) };
}

const tool = (tools: ReturnType<typeof financeTools>, name: string) => {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`no ${name} tool`);
  return found;
};

const run = async (
  tools: ReturnType<typeof financeTools>,
  name: string,
  args: Record<string, unknown>,
) => {
  const result = await tool(tools, name).run(args);
  if (typeof result === 'string' || !result.view) throw new Error('no view');
  return { text: JSON.parse(result.text) as Record<string, unknown>, view: result.view };
};

// ── Reading what the services send ──────────────────────────────────────────

describe('a symbol as each service knows it', () => {
  it('turns what people write into Stooq’s own form', () => {
    expect(stooqSymbol('AAPL')).toMatchObject({ s: 'aapl.us', yahoo: 'AAPL', class: 'stock' });
    expect(stooqSymbol('$msft')).toMatchObject({ s: 'msft.us' });
    expect(stooqSymbol('^GSPC')).toMatchObject({ s: '^spx', class: 'index' });
    expect(stooqSymbol('^spx')).toMatchObject({ s: '^spx', class: 'index' });
    expect(stooqSymbol('BTC')).toMatchObject({ s: 'btcusd', yahoo: 'BTC-USD', class: 'crypto' });
    expect(stooqSymbol('BTC-USD')).toMatchObject({ s: 'btcusd', class: 'crypto' });
    expect(stooqSymbol('EURUSD')).toMatchObject({ s: 'eurusd', yahoo: 'EURUSD=X', class: 'fx' });
    expect(stooqSymbol('EUR/USD')).toMatchObject({ s: 'eurusd', class: 'fx' });
    // A Paris listing: Yahoo's suffix in, Stooq's country suffix out, and back.
    expect(stooqSymbol('AIR.PA')).toMatchObject({ s: 'air.fr', yahoo: 'AIR.PA' });
    expect(stooqSymbol('air.fr')).toMatchObject({ s: 'air.fr', yahoo: 'AIR.PA' });
  });

  it('says nothing for what isn’t a symbol at all', () => {
    for (const text of ['', '   ', 'tell me about apple', 'a'.repeat(40), '<script>', 'AAPL.ZZ'])
      expect(stooqSymbol(text)).toBeUndefined();
  });
});

describe('Stooq’s CSV', () => {
  it('reads a quote row by its own header', () => {
    expect(parseStooqQuote(QUOTE, 'AAPL')).toEqual({
      symbol: 'AAPL',
      name: 'APPLE',
      price: 257.2,
      open: 255.5,
      high: 258.3,
      low: 254.1,
      volume: 41_234_567,
      asOf: '2026-10-07T22:00:04Z',
      source: 'Stooq',
    });
  });

  it('reads “no such symbol” as nothing, never as a zero', () => {
    expect(parseStooqQuote(MISSING, 'NOTATICKER')).toBeUndefined();
    expect(parseStooqQuote('', 'X')).toBeUndefined();
    expect(parseStooqQuote('Symbol,Date,Close\nX,2026-10-07,0\n', 'X')).toBeUndefined();
  });

  it('reads the daily file oldest first, dropping rows that aren’t prices', () => {
    const history = parseStooqDaily(DAILY);
    expect(history?.dates[0]).toBe('2026-09-28');
    expect(history?.dates.at(-1)).toBe('2026-10-07');
    expect(history?.closes.at(-1)).toBe(257.2);
    expect(history?.source).toBe('Stooq (daily closes)');
    expect(parseStooqDaily('No data')).toBeUndefined();
    expect(parseStooqDaily('Exceeded the daily hits limit')).toBeUndefined();
  });
});

describe('Yahoo’s chart answer, the fallback', () => {
  it('reads the price, the currency and the closes, and survives a change of shape', () => {
    const read = parseYahooChart(JSON.parse(YAHOO));
    expect(read.quote).toMatchObject({ price: 214.3, currency: 'EUR', source: 'Yahoo Finance' });
    expect(read.history?.closes).toEqual([209.5, 210.8, 211.8, 214.3]);
    // An endpoint that changed, or an error: nothing, never a half-read number.
    expect(parseYahooChart({ chart: { result: null, error: 'Not Found' } })).toEqual({});
    expect(parseYahooChart('nonsense')).toEqual({});
  });
});

describe('the regulator’s own lists', () => {
  const index = parseFilers(JSON.parse(TICKERS));

  it('finds a filer by ticker and by name', () => {
    expect(findFiler(index, 'AAPL')).toMatchObject({ cik: '320193', ticker: 'AAPL' });
    expect(findFiler(index, 'apple')).toMatchObject({ ticker: 'AAPL' });
    expect(findFiler(index, 'Microsoft')).toMatchObject({ ticker: 'MSFT' });
    expect(findFiler(index, 'amazon')).toMatchObject({ ticker: 'AMZN' });
  });

  it('finds nobody for a company that doesn’t file here', () => {
    expect(findFiler(index, 'AIR.PA')).toBeUndefined();
    expect(findFiler(index, 'Airbus')).toBeUndefined();
    expect(findFiler(index, 'NOTATICKER')).toBeUndefined();
  });

  it('keeps only whole years, from the latest filing that reported each', () => {
    const units = (JSON.parse(REVENUE) as { units: Record<string, unknown> }).units;
    const years = periodFigures(units, 'USD', 'annual', 12);
    expect(years.map((p) => p.period)).toEqual(['CY2023', 'CY2024', 'CY2025']);
    expect(years.at(-1)).toMatchObject({
      value: 416_161_000_000,
      periodEnd: '2025-09-27',
      form: '10-K',
      filed: '2025-10-30',
    });
    // A quarter inside a 10-K, and a 10-Q quarter, are quarters — never a year.
    const quarters = periodFigures(units, 'USD', 'quarterly', 12);
    expect(quarters.map((p) => p.periodEnd)).toEqual(['2025-09-27', '2025-12-27']);
  });

  it('prefers the newest filing when a figure was restated', () => {
    const units = (JSON.parse(NET_INCOME) as { units: Record<string, unknown> }).units;
    expect(periodFigures(units, 'USD', 'annual', 12).at(-1)?.value).toBe(112_010_000_000);
  });
});

describe('thinning a series', () => {
  it('keeps the first and the last, whatever the size', () => {
    expect(thin([1, 2, 3], 10)).toEqual([1, 2, 3]);
    const long = Array.from({ length: 500 }, (_, i) => i);
    const few = thin(long, 80);
    expect(few).toHaveLength(80);
    expect(few[0]).toBe(0);
    expect(few.at(-1)).toBe(499);
  });
});

describe('what a price’s timestamp can honestly say', () => {
  it('calls a session that ended on an earlier day closed, and nothing else', () => {
    expect(stateOf('2026-10-07T22:00:04Z', NOW)).toBe('closed');
    expect(stateOf('2026-10-09T18:00:00Z', NOW)).toBe('unknown');
    expect(stateOf('not a time', NOW)).toBe('unknown');
  });
});

// ── The tools ───────────────────────────────────────────────────────────────

describe('the quote tool', () => {
  it('prices a ticker, charts it, and logs a card exactly as it drew it', async () => {
    const { tools, seen, source } = services();
    const { text, view } = await run(tools, 'quote', { symbols: ['AAPL'], period: '1M' });
    expect(view.kind).toBe('quotes');
    if (view.kind !== 'quotes') return;
    expect(QuotesView.safeParse(view).success).toBe(true);
    expect(ToolView.safeParse(view).success).toBe(true);
    expect(cleanView(view)).toEqual(view);
    const quote = view.items[0];
    expect(quote).toMatchObject({
      symbol: 'AAPL',
      name: 'APPLE',
      currency: 'USD',
      class: 'stock',
      price: 257.2,
      previousClose: 255.5,
      dayRange: { low: 254.1, high: 258.3 },
      volume: 41_234_567,
      // Nothing here promises a live tick, so the card always says delayed.
      delayed: true,
      dayState: 'closed',
      source: 'Stooq',
    });
    expect(quote?.change).toBeCloseTo(1.7, 4);
    expect(quote?.changePercent).toBeCloseTo(0.666, 2);
    // What the company is worth is worked out, and says from which share count.
    expect(quote?.marketCap).toMatchObject({ shares: 14_840_390_000, filed: '2025-10-30' });
    expect(quote?.marketCap?.value).toBe(Math.round(14_840_390_000 * 257.2));
    expect(view.series?.[0]?.dates).toHaveLength(8);
    expect(view.series?.[0]?.source).toBe('Stooq (daily closes)');
    // The model is told the card has the numbers, and told not to advise.
    expect(text.note).toMatch(/delayed closes, never live ticks/);
    expect(text.note).toMatch(/not financial advice/);
    // Only the symbol and the range leave this computer.
    expect([...new Set(seen.map((r) => new URL(r.url).hostname))].sort()).toEqual([
      'data.sec.gov',
      'stooq.com',
      'www.sec.gov',
    ]);
    const priced = seen.find((r) => new URL(r.url).pathname.startsWith('/q/l/'));
    expect(new URL(priced?.url ?? '').searchParams.get('s')).toBe('aapl.us');
    // EDGAR asks every client to name itself; the public fetcher does.
    const edgar = seen.find((r) => new URL(r.url).hostname === 'data.sec.gov');
    expect(edgar?.headers?.['user-agent']).toMatch(/Conch/);
    expect(source.cached).toBeGreaterThan(0);
  });

  it('names a symbol nobody has instead of pricing it', async () => {
    const { tools } = services({
      quote: ok(MISSING),
      daily: ok('No data'),
      yahoo: gone(404),
    });
    await expect(
      tool(tools, 'quote').run({ symbols: ['NOTATICKER'], period: '1M' }),
    ).rejects.toThrow(/No public source here had a price for “NOTATICKER”/);
  });

  it('keeps the prices it has and names the one it doesn’t', async () => {
    const { tools } = services({ yahoo: gone(404) });
    // The second isn't a symbol at all, so nothing is ever asked of a service for it.
    const { text, view } = await run(tools, 'quote', { symbols: ['AAPL', 'tell me everything'] });
    if (view.kind !== 'quotes') throw new Error('no quotes');
    expect(view.items).toHaveLength(1);
    expect(view.missing).toEqual(['tell me everything']);
    expect(text.ifNotFound).toMatch(/Never make a price up/);
  });

  it('falls back to Yahoo for a listing Stooq hasn’t, and says whose price it is', async () => {
    const { tools } = services({ quote: ok(MISSING), daily: ok('No data') });
    const { view } = await run(tools, 'quote', { symbols: ['AIR.PA'] });
    if (view.kind !== 'quotes') throw new Error('no quotes');
    expect(view.items[0]).toMatchObject({
      symbol: 'AIR.PA',
      price: 214.3,
      currency: 'EUR',
      source: 'Yahoo Finance',
      delayed: true,
    });
    expect(view.series?.[0]?.source).toBe('Yahoo Finance (daily closes)');
  });

  it('turns a company’s name into its ticker, and overlays a comparison', async () => {
    const { tools } = services();
    const { view } = await run(tools, 'quote', {
      symbols: ['Apple', 'Microsoft'],
      compare: true,
    });
    if (view.kind !== 'quotes') throw new Error('no quotes');
    expect(view.items.map((q) => q.symbol)).toEqual(['AAPL', 'MSFT']);
    expect(view.compare).toBe(true);
    expect(view.series).toHaveLength(2);
  });

  it('asks a service once for the same price, however many times it’s wanted', async () => {
    const { tools, fetcher, source } = services();
    await run(tools, 'quote', { symbols: ['AAPL'] });
    const first = (fetcher as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await run(tools, 'quote', { symbols: ['AAPL', 'aapl', 'Apple'] });
    expect((fetcher as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(first);
    expect(source.cached).toBeGreaterThan(0);
  });

  it('never invents a price when a service won’t answer', async () => {
    const { tools } = services({
      quote: new Error('socket hang up'),
      daily: new Error('socket hang up'),
      yahoo: new Error('socket hang up'),
    });
    await expect(tool(tools, 'quote').run({ symbols: ['AAPL'] })).rejects.toThrow(
      /No public source here had a price/,
    );
  });

  it('leaves out every field a service didn’t send', async () => {
    const { tools } = services({
      quote: ok('Symbol,Date,Close\nAAPL.US,2026-10-07,257.2\n'),
      daily: ok('No data'),
      yahoo: gone(404),
    });
    const { view } = await run(tools, 'quote', { symbols: ['AAPL'] });
    if (view.kind !== 'quotes') throw new Error('no quotes');
    const quote = view.items[0];
    expect(quote?.price).toBe(257.2);
    expect(quote?.open).toBeUndefined();
    expect(quote?.dayRange).toBeUndefined();
    expect(quote?.volume).toBeUndefined();
    expect(quote?.spark).toBeUndefined();
    expect(view.series).toBeUndefined();
  });
});

describe('the price_history tool', () => {
  it('charts one symbol over a range, with the dates it covers', async () => {
    const { tools, seen } = services();
    const { view } = await run(tools, 'price_history', { symbol: 'AAPL', period: '1Y' });
    if (view.kind !== 'quotes') throw new Error('no quotes');
    expect(view.series?.[0]).toMatchObject({ symbol: 'AAPL', period: '1Y', currency: 'USD' });
    expect(view.series?.[0]?.note).toBe('Daily closes from 2026-09-28 to 2026-10-07.');
    // The range asked for is a window of dates, not the whole file.
    const daily = seen.find((r) => new URL(r.url).pathname.startsWith('/q/d/'));
    expect(new URL(daily?.url ?? '').searchParams.get('d1')).toBe('20251003');
    expect(new URL(daily?.url ?? '').searchParams.get('d2')).toBe('20261009');
  });

  it('says plainly when nobody has a history', async () => {
    const { tools } = services({ daily: ok('No data'), yahoo: gone(404) });
    await expect(
      tool(tools, 'price_history').run({ symbol: 'AAPL', period: '5Y' }),
    ).rejects.toThrow(/No public source here had a price history/);
  });
});

describe('the fundamentals tool', () => {
  it('reads the filings, each figure with its period and filing date', async () => {
    const { tools } = services();
    const { text, view } = await run(tools, 'fundamentals', { companies: ['AAPL'] });
    expect(view.kind).toBe('fundamentals');
    if (view.kind !== 'fundamentals') return;
    expect(FundamentalsView.safeParse(view).success).toBe(true);
    expect(cleanView(view)).toEqual(view);
    expect(view.source).toBe('SEC EDGAR');
    const company = view.items[0];
    expect(company).toMatchObject({ symbol: 'AAPL', name: 'Apple Inc.', cik: '320193' });
    expect(company?.revenue?.points.map((p) => p.period)).toEqual(['CY2023', 'CY2024', 'CY2025']);
    expect(company?.revenue?.points.at(-1)).toMatchObject({
      value: 416_161_000_000,
      form: '10-K',
      filed: '2025-10-30',
    });
    expect(company?.revenue?.tag).toBe('RevenueFromContractWithCustomerExcludingAssessedTax');
    expect(company?.netIncome?.points.at(-1)?.value).toBe(112_010_000_000);
    expect(company?.eps?.points.at(-1)?.value).toBe(7.48);
    // Price ÷ earnings is worked out, so it carries the price and the period.
    expect(company?.priceEarnings).toMatchObject({ price: 257.2, period: 'CY2025' });
    expect(company?.priceEarnings?.value).toBeCloseTo(257.2 / 7.48, 2);
    // Nothing was filed for these, so nothing is there.
    expect(company?.grossProfit).toBeUndefined();
    expect(company?.dividendPerShare).toBeUndefined();
    expect(company?.employees).toBeUndefined();
    expect(company?.unavailable).toBeUndefined();
    expect(text.note).toMatch(/not financial advice/);
  });

  it('says a company that files elsewhere has no figures, rather than inventing them', async () => {
    const { tools } = services({ quote: ok(MISSING), daily: ok('No data') });
    const { view } = await run(tools, 'fundamentals', { companies: ['AIR.PA'] });
    if (view.kind !== 'fundamentals') throw new Error('no fundamentals');
    const company = view.items[0];
    expect(company?.unavailable).toMatch(/doesn’t file with the US SEC/);
    expect(company?.revenue).toBeUndefined();
    expect(company?.netIncome).toBeUndefined();
    expect(company?.eps).toBeUndefined();
    expect(company?.priceEarnings).toBeUndefined();
  });

  it('says an index or a coin has no accounts to read', async () => {
    const { tools } = services();
    const { view } = await run(tools, 'fundamentals', { companies: ['^SPX', 'BTC-USD'] });
    if (view.kind !== 'fundamentals') throw new Error('no fundamentals');
    expect(view.items[0]?.unavailable).toMatch(/no fundamentals for an index/);
    expect(view.items[1]?.unavailable).toMatch(/is a coin: it files no accounts/);
  });

  it('says a US filer with nothing filed yet has nothing, and keeps no figures', async () => {
    const { tools } = services({ concept: () => gone(404) });
    const { view } = await run(tools, 'fundamentals', { companies: ['AAPL'] });
    if (view.kind !== 'fundamentals') throw new Error('no fundamentals');
    expect(view.items[0]?.unavailable).toMatch(/no annual XBRL figures filed/);
    expect(view.items[0]?.currency).toBeUndefined();
  });

  it('compares up to four companies and no more', async () => {
    const { tools } = services();
    const { view } = await run(tools, 'fundamentals', {
      companies: ['AAPL', 'MSFT', 'AMZN', 'ACN', 'AAPL'],
    });
    if (view.kind !== 'fundamentals') throw new Error('no fundamentals');
    expect(view.items.map((c) => c.symbol)).toEqual(['AAPL', 'MSFT', 'AMZN', 'ACN']);
  });

  it('carries on when EDGAR fails for one measure', async () => {
    const { tools } = services({
      concept: (tag) =>
        tag === 'NetIncomeLoss' || tag === 'ProfitLoss' ? new Error('reset') : ok(REVENUE),
    });
    const { view } = await run(tools, 'fundamentals', { companies: ['AAPL'] });
    if (view.kind !== 'fundamentals') throw new Error('no fundamentals');
    expect(view.items[0]?.revenue?.points).toHaveLength(3);
    expect(view.items[0]?.netIncome).toBeUndefined();
  });
});

describe('GET /api/finance/history, what a card’s range switch asks for', () => {
  const open: { close(): Promise<void> }[] = [];
  afterEach(async () => {
    while (open.length) await open.pop()?.close();
  });

  function route(answers: Answers = {}) {
    const made = services(answers);
    const app = Fastify();
    registerFinanceRoutes(app, made.source);
    open.push(app);
    return { app, ...made };
  }

  it('sends the daily closes for a range, and never caches them in the browser', async () => {
    const { app } = route();
    const reply = await app.inject({ url: '/api/finance/history?symbol=AAPL&period=3M' });
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('no-store');
    const body = reply.json<{ series: unknown }>();
    expect(PriceSeries.safeParse(body.series).success).toBe(true);
    const series = PriceSeries.parse(body.series);
    expect(series.period).toBe('3M');
    expect(series.closes.at(-1)).toBe(257.2);
    expect(series.source).toBe('Stooq (daily closes)');
  });

  it('refuses anything that isn’t a symbol and a known range', async () => {
    const { app, fetcher } = route();
    for (const query of [
      '',
      '?symbol=',
      '?symbol=AAPL&period=forever',
      `?symbol=${encodeURIComponent('a'.repeat(40))}`,
      `?symbol=${encodeURIComponent('<script>alert(1)</script>')}`,
      `?symbol=${encodeURIComponent('aapl.us https://evil.example/')}`,
    ])
      expect((await app.inject({ url: `/api/finance/history${query}` })).statusCode).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('says plainly when no source has that history', async () => {
    const { app } = route({ daily: ok('No data'), yahoo: gone(404) });
    const reply = await app.inject({ url: '/api/finance/history?symbol=AAPL&period=MAX' });
    expect(reply.statusCode).toBe(404);
    expect(reply.json<{ message: string }>().message).toMatch(/No public source here has MAX/);
  });

  it('asks a service once, however often the range is switched back', async () => {
    const { app, fetcher } = route();
    const calls = () => (fetcher as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await app.inject({ url: '/api/finance/history?symbol=AAPL&period=1Y' });
    const first = calls();
    await app.inject({ url: '/api/finance/history?symbol=AAPL&period=1Y' });
    expect(calls()).toBe(first);
  });
});
