import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ChatMessages, type ChatMessage } from './ChatMessages';

const now = Date.UTC(2026, 9, 3, 12, 0);
const base = { now, timeZone: 'UTC', locale: 'en-GB' };
const messages: ChatMessage[] = [
  {
    author: 'Ada Lovelace',
    text: 'Looks great.\nTwo things.',
    at: '2026-10-03T10:00:00Z',
    url: 'https://chat.example.org/p/2',
  },
  { author: 'Sam Rivera', text: 'Pushed the screens.', at: '2026-10-03T09:00:00Z' },
  { author: 'Sam Rivera', text: 'Feedback welcome!', at: '2026-10-03T09:01:00Z' },
];

describe('ChatMessages', () => {
  it('shows the place, then who said what and when, oldest first, accessibly', async () => {
    const { container } = renderNacre(
      <ChatMessages {...base} messages={messages} place="#design" />,
    );
    expect(
      screen.getByRole('region', { name: 'Messages in #design, 3 messages' }),
    ).toBeInTheDocument();
    expect(screen.getByText('#design')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('Pushed the screens.'),
      expect.stringContaining('Feedback welcome!'),
      expect.stringContaining('Looks great.'),
    ]);
    // Sam's second message, a minute later, reads as part of the first.
    expect(items[1]).toHaveAttribute('data-continued');
    expect(items[0]).toHaveTextContent('09:00');
    await expectAccessible(container);
  });

  it('keeps line breaks, and never reads markup', () => {
    renderNacre(
      <ChatMessages
        {...base}
        messages={[
          {
            author: 'Eve',
            text: '<img src=x onerror=alert(1)>\nline two',
            at: '2026-10-03T10:00:00Z',
          },
        ]}
      />,
    );
    const text = screen.getByText(/<img src=x onerror=alert\(1\)>/);
    expect(text.textContent).toBe('<img src=x onerror=alert(1)>\nline two');
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('opens a message in its app, in a new tab', () => {
    renderNacre(<ChatMessages {...base} messages={messages} />);
    const link = screen.getByRole('link', { name: /open in its app/ });
    expect(link).toHaveAttribute('href', 'https://chat.example.org/p/2');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('folds a long message with More, and opens it from the keyboard', async () => {
    renderNacre(
      <ChatMessages
        {...base}
        messages={[{ author: 'Grace', text: 'word '.repeat(100), at: '2026-10-03T10:00:00Z' }]}
      />,
    );
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    more.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the newest six of a busy channel, and the rest on request', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      author: i % 2 ? 'Ada' : 'Sam',
      text: `Message ${i + 1}`,
      at: new Date(now - (10 - i) * 600_000).toISOString(),
    }));
    renderNacre(<ChatMessages {...base} messages={many} />);
    expect(screen.queryByText('Message 1')).toBeNull();
    expect(screen.getByText('Message 10')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all 10 messages' }));
    expect(screen.getByText('Message 1')).toBeInTheDocument();
  });

  it('says when nothing was said', () => {
    renderNacre(<ChatMessages {...base} messages={[]} />);
    expect(screen.getByText('No messages.')).toBeInTheDocument();
  });
});
