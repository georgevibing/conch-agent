import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from './ChatView';

afterEach(() => vi.unstubAllGlobals());

function push(seq: number, event: Record<string, unknown>, conversationId = 'c1') {
  FakeSocket.last?.push({
    type: 'conversation.event',
    event: { conversationId, seq, at: 1000 + seq, ...event },
  } as never);
}

describe('what a tool found, in the chat (ADR 0060)', () => {
  it('draws it under the tool row, and Reply puts words in the composer without sending', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
    });
    renderApp(<ChatView conversationId="c1" />, { route: '/c/c1' });
    const composer = await screen.findByRole('textbox', { name: 'Message Conch' });
    act(() => {
      push(0, { type: 'user.message', messageId: 'u1', text: 'Find the budget email' });
      push(1, {
        type: 'tool.started',
        toolUseId: 't1',
        name: 'mcp__conch__google_mail_search',
        input: { query: 'budget' },
      });
      push(2, {
        type: 'tool.finished',
        toolUseId: 't1',
        status: 'success',
        output: '{"messages":[{"id":"m1"}]}',
        view: {
          kind: 'mail',
          items: [
            {
              from: 'Ada Lovelace',
              subject: 'Budget',
              date: '2026-10-02T10:00:00Z',
              unread: true,
              attachments: false,
              url: 'https://mail.google.com/mail/#all/m1',
            },
          ],
        },
      });
    });
    const emails = await screen.findByRole('region', { name: 'Emails, 1 email' });
    expect(within(emails).getByRole('link', { name: /Ada Lovelace/ })).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/#all/m1',
    );
    // The raw output is still there, behind the row's disclosure.
    expect(screen.queryByText('{"messages":[{"id":"m1"}]}')).toBeNull();

    await userEvent.click(within(emails).getByRole('button', { name: 'Reply to Ada Lovelace' }));
    expect(composer).toHaveValue('Draft a reply to Ada Lovelace about “Budget”');
    expect(calls.some((c) => c.method === 'POST' && c.path.includes('/messages'))).toBe(false);
  });

  it('draws a knowledge card in sight, its picture from Conch and never the web', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
    });
    // A chat of its own: the last test's chat is still in the store.
    renderApp(<ChatView conversationId="c2" />, { route: '/c/c2' });
    await screen.findByRole('textbox', { name: 'Message Conch' });
    act(() => {
      const say = (seq: number, event: Record<string, unknown>) => push(seq, event, 'c2');
      say(0, { type: 'user.message', messageId: 'u1', text: 'Who was Ada Lovelace?' });
      say(1, {
        type: 'tool.started',
        toolUseId: 't1',
        name: 'mcp__conch__knowledge_card',
        input: { query: 'Ada Lovelace' },
      });
      say(2, {
        type: 'tool.finished',
        toolUseId: 't1',
        status: 'success',
        output: '{"title":"Ada Lovelace"}',
        view: {
          kind: 'knowledge',
          title: 'Ada Lovelace',
          description: 'English mathematician',
          extract: 'Augusta Ada King was an English mathematician.',
          picture: {
            id: 'att_ada',
            name: 'Ada Lovelace.jpg',
            mimeType: 'image/jpeg',
            size: 2048,
            kind: 'image',
            width: 600,
            height: 760,
            createdAt: 1,
          },
          facts: [{ label: 'Born', value: '10 December 1815' }],
          url: 'https://en.wikipedia.org/wiki/Ada_Lovelace',
          lang: 'en',
        },
      });
    });
    const card = await screen.findByRole('article', { name: 'Ada Lovelace' });
    const picture = card.querySelector('img[src^="/api/attachments/"]');
    expect(picture).toHaveAttribute('src', '/api/attachments/att_ada');
    expect(within(card).getByRole('link', { name: 'Read on Wikipedia' })).toHaveAttribute(
      'href',
      'https://en.wikipedia.org/wiki/Ada_Lovelace',
    );
    for (const img of card.querySelectorAll('img'))
      expect(img.getAttribute('src')).toMatch(/^\/api\//);
  });
});
