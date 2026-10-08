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

  it('plays a video it found in place, from a player address Conch built', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
    });
    const { container } = renderApp(<ChatView conversationId="v1" />, { route: '/c/v1' });
    await screen.findByRole('textbox', { name: 'Message Conch' });
    act(() => {
      push(
        0,
        { type: 'user.message', messageId: 'u1', text: 'Show me how to shape sourdough' },
        'v1',
      );
      push(
        1,
        {
          type: 'tool.started',
          toolUseId: 't1',
          name: 'mcp__conch__video_search',
          input: { query: 'shape sourdough' },
        },
        'v1',
      );
      push(
        2,
        {
          type: 'tool.finished',
          toolUseId: 't1',
          status: 'success',
          output: '{"videos":[{"n":1}]}',
          view: {
            kind: 'videos',
            query: 'shape sourdough',
            items: [
              {
                provider: 'youtube',
                id: 'dQw4w9WgXcQ',
                title: 'Shaping a boule',
                channel: 'The Flour Room',
                duration: 504,
                url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
              },
            ],
          },
        },
        'v1',
      );
    });
    const found = await screen.findByRole('region', { name: 'A video for “shape sourdough”' });
    expect(container.querySelector('iframe')).toBeNull();
    expect(within(found).getByRole('link', { name: /Open on YouTube/ })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    await userEvent.click(
      within(found).getByRole('button', { name: 'Play: Shaping a boule, 8 minutes' }),
    );
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&modestbranding=1&playsinline=1',
    );
  });
});
