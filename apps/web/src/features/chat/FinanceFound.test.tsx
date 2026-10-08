import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from './ChatView';

afterEach(() => vi.unstubAllGlobals());

/** A chat of its own per test: the live store keeps what each chat has seen. */
function push(chat: string, seq: number, event: Record<string, unknown>) {
  FakeSocket.last?.push({
    type: 'conversation.event',
    event: { conversationId: chat, seq, at: 1000 + seq, ...event },
  } as never);
}

const series = (period: string, closes: number[], from = 1) => ({
  symbol: 'AAPL',
  period,
  dates: closes.map((_, i) => `2026-09-${String(from + i).padStart(2, '0')}`),
  closes,
  currency: 'USD',
  source: 'Stooq (daily closes)',
});

const quote = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  currency: 'USD',
  class: 'stock',
  price: 257.2,
  change: 1.7,
  changePercent: 0.67,
  asOf: '2026-10-07T22:00:04Z',
  delayed: true,
  previousClose: 255.5,
  dayRange: { low: 254.1, high: 258.3 },
  volume: 41_234_567,
  dayState: 'closed',
  spark: { period: '1M', values: [250, 252, 257.2] },
  source: 'Stooq',
};

describe('prices a tool found, in the chat', () => {
  it('stands in sight as a card, delayed and sourced, and the range switch asks the gateway', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/finance/history': () => ({ series: series('1Y', [200, 220, 257.2]) }),
    });
    renderApp(<ChatView conversationId="c1" />, { route: '/c/c1' });
    await screen.findByRole('textbox', { name: 'Message Conch' });
    act(() => {
      push('c1', 0, { type: 'user.message', messageId: 'u1', text: 'What’s AAPL at?' });
      push('c1', 1, {
        type: 'tool.started',
        toolUseId: 't1',
        name: 'mcp__conch__quote',
        input: { symbols: ['AAPL'], period: '1M' },
      });
      push('c1', 2, {
        type: 'tool.finished',
        toolUseId: 't1',
        status: 'success',
        output: '{"quotes":[]}',
        view: { kind: 'quotes', items: [quote], series: [series('1M', [250, 252, 257.2])] },
      });
    });
    const card = await screen.findByRole('region', { name: 'Apple Inc. price' });
    expect(card).toHaveTextContent('$257.20');
    expect(card).toHaveTextContent(/Closed · as of .* · delayed/);
    expect(card).toHaveTextContent(
      /Stooq · delayed, not live · daily closes · not financial advice/,
    );

    const range = within(card).getByRole('radiogroup', { name: 'Range' });
    await userEvent.click(within(range).getByRole('radio', { name: '1Y' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'GET' && c.path.startsWith('/api/finance/history')),
      ).toBe(true),
    );
    const asked = calls.find((c) => c.path.startsWith('/api/finance/history'))?.path ?? '';
    expect(asked).toContain('symbol=AAPL');
    expect(asked).toContain('period=1Y');
    // Nothing was sent to the conversation: a range is a read, not a turn.
    expect(calls.some((c) => c.method === 'POST' && c.path.includes('/messages'))).toBe(false);
  });

  it('draws filed figures as their own card, from SEC EDGAR', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
    });
    renderApp(<ChatView conversationId="c2" />, { route: '/c/c2' });
    await screen.findByRole('textbox', { name: 'Message Conch' });
    act(() => {
      push('c2', 0, {
        type: 'user.message',
        messageId: 'u1',
        text: 'How is Apple doing financially?',
      });
      push('c2', 1, {
        type: 'tool.started',
        toolUseId: 't2',
        name: 'mcp__conch__fundamentals',
        input: { companies: ['AAPL'] },
      });
      push('c2', 2, {
        type: 'tool.finished',
        toolUseId: 't2',
        status: 'success',
        output: '{"companies":[]}',
        view: {
          kind: 'fundamentals',
          source: 'SEC EDGAR',
          items: [
            {
              symbol: 'AAPL',
              name: 'Apple Inc.',
              cik: '320193',
              currency: 'USD',
              basis: 'annual',
              revenue: {
                label: 'Revenue',
                unit: 'currency',
                tag: 'Revenues',
                points: [
                  { value: 391_035_000_000, period: 'CY2024', form: '10-K', filed: '2024-11-01' },
                  { value: 416_161_000_000, period: 'CY2025', form: '10-K', filed: '2025-10-30' },
                ],
              },
            },
          ],
        },
      });
    });
    const card = await screen.findByRole('region', { name: 'Apple Inc. from filings' });
    expect(card).toHaveTextContent(/From SEC EDGAR filings/);
    expect(card).toHaveTextContent(/up 6\.43% on CY2024/);
    expect(card).toHaveTextContent(/not financial advice/);
  });
});

