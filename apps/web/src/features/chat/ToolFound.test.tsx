import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from './ChatView';

afterEach(() => vi.unstubAllGlobals());

function push(seq: number, event: Record<string, unknown>) {
  FakeSocket.last?.push({
    type: 'conversation.event',
    event: { conversationId: 'c1', seq, at: 1000 + seq, ...event },
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

  it('draws an email that went as a letter that went, and Follow up is only words', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
    });
    renderApp(<ChatView conversationId="c1" />, { route: '/c/c1' });
    const composer = await screen.findByRole('textbox', { name: 'Message Conch' });
    act(() => {
      // The same chat as above, a turn later.
      push(10, { type: 'user.message', messageId: 'u2', text: 'Send Maya the checklist' });
      push(11, {
        type: 'tool.started',
        toolUseId: 't2',
        name: 'mcp__conch__google_mail_send',
        input: { to: ['maya@example.com'], subject: 'Checklist', body: 'Here it is.' },
      });
      push(12, {
        type: 'tool.finished',
        toolUseId: 't2',
        status: 'success',
        output: '{"state":"confirmed"}',
        view: {
          kind: 'mail-sent',
          state: 'sent',
          from: 'ada@work.example',
          to: [{ address: 'maya@example.com', name: 'Maya Kim' }],
          subject: 'Checklist',
          body: 'Here it is.',
          at: '2026-10-08T14:41:00Z',
          url: 'https://mail.google.com/mail/?authuser=ada%40work.example#sent/s1',
        },
      });
    });
    const sent = await screen.findByRole('region', { name: 'Sent to Maya Kim: Checklist' });
    expect(within(sent).getByRole('link', { name: /Open in Gmail/ })).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/?authuser=ada%40work.example#sent/s1',
    );
    // Not the inbox row it used to be.
    expect(within(sent).queryByRole('region', { name: /Emails/ })).toBeNull();
    await userEvent.click(within(sent).getByRole('button', { name: 'Follow up' }));
    expect(composer).toHaveValue('Draft a follow-up to Maya Kim about “Checklist”');
  });
});
