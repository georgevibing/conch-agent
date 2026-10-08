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