const coin = {
  symbol: 'UNI',
  name: 'Uniswap',
  currency: 'EUR',
  class: 'crypto',
  price: 9.12,
  change: -0.14,
  changePercent: -1.5,
  asOf: '2026-10-09T21:04:11Z',
  delayed: true,
  dayState: 'always',
  crypto: {
    id: 'uniswap',
    rank: 25,
    marketCap: 5_480_000_000,
    supply: { circulating: 600_483_073, max: 1e9 },
    ath: { price: 41.5, date: '2021-05-03T05:25:04Z', fromPercent: -78 },
    changes: { '1h': 0.05, '24h': -1.5, '7d': -3.1, '30d': 6.4, '1y': 22 },
    alternatives: [{ id: 'unicorn-token', symbol: 'UNI', name: 'Unicorn Token', rank: 3412 }],
    source: 'CoinGecko',
  },
  source: 'CoinGecko',
};

describe('coins a tool found, in the chat', () => {
  it('is the coin’s own card, 24/7, and a chip asks for that very coin, in its currency', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/finance/history': () => ({
        series: { ...series('1W', [9.4, 9.2, 9.12]), symbol: 'UNI', currency: 'EUR' },
      }),
    });
    renderApp(<ChatView conversationId="c3" />, { route: '/c/c3' });
    await screen.findByRole('textbox', { name: 'Message Conch' });
    act(() => {
      push('c3', 0, { type: 'user.message', messageId: 'u1', text: 'What’s UNI at?' });
      push('c3', 1, {
        type: 'tool.started',
        toolUseId: 't3',
        name: 'mcp__conch__quote',
        input: { symbols: ['UNI'] },
      });
      push('c3', 2, {
        type: 'tool.finished',
        toolUseId: 't3',
        status: 'success',
        output: '{"quotes":[]}',
        view: {
          kind: 'quotes',
          items: [coin],
          series: [
            {
              ...series('1M', [8.6, 8.9, 9.12]),
              symbol: 'UNI',
              currency: 'EUR',
              source: 'CoinGecko (hourly)',
            },
          ],
        },
      });
    });
    const card = await screen.findByRole('region', { name: 'Uniswap price' });
    expect(card).toHaveTextContent(/24\/7 · as of/);
    expect(card).toHaveTextContent(/Also “UNI”: Unicorn Token/);
    expect(card).toHaveTextContent(/not one exchange’s price · not live · not financial advice/);
    // It keeps its share bar, as every money card does.
    expect(within(card).getAllByRole('button').length).toBeGreaterThan(1);

    const chips = within(card).getByRole('radiogroup', {
      name: 'Moves, and the range the chart draws',
    });
    await userEvent.click(within(chips).getByRole('radio', { name: /Last 7 days/ }));
    await waitFor(() =>
      expect(calls.some((c) => c.path.startsWith('/api/finance/history'))).toBe(true),
    );
    const asked = calls.find((c) => c.path.startsWith('/api/finance/history'))?.path ?? '';
    expect(asked).toContain('symbol=UNI');
    expect(asked).toContain('period=1W');
    expect(asked).toContain('coin=uniswap');
    expect(asked).toContain('currency=EUR');
  });

  it('draws crypto as a whole as its own card, standing in sight', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
    });
    renderApp(<ChatView conversationId="c4" />, { route: '/c/c4' });
    await screen.findByRole('textbox', { name: 'Message Conch' });
    act(() => {
      push('c4', 0, { type: 'user.message', messageId: 'u1', text: 'How’s crypto doing?' });
      push('c4', 1, {
        type: 'tool.started',
        toolUseId: 't4',
        name: 'mcp__conch__crypto_market',
        input: {},
      });
      push('c4', 2, {
        type: 'tool.finished',
        toolUseId: 't4',
        status: 'success',
        output: '{"market":{}}',
        view: {
          kind: 'crypto-market',
          currency: 'USD',
          totalMarketCap: 2.41e12,
          change24h: 1.23,
          dominance: { btc: 54.62, eth: 13.21 },
          coins: [
            { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1, price: 67_187 },
            { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', rank: 2, price: 2612.4 },
          ],
          asOf: '2026-10-09T21:04:11Z',
          source: 'CoinGecko',
        },
      });
    });
    const card = await screen.findByRole('region', { name: 'The crypto market' });
    expect(card).toHaveTextContent(/up 1\.23% in 24 hours/);
    expect(within(card).getByRole('table', { name: 'The biggest coins' })).toBeInTheDocument();
    expect(card).toHaveTextContent(/Everything else\s*32\.17%/);
  });
});
