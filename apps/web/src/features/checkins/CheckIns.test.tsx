/** Standing orders, the check-in and the morning's note, in the app (ADR 0107). */
import type {
  CheckInStatus,
  LearnedEntry,
  LearningStatus,
  Memory,
  StandingOrder,
  TidyStatus,
} from '@conch/protocol';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { morningDigest } from '../memory/digest';
import { MorningNote } from '../memory/MorningNote';
import { CheckInSection, checkInLine, orderItem } from './CheckInSection';
import { StandingOrderChatCard } from './StandingOrderChatCard';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const NOW = Date.now();

const order = (over: Partial<StandingOrder> = {}): StandingOrder => ({
  id: 'so_1',
  text: 'Always tell me if a flight changes',
  kind: 'tell',
  state: 'on',
  from: 'you',
  createdAt: 1,
  updatedAt: 1,
  told: 0,
  ...over,
});

const status = (over: Partial<CheckInStatus> = {}): CheckInStatus => ({
  on: true,
  quiet: { from: '22:00', to: '07:00' },
  everyMinutes: 30,
  state: 'watching',
  lastLookAt: NOW - 12 * 60_000,
  nextLookAt: NOW + 18 * 60_000,
  month: { looks: 40, woke: 2, usd: 0.002 },
  told: [],
  ...over,
});

describe('the check-in’s words', () => {
  it('says what it watches for, when it looked, and that quiet looks are free', () => {
    expect(checkInLine(status(), 2, NOW)).toBe(
      'Watching for 2 things · looked 12 minutes ago · free until something’s new',
    );
    expect(checkInLine(status({ month: { looks: 1, woke: 1, usd: 0.42 } }), 1, NOW)).toContain(
      '$0.42 this month',
    );
    expect(checkInLine(status({ state: 'off' }), 1, NOW)).toMatch(/^Turn it on/);
  });

  it('says how often an order brought news', () => {
    expect(orderItem(order({ told: 2, lastToldAt: NOW - 60_000 }), NOW).meta).toBe(
      'Told you twice · last 1 minute ago',
    );
    expect(orderItem(order()).meta).toBeUndefined();
  });
});

describe('Check-ins and standing orders', () => {
  it('adds an order in your words and shows what the check-in told you, with why', async () => {
    const user = userEvent.setup();
    let orders = [order({ told: 1 })];
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/standing-orders': () => ({ orders }),
      'POST /api/standing-orders': (body) => {
        const added = order({ id: 'so_2', text: (body as { text: string }).text, kind: 'may' });
        orders = [...orders, added];
        return added;
      },
      'GET /api/checkin': () =>
        status({
          told: [
            {
              id: 't1',
              at: NOW - 60_000,
              source: 'mail',
              label: 'Lufthansa’s email “LH 452”',
              note: 'Departure moved to 18:40',
              why: 'You asked: “Always tell me if a flight changes”',
              orderId: 'so_1',
            },
          ],
        }),
    });
    renderApp(<CheckInSection />);
    expect(await screen.findByText('Departure moved to 18:40')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Why?' }));
    expect(screen.getByText('You asked: “Always tell me if a flight changes”')).toBeVisible();
    await user.type(
      screen.getByRole('textbox', { name: 'A new standing order, in your words' }),
      'You may archive newsletters',
    );
    expect(screen.getByText(/something you welcome/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/standing-orders')).toBe(
        true,
      ),
    );
    expect(await screen.findByText('You may archive newsletters')).toBeInTheDocument();
  });

  it('says a refusal beside the field, in the gateway’s words', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/standing-orders': () => ({ orders: [order()] }),
      'POST /api/standing-orders': () =>
        new Response(
          JSON.stringify({
            error: 'same',
            message: 'There’s already a standing order that says that.',
          }),
          { status: 409 },
        ),
      'GET /api/checkin': () => status(),
    });
    renderApp(<CheckInSection />);
    await user.type(
      await screen.findByRole('textbox', { name: 'A new standing order, in your words' }),
      'Always tell me if a flight changes{Enter}',
    );
    expect(
      await screen.findByText('There’s already a standing order that says that.'),
    ).toBeInTheDocument();
  });

  it('turns the check-in off with its switch', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/standing-orders': () => ({ orders: [order()] }),
      'GET /api/checkin': () => status(),
      'PUT /api/checkin': () => status({ on: false, state: 'off' }),
    });
    renderApp(<CheckInSection />);
    await user.click(await screen.findByRole('switch', { name: 'Check in on things' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ on: false }));
  });
});

