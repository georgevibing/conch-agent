import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { emptyView, reduce } from '../../live/reducer';
import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from '../chat/ChatView';

afterEach(() => vi.unstubAllGlobals());

function push(conversationId: string, seq: number, event: Record<string, unknown>) {
  FakeSocket.last?.push({
    type: 'conversation.event',
    event: { conversationId, seq, at: 1000 + seq, ...event },
  } as never);
}

const summary = (id: string, spend?: Record<string, unknown>) => ({
  id,
  title: 'Sorting the table',
  preview: '',
  createdAt: 1,
  updatedAt: 1,
  status: 'idle',
  options: {},
  ...(spend && { spend }),
});

describe('what a chat costs (ADR 0079)', () => {
  it('shows each reply’s cost among its actions, with the detail a tap away', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [summary('s1', { usd: 0.04 })],
    });
    renderApp(<ChatView conversationId="s1" />, { route: '/c/s1' });
    await screen.findByRole('textbox', { name: 'Message Conch' });
    act(() => {
      push('s1', 0, { type: 'user.message', messageId: 'u1', text: 'Sort it' });
      push('s1', 1, { type: 'assistant.delta', messageId: 'a1', kind: 'text', delta: 'Sorted.' });
      push('s1', 2, { type: 'assistant.done', messageId: 'a1' });
      push('s1', 3, {
        type: 'turn.completed',
        outcome: 'success',
        usage: { inputTokens: 18_200, cachedInputTokens: 12_000, outputTokens: 900 },
        cost: { billing: 'metered', usd: 0.042, priced: 'list', savedUsd: 0.031 },
      });
    });
    const tag = await screen.findByRole('button', {
      name: 'This reply cost about $0.04, at list prices.',
    });
    await userEvent.click(tag);
    expect(await screen.findByText('Reading from the cache saved about $0.03')).toBeVisible();
  });

  it('adds the chat up beside the model picker, and sets its own limit', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [summary('s2', { usd: 0.31, tasksUsd: 0.08 })],
      'PUT /api/conversations/s2/spend-limit': () => summary('s2', { usd: 0.31, capUsd: 2 }),
    });
    renderApp(<ChatView conversationId="s2" />, { route: '/c/s2' });
    await userEvent.click(
      await screen.findByRole('button', { name: 'This chat has spent $0.31. Details and limit' }),
    );
    expect(await screen.findByText('$0.08 of it by tasks started from here')).toBeVisible();
    await userEvent.type(screen.getByLabelText('Limit for this chat'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Set limit' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PUT',
        path: '/api/conversations/s2/spend-limit',
        body: { capUsd: 2 },
      }),
    );
    expect(
      await screen.findByRole('button', {
        name: 'This chat has spent $0.31 of its $2 limit. Details and limit',
      }),
    ).toBeVisible();
  });

  it('says nothing about money in a chat that hasn’t spent any', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [summary('s3')],
    });
    renderApp(<ChatView conversationId="s3" />, { route: '/c/s3' });
    await screen.findByRole('textbox', { name: 'Message Conch' });
    expect(screen.queryByRole('button', { name: /This chat has spent/ })).toBeNull();
    // …until ⌘K asks for it.
    act(() => useUi.setState({ chatSpendOpen: 's3' }));
    expect(await screen.findByText('This chat has spent $0')).toBeVisible();
    act(() => useUi.setState({ chatSpendOpen: null }));
  });

  it('at a limit, the message waits for one tap, and folds once chosen', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [summary('s4', { usd: 2.04, capUsd: 2 })],
      'POST /api/conversations/s4/capped': () => ({ ok: true }),
    });
    renderApp(<ChatView conversationId="s4" />, { route: '/c/s4' });
    await screen.findByRole('textbox', { name: 'Message Conch' });
    act(() => {
      push('s4', 0, { type: 'user.message', messageId: 'u1', text: 'And again' });
      push('s4', 1, {
        type: 'turn.capped',
        limit: 'chat',
        spentUsd: 2.04,
        limitUsd: 2,
        raiseTo: 5,
        switchTo: {
          engine: 'ollama',
          model: 'gemma3',
          label: 'Gemma 3',
          provider: 'Ollama',
          why: 'local',
        },
      });
    });
    const card = await screen.findByRole('group', { name: 'This chat has reached its $2 limit' });
    expect(card).toHaveTextContent('It has spent $2.04. Your message is waiting.');
    await userEvent.click(screen.getByRole('button', { name: 'Use Gemma 3 on this computer' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/api/conversations/s4/capped',
        body: { choice: 'switch' },
      }),
    );
    act(() => push('s4', 2, { type: 'turn.capped.settled', outcome: 'switched' }));
    expect(await screen.findByText('Carried on with Gemma 3')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Raise to/ })).toBeNull();
  });

  it('a quiet line about money, once', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [summary('s5')],
    });
    renderApp(<ChatView conversationId="s5" />, { route: '/c/s5' });
    await screen.findByRole('textbox', { name: 'Message Conch' });
    act(() =>
      push('s5', 0, {
        type: 'spend.notice',
        kind: 'pricier',
        message: 'With a chat this long, each reply from Opus 5.5 costs about $0.84.',
      }),
    );
    expect(await screen.findByRole('note')).toHaveTextContent(
      'With a chat this long, each reply from Opus 5.5 costs about $0.84.',
    );
  });
});

describe('the transcript’s fold of spending', () => {
  const at = (seq: number, event: Record<string, unknown>) =>
    ({ conversationId: 'c', seq, at: seq, ...event }) as never;
  const capped = {
    type: 'turn.capped',
    limit: 'month',
    spentUsd: 50,
    limitUsd: 50,
    raiseTo: 100,
  };

  it('a newer message overtakes a card that still waits', () => {
    let view = reduce(emptyView, at(0, { type: 'user.message', messageId: 'u1', text: 'a' }));
    view = reduce(view, at(1, capped));
    view = reduce(view, at(2, { type: 'user.message', messageId: 'u2', text: 'b' }));
    view = reduce(view, at(3, capped));
    const cards = view.items.filter((i) => i.kind === 'capped');
    expect(cards.map((c) => (c.kind === 'capped' ? c.settled : undefined))).toEqual([
      'moved-on',
      undefined,
    ]);
    view = reduce(view, at(4, { type: 'turn.capped.settled', outcome: 'raised' }));
    expect(view.items.findLast((i) => i.kind === 'capped')).toMatchObject({ settled: 'raised' });
  });

  it('keeps what a turn cost on its end', () => {
    const view = reduce(
      emptyView,
      at(0, { type: 'turn.completed', outcome: 'interrupted', cost: { billing: 'free' } }),
    );
    expect(view.items.at(-1)).toMatchObject({ kind: 'turn-end', cost: { billing: 'free' } });
  });
});
