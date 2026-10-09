import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  appState,
  baseProviders,
  FakeSocket,
  mockFetch,
  provider,
  providersList,
  renderApp,
} from '../../test/harness';
import { ChatView } from './ChatView';

afterEach(() => vi.unstubAllGlobals());

const ollama = provider({
  id: 'mock',
  name: 'Ollama',
  tagline: 'A model on this computer',
  active: false,
  local: true,
  ready: true,
});

function push(socket: FakeSocket | undefined, seq: number, event: Record<string, unknown>) {
  socket?.push({
    type: 'conversation.event',
    event: { conversationId: 'c1', seq, at: 1000 + seq, ...event },
  } as never);
}

describe('offline (ADR 0023)', () => {
  it('says what happens to what you send, live, as the internet goes and comes back', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/providers': () => baseProviders,
    });
    renderApp(<ChatView />);
    await screen.findByRole('textbox', { name: 'Message Conch' });
    expect(screen.queryByText('You’re offline.')).toBeNull();

    act(() => FakeSocket.last?.push({ type: 'network.status', network: { online: false } }));
    expect(await screen.findByText(/Messages wait here, and go by themselves/)).toBeVisible();

    act(() => FakeSocket.last?.push({ type: 'network.status', network: { online: true } }));
    await waitFor(() => expect(screen.queryByText('You’re offline.')).toBeNull());
  });

  it('a waiting message can be answered now by the model on this computer', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState({ network: { online: false } }),
      'GET /api/conversations': () => [],
      'GET /api/providers': () =>
        providersList({ providers: [...baseProviders.providers, ollama] }),
      'POST /api/conversations/c1/release': () => ({ ok: true }),
    });
    renderApp(<ChatView conversationId="c1" />, { route: '/c/c1' });
    // With a model on this computer, offline messages are answered right here.
    expect(await screen.findByText(/Ollama answers from this computer/)).toBeVisible();

    act(() => {
      push(FakeSocket.last, 0, {
        type: 'user.message',
        messageId: 'u1',
        text: 'Summarise my notes',
      });
      push(FakeSocket.last, 1, { type: 'turn.held', reason: 'offline' });
    });
    expect(await screen.findByText('Waiting for the internet')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Answer now with Ollama' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/api/conversations/c1/release',
        body: { engine: 'mock' },
      }),
    );

    // It went: one quiet line says who answered, instead of the card.
    act(() =>
      push(FakeSocket.last, 2, {
        type: 'turn.routed',
        from: 'claude-code',
        to: 'mock',
        reason: 'offline',
        message: 'You were offline, so Ollama on this computer answered.',
      }),
    );
    expect(await screen.findByText(/so Ollama on this computer answered/)).toBeVisible();
    expect(screen.queryByText('Waiting for the internet')).toBeNull();
  });
});

describe('at a limit (ADR 0126)', () => {
  const at = (seq: number, event: Record<string, unknown>) =>
    FakeSocket.last?.push({
      type: 'conversation.event',
      event: { conversationId: 'c-limit', seq, at: 1000 + seq, ...event },
    } as never);

  it('says who is answering, and Switch back makes the chat wait for its own provider', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/providers': () => baseProviders,
      'POST /api/conversations/c-limit/limit-back': () => ({
        id: 'c-limit',
        title: 'Trip',
        preview: '',
        createdAt: 1,
        updatedAt: 2,
        status: 'idle',
        options: { engine: 'claude-code' },
      }),
    });
    renderApp(<ChatView conversationId="c-limit" />, { route: '/c/c-limit' });
    await waitFor(() =>
      expect(FakeSocket.last?.sent).toContainEqual(
        expect.objectContaining({ type: 'conversation.subscribe', conversationId: 'c-limit' }),
      ),
    );
    // The log so far (none) has been sent: what comes next is live.
    await act(async () => {});
    act(() => {
      at(0, { type: 'user.message', messageId: 'u1', text: 'And hotels' });
      at(1, {
        type: 'turn.routed',
        from: 'claude-code',
        to: 'codex-cli',
        reason: 'limit',
        message: 'Claude Code reached its limit until 18:00. Codex is answering.',
      });
    });
    expect(await screen.findByText(/Codex is answering/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Switch back' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/api/conversations/c-limit/limit-back',
        body: { engine: 'claude-code' },
      }),
    );
    act(() => at(2, { type: 'limit.back', engine: 'claude-code' }));
    expect(await screen.findByText('Back to Claude Code: this chat waits for it.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Switch back' })).toBeNull();
  });
});
