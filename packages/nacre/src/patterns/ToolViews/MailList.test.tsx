import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { MailList, replyRequest, type MailMessage } from './MailList';

const now = Date.UTC(2026, 9, 3, 12, 0);
const base = { now, timeZone: 'UTC', locale: 'en-GB' };
const messages: MailMessage[] = [
  {
    from: 'Ada Lovelace',
    subject: 'Q4 budget',
    snippet: 'Here are the final numbers',
    date: '2026-10-03T09:15:00Z',
    unread: true,
    attachments: true,
    url: 'https://mail.example.org/m/1',
  },
  { from: 'Sam Rivera', subject: 'Re: launch', date: '2026-10-02T09:15:00Z' },
];

describe('MailList', () => {
  it('shows who, what, when, unread and attachments, accessibly', async () => {
    const { container } = renderNacre(
      <MailList {...base} messages={messages} onReply={() => {}} />,
    );
    expect(screen.getByRole('region', { name: 'Emails, 2 emails' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Ada Lovelace/ });
    expect(link).toHaveTextContent('Unread, Ada Lovelace');
    expect(link).toHaveTextContent('Q4 budget');
    expect(link).toHaveTextContent('Here are the final numbers');
    expect(link).toHaveTextContent('09:15');
    expect(screen.getByRole('img', { name: 'Has attachments' })).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('opens an email in a new tab, and draws a row without a link as text', () => {
    renderNacre(<MailList {...base} messages={messages} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://mail.example.org/m/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('Reply hands over words for the composer, from the keyboard too, and never sends', async () => {
    const onReply = vi.fn();
    renderNacre(<MailList {...base} messages={messages} onReply={onReply} />);
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Reply to Ada Lovelace' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onReply).toHaveBeenCalledWith(messages[0]);
    expect(replyRequest(messages[0] as MailMessage)).toBe(
      'Draft a reply to Ada Lovelace about “Q4 budget”',
    );
  });

  it('never follows a link that isn’t a web link, and keeps markup as text', () => {
    renderNacre(
      <MailList
        {...base}
        messages={[
          {
            from: '<script>x</script>',
            subject: 'Hi',
            date: '2026-10-03T09:15:00Z',
            url: 'javascript:alert(1)',
          },
        ]}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('<script>x</script>')).toBeInTheDocument();
  });

  it('folds after six, and says when nothing matched', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      ...(messages[1] as MailMessage),
      subject: `Mail ${i + 1}`,
    }));
    const { unmount } = renderNacre(<MailList {...base} messages={many} />);
    expect(screen.queryByText('Mail 7')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show all 9 emails' }));
    expect(screen.getByText('Mail 9')).toBeInTheDocument();
    unmount();
    renderNacre(<MailList {...base} messages={[]} />);
    expect(screen.getByText('No emails found.')).toBeInTheDocument();
  });
});