describe('the card a suggestion leaves in its chat', () => {
  it('keeps the order only when you press Keep it', async () => {
    const user = userEvent.setup();
    let state: StandingOrder['state'] = 'draft';
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/standing-orders': () => ({ orders: [order({ state, from: 'chat' })] }),
      'PATCH /api/standing-orders/so_1': () => {
        state = 'on';
        return order({ state });
      },
    });
    renderApp(<StandingOrderChatCard orderId="so_1" text="Always tell me if a flight changes" />);
    await user.click(await screen.findByRole('button', { name: 'Keep it' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ state: 'on' }),
    );
    expect(await screen.findByText(/Kept as a standing order/)).toBeInTheDocument();
  });

  it('says Not kept once the suggestion is gone', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/standing-orders': () => ({ orders: [] }),
    });
    renderApp(<StandingOrderChatCard orderId="so_9" text="Tell me when Anna writes" />);
    expect(await screen.findByText(/Not kept/)).toBeInTheDocument();
  });
});

const memory = (content: string, id = content): Memory =>
  ({
    id,
    content,
    kind: 'fact',
    source: 'agent',
    createdAt: 1,
    updatedAt: 1,
  }) as Memory;

const learned = (over: Partial<LearnedEntry> = {}): LearnedEntry => ({
  id: 'le_1',
  at: NOW - 3_600_000,
  change: 'added',
  after: memory('Prefers TypeScript'),
  why: '',
  from: { trigger: 'idle', quotes: [], signals: [] },
  state: 'applied',
  seen: 1,
  ...over,
});

const learning = (entries: LearnedEntry[]): LearningStatus => ({
  on: true,
  entries,
  waiting: 0,
  never: [],
  past: [],
  spending: { limitUsd: 1, isDefault: true, monthUsd: 0 },
  quiet: [],
});

const tidy = (at: number): TidyStatus => ({
  nightly: true,
  running: false,
  lastAt: at,
  runs: [
    {
      id: 'tr_1',
      at,
      trigger: 'nightly',
      model: true,
      changes: [
        {
          id: 'tc_1',
          kind: 'merged',
          why: '',
          before: [memory('Has a daughter'), memory('Daughter is Mia')],
          after: memory('Has a daughter, Mia'),
          state: 'applied',
        },
        {
          id: 'tc_2',
          kind: 'added',
          why: '',
          before: [],
          after: memory('Waiting one'),
          state: 'pending',
        },
      ],
    },
  ],
});

describe('the morning’s note', () => {
  it('lists only what was applied since you last looked, a day back at most', () => {
    const digest = morningDigest({
      learning: learning([
        learned(),
        learned({
          id: 'le_2',
          change: 'superseded',
          before: memory('Lives in Berlin'),
          after: memory('Lives in Lisbon'),
        }),
        learned({ id: 'le_3', at: NOW - 3 * 86_400_000, after: memory('Old news') }),
        learned({ id: 'le_4', state: 'waiting', after: memory('Held one') }),
      ]),
      tidy: tidy(NOW - 2 * 3_600_000),
      seenAt: 0,
      now: NOW,
      hour: 8,
    });
    expect(digest?.title).toBe('While you slept');
    expect(digest?.items.map((i) => i.text)).toEqual([
      'Prefers TypeScript',
      'Lives in Lisbon',
      'Has a daughter, Mia',
    ]);
    expect(digest?.items[1]).toMatchObject({ kind: 'replaced', was: 'Lives in Berlin' });
    expect(digest?.items[2]?.undo).toEqual({ from: 'tidy', runId: 'tr_1', changeId: 'tc_1' });
  });

  it('is nothing at all once you put it away, or when all of it was undone', () => {
    const input = { learning: learning([learned()]), now: NOW, hour: 8 };
    expect(morningDigest({ ...input, seenAt: NOW })).toBeUndefined();
    expect(
      morningDigest({ ...input, learning: learning([learned({ state: 'undone' })]), seenAt: 0 }),
    ).toBeUndefined();
    expect(morningDigest({ ...input, seenAt: 0 })?.title).toBe('Since you last looked');
  });

  it('undoes one line with the answer that line needs, then folds away', async () => {
    const user = userEvent.setup();
    let entries = [learned()];
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/learning': () => learning(entries),
      'GET /api/memory/tidy': () => ({ nightly: true, running: false, runs: [] }),
      'GET /api/memories': () => [],
      'POST /api/learning/answer': () => {
        entries = [learned({ state: 'undone' }), learned({ id: 'le_2', after: memory('Other') })];
        return entries[0];
      },
    });
    renderApp(<MorningNote />);
    await user.click(await screen.findByRole('button', { name: 'Undo “Prefers TypeScript”' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/learning/answer')?.body).toEqual({
        entryId: 'le_1',
        answer: 'undo',
      }),
    );
    expect(await screen.findByText('Undone')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: /slept|looked/ })).toBeNull());
  });
});
