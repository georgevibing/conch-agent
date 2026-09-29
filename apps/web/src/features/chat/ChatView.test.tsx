import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from './ChatView';

afterEach(() => vi.unstubAllGlobals());

describe('ChatView', () => {
  it('greets, sends a new conversation and renders the streamed reply', async () => {
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/conversations': () => [] });
    renderApp(<ChatView />);
    expect(await screen.findByRole('heading', { name: /, Ada\.$/ })).toBeInTheDocument();

    const box = screen.getByRole('textbox', { name: 'Message Conch' });
    await userEvent.type(box, 'Hello there{Enter}');
    const socket = FakeSocket.last;
    await waitFor(() =>
      expect(socket?.sent).toContainEqual(
        expect.objectContaining({ type: 'conversation.send', text: 'Hello there' }),
      ),
    );
    const sent = socket?.sent.find((m) => (m as { type: string }).type === 'conversation.send') as {
      clientMessageId: string;
    };
    // Optimistic bubble appears immediately.
    expect(screen.getByText('Hello there')).toBeInTheDocument();

    const summary = {
      id: 'c1',
      title: 'Hello there',
      preview: '',
      createdAt: 1,
      updatedAt: 1,
      status: 'running' as const,
      options: {},
    };
    act(() => {
      socket?.push({
        type: 'conversation.created',
        clientMessageId: sent.clientMessageId,
        conversation: summary,
      });
      socket?.push({
        type: 'conversation.event',
        event: {
          type: 'user.message',
          conversationId: 'c1',
          seq: 0,
          at: 1,
          messageId: sent.clientMessageId,
          text: 'Hello there',
        },
      });
    });
    // The new-chat view hands over to /c/c1; assert the store folded the reply.
    const { useLiveStore } = await import('../../live/store');
    act(() => {
      socket?.push({
        type: 'conversation.event',
        event: {
          type: 'assistant.delta',
          conversationId: 'c1',
          seq: 1,
          at: 2,
          messageId: 'm1',
          kind: 'text',
          delta: 'Hi Ada!',
        },
      });
    });
    expect(useLiveStore.getState().views.c1?.items.at(-1)).toMatchObject({
      kind: 'assistant',
      text: 'Hi Ada!',
    });
    expect(useLiveStore.getState().created[sent.clientMessageId]).toBe('c1');
  });

  it('shows a fix-it callout and keeps the draft when Claude Code is signed out', async () => {
    mockFetch({
      'GET /api/state': () =>
        appState({ engine: { ...appState().engine, state: 'signed-out', auth: undefined } }),
      'GET /api/conversations': () => [],
    });
    renderApp(<ChatView />);
    expect(await screen.findByText('Claude Code needs you to sign in')).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: 'Message Conch' });
    await userEvent.type(box, 'Are you there?{Enter}');
    const socket = FakeSocket.last;
    await waitFor(() => expect(socket?.sent.length).toBeGreaterThan(0));
    const sent = socket?.sent.find((m) => (m as { type: string }).type === 'conversation.send') as {
      clientMessageId: string;
    };
    act(() =>
      socket?.push({
        type: 'error',
        code: 'engine-unavailable',
        message: 'Claude Code is signed out.',
        clientMessageId: sent.clientMessageId,
      }),
    );
    await waitFor(() => expect(box).toHaveValue('Are you there?'));
  });
});
