import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { reduce, emptyView } from '../../live/reducer';
import { useUi } from '../../app/ui';
import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from './ChatView';

afterEach(() => vi.unstubAllGlobals());

function push(seq: number, event: Record<string, unknown>) {
  FakeSocket.last?.push({
    type: 'conversation.event',
    event: { conversationId: 'c1', seq, at: 1000 + seq, ...event },
  } as never);
}

const waiting = {
  type: 'turn.needs-apps',
  needs: [{ kind: 'app', name: 'Linear', catalogId: 'linear' }],
  model: { engine: 'mock', id: 'chat-lite', label: 'Chat Lite' },
  switchTo: { engine: 'mock', model: 'opus', label: 'Opus 5.5', provider: 'Claude Code' },
};

describe('a chat-only model and a message that needs an app (ADR 0050)', () => {
  it('offers the switch in the chat, and sends it with the model that can', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'POST /api/conversations/c1/release': () => ({ ok: true }),
    });
    renderApp(<ChatView conversationId="c1" />, { route: '/c/c1' });
    await screen.findByRole('textbox', { name: 'Message Conch' });
    act(() => {
      push(0, { type: 'user.message', messageId: 'u1', text: 'What’s in Linear?' });
      push(1, waiting);
    });
    const card = await screen.findByRole('group', { name: 'Chat Lite can’t use Linear' });
    // The same provider: no need to name it.
    expect(card).toHaveTextContent('Opus 5.5 can. Switch, and your message goes by itself.');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Opus 5.5' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/api/conversations/c1/release',
        body: { engine: 'mock', model: 'opus' },
      }),
    );

    // It went with that model: a quiet line, nothing left to press.
    act(() => {
      push(2, { type: 'options', options: { engine: 'mock', model: 'opus' } });
      push(3, { type: 'status', status: 'running' });
    });
    expect(await screen.findByText('Switched to Opus 5.5 to use Linear')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Switch to/ })).toBeNull();
  });

  it('answers without, or points at setting up a provider when none can', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'POST /api/conversations/c1/release': () => ({ ok: true }),
    });
    renderApp(<ChatView conversationId="c1" />, { route: '/c/c1' });
    await screen.findByRole('textbox', { name: 'Message Conch' });
    act(() => {
      // The live store outlives a test: later numbers are new events.
      push(10, { type: 'user.message', messageId: 'u2', text: 'What’s in Linear?' });
      push(11, { ...waiting, switchTo: undefined });
    });
    const card = await screen.findByRole('group', { name: 'Chat Lite can’t use Linear' });
    expect(card).toHaveTextContent('None of the models you’ve set up can use apps');
    await userEvent.click(screen.getByRole('button', { name: 'Connect a provider' }));
    expect(useUi.getState().settings).toBe('providers');
    act(() => useUi.getState().closeSettings());

    await userEvent.click(screen.getByRole('button', { name: 'Answer without it' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/api/conversations/c1/release',
        body: {},
      }),
    );
  });

  it('settles as answered without when the chat kept its model', () => {
    const events = [
      { seq: 0, type: 'user.message', messageId: 'u1', text: 'Linear?' },
      { seq: 1, ...waiting },
      { seq: 2, type: 'status', status: 'running' },
    ];
    const view = events.reduce(
      (v, e) => reduce(v, { conversationId: 'c1', at: 1, ...e } as never),
      emptyView,
    );
    expect(view.items.find((i) => i.kind === 'needs-apps')).toMatchObject({
      settled: 'answered',
    });
  });
});
