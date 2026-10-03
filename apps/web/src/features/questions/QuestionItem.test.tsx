import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from '../chat/ChatView';

afterEach(() => vi.unstubAllGlobals());

/** Each test its own chat: the live store outlives a test. */
let chat = 'c0';
beforeEach(() => {
  chat = `c${Number(chat.slice(1)) + 1}`;
});

function push(seq: number, event: Record<string, unknown>) {
  FakeSocket.last?.push({
    type: 'conversation.event',
    event: { conversationId: chat, seq, at: Date.now() + seq, ...event },
  } as never);
}

const question = {
  questionId: 'q1',
  fields: [
    {
      id: 'how',
      label: 'How would you like to talk?',
      kind: 'choice',
      optional: false,
      multiple: false,
      other: true,
      options: [
        { id: 'video', label: 'Video call' },
        { id: 'phone', label: 'Phone call' },
      ],
    },
  ],
};

async function asked() {
  renderApp(<ChatView conversationId={chat} />, { route: `/c/${chat}` });
  await screen.findByRole('textbox', { name: 'Message Conch' });
  act(() => {
    push(0, { type: 'user.message', messageId: 'u1', text: 'book a call with Ada' });
    push(1, { type: 'status', status: 'running' });
    push(2, { type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'Happy to.' });
    push(3, { type: 'assistant.done', messageId: 'm1' });
    push(4, { type: 'question', question });
    push(5, { type: 'status', status: 'awaiting-permission' });
  });
  return screen.findByRole('group', { name: 'Conch asks: How would you like to talk?' });
}

describe('a question in the chat (ADR 0060)', () => {
  it('answers with a tap, folds at once, and the message box says it can answer too', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      [`POST /api/conversations/${chat}/questions/q1/answer`]: () => ({ ok: true }),
    });
    await asked();
    expect(screen.getByRole('textbox', { name: 'Message Conch' })).toHaveAttribute(
      'placeholder',
      'Answer above, or type it here',
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Phone call' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: `/api/conversations/${chat}/questions/q1/answer`,
        body: { answer: { values: { how: 'phone' }, text: 'Phone call' } },
      }),
    );
    // Folded before Conch confirms it.
    expect(await screen.findByRole('note')).toHaveTextContent('Phone call');
    expect(screen.queryByRole('group', { name: /asks/ })).toBeNull();
  });

  it('opens again with one next step when the answer doesn’t arrive', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      [`POST /api/conversations/${chat}/questions/q1/answer`]: () =>
        new Response(JSON.stringify({ error: 'oops' }), { status: 500 }),
    });
    await asked();
    await userEvent.click(screen.getByRole('radio', { name: 'Video call' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your answer didn’t reach Conch. Try again, or type it in the message box.',
    );
    expect(screen.getByRole('group', { name: /asks/ })).toBeVisible();
  });

  it('what you type while it waits goes as your answer, and the card says so', async () => {
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/conversations': () => [] });
    await asked();
    const box = screen.getByRole('textbox', { name: 'Message Conch' });
    await userEvent.type(box, 'Thursday, by phone{Enter}');
    await waitFor(() =>
      expect(FakeSocket.last?.sent).toContainEqual(
        expect.objectContaining({
          type: 'conversation.send',
          conversationId: chat,
          text: 'Thursday, by phone',
        }),
      ),
    );
    act(() => {
      push(6, { type: 'user.message', messageId: 'u2', text: 'Thursday, by phone' });
      push(7, {
        type: 'question.answered',
        questionId: 'q1',
        answer: { values: {}, text: 'Thursday, by phone' },
      });
      push(8, { type: 'status', status: 'running' });
    });
    expect(await screen.findByRole('note')).toHaveTextContent('Answered in your message');
  });

  it('skipped, or stopped, folds to a quiet line', async () => {
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/conversations': () => [] });
    await asked();
    act(() => {
      push(6, { type: 'question.answered', questionId: 'q1', answer: null });
    });
    expect(await screen.findByRole('note')).toHaveTextContent('Skipped');
  });
});
