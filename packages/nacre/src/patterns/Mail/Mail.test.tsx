import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { MailCompose } from './MailCompose';
import { MailSent } from './MailSent';
import { followUpRequest, isAddress, peopleWords, sendDraftRequest } from './people';

const letter = {
  from: 'ada@work.example',
  to: [{ address: 'maya@example.com', name: 'Maya Kim' }],
  subject: 'Launch',
  body: 'Hi Maya,\n\nThe checklist, please.',
};

describe('MailCompose', () => {
  it('shows exactly what goes, names beside addresses, with no markup from the words', async () => {
    const { container } = renderNacre(
      <MailCompose {...letter} body={'<script>bad()</script>\n[link](https://example.com)'} />,
    );
    expect(screen.getByText('Maya Kim')).toBeInTheDocument();
    expect(screen.getByText('maya@example.com')).toBeInTheDocument();
    expect(screen.getByText('ada@work.example')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Launch' })).toBeInTheDocument();
    expect(screen.getByText(/<script>bad\(\)<\/script>/)).toBeInTheDocument();
    expect(container.querySelector('script,a,img')).toBeNull();
    await expectAccessible(container);
  });

  it('sends as it was when nothing changed, and Don’t send says no', async () => {
    const onSend = vi.fn();
    const onDecline = vi.fn();
    renderNacre(<MailCompose {...letter} editable onSend={onSend} onDecline={onDecline} />);
    await userEvent.click(screen.getByRole('button', { name: /^Send/ }));
    expect(onSend).toHaveBeenCalledWith(undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Don’t send' }));
    expect(onDecline).toHaveBeenCalledOnce();
  });

  it('edits in place: people, subject and words, marked, and sent as changed', async () => {
    const onSend = vi.fn();
    const { container } = renderNacre(<MailCompose {...letter} editable onSend={onSend} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await expectAccessible(container);
    const add = screen.getByRole('textbox', { name: 'Add someone to To' });
    await userEvent.type(add, 'not-an-address{Enter}');
    expect(screen.getByText('“not-an-address” isn’t an email address.')).toBeInTheDocument();
    await userEvent.clear(add);
    await userEvent.type(add, 'sam@example.org,');
    expect(screen.getByText('sam@example.org')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove maya@example.com' }));
    const subject = screen.getByRole('textbox', { name: 'Subject' });
    await userEvent.clear(subject);
    await userEvent.type(subject, 'Launch, Friday');
    const body = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.clear(body);
    await userEvent.type(body, 'New words.');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('Edited by you')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus());
    await userEvent.click(screen.getByRole('button', { name: /^Send/ }));
    expect(onSend).toHaveBeenCalledWith({
      to: ['sam@example.org'],
      subject: 'Launch, Friday',
      body: 'New words.',
    });
  });

  it('Esc puts it back; Undo my changes returns to the assistant’s words', async () => {
    const onSend = vi.fn();
    renderNacre(<MailCompose {...letter} editable onSend={onSend} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), ' More.');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    expect(screen.queryByText('Edited by you')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), ' More.');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await userEvent.click(screen.getByRole('button', { name: 'Undo my changes' }));
    await userEvent.click(screen.getByRole('button', { name: /^Send/ }));
    expect(onSend).toHaveBeenCalledWith(undefined);
  });

  it('⌘/Ctrl+Enter sends from inside a field, with the address still being typed', async () => {
    const onSend = vi.fn();
    renderNacre(<MailCompose {...letter} editable onSend={onSend} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const add = screen.getByRole('textbox', { name: 'Add someone to To' });
    await userEvent.type(add, 'lee@example.org');
    fireEvent.keyDown(add, { key: 'Enter', ctrlKey: true });
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith(
        expect.objectContaining({ to: ['maya@example.com', 'lee@example.org'] }),
      ),
    );
  });

  it('keeps a reply’s people and subject, and needs someone to send to', async () => {
    const onSend = vi.fn();
    renderNacre(<MailCompose {...letter} reply editable onSend={onSend} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('textbox', { name: 'Add someone to To' })).toBeNull();
    expect(screen.getByText('A reply goes to the people in the thread.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveAttribute('readonly');
  });

  it('a draft saves and never offers to edit what its task holds', () => {
    renderNacre(<MailCompose {...letter} intent="draft" editable onSend={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Save draft/ })).toBeInTheDocument();
    expect(screen.getByText(/Nothing is sent/)).toBeInTheDocument();
  });

  it('while sending, says so and waits', () => {
    renderNacre(<MailCompose {...letter} editable status="sending" onSend={vi.fn()} />);
    expect(screen.getByText('Sending to Maya Kim…')).toBeInTheDocument();
    expect(screen.getByRole('group')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('MailSent', () => {
  const sent = {
    ...letter,
    at: '2026-10-08T14:41:00Z',
    now: Date.parse('2026-10-08T14:45:00Z'),
    locale: 'en-GB',
    timeZone: 'UTC',
  };

  it('says who it went to and when, opens to the whole email, and links only to the web', async () => {
    const onFollowUp = vi.fn();
    const { container } = renderNacre(
      <MailSent
        state="sent"
        {...sent}
        url="https://mail.google.com/mail/#sent/1"
        onFollowUp={onFollowUp}
      />,
    );
    expect(screen.getByText('Sent to Maya Kim')).toBeInTheDocument();
    expect(screen.getByText('14:41')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open in Gmail/ })).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/#sent/1',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show the email' }));
    expect(screen.getByRole('list', { name: 'To' })).toHaveTextContent('maya@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Follow up' }));
    expect(onFollowUp).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('never links anything that isn’t a web link', () => {
    renderNacre(<MailSent state="sent" {...sent} url="javascript:alert(1)" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('a draft is kept, not sent, and asks for it to go only in words', async () => {
    const onSendDraft = vi.fn();
    renderNacre(
      <MailSent
        state="draft"
        {...sent}
        url="https://mail.google.com/mail/#drafts/1"
        onSendDraft={onSendDraft}
      />,
    );
    expect(screen.getByText('Draft saved for Maya Kim')).toBeInTheDocument();
    expect(screen.getByText('In your Drafts · not sent')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open the draft in Gmail/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send it now' }));
    expect(onSendDraft).toHaveBeenCalledOnce();
  });

  it('may have gone: points at Sent and never offers to try again', () => {
    renderNacre(
      <MailSent
        state="uncertain"
        {...sent}
        url="https://mail.google.com/mail/#sent"
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('Gmail may have sent this')).toBeInTheDocument();
    expect(screen.getByText('Look in Sent before sending it again.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Look in Sent/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('didn’t go: says why, and Try again is words for the composer', async () => {
    const onRetry = vi.fn();
    renderNacre(<MailSent state="failed" {...sent} reason="Nothing was sent." onRetry={onRetry} />);
    expect(screen.getByText('Didn’t send to Maya Kim')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('mail words', () => {
  it('names people and asks for next steps only in words', () => {
    const people = [
      { address: 'a@x.org', name: 'Ann' },
      { address: 'b@x.org' },
      { address: 'c@x.org' },
    ];
    expect(peopleWords(people.slice(0, 1))).toBe('Ann');
    expect(peopleWords(people.slice(0, 2))).toBe('Ann and b@x.org');
    expect(peopleWords(people)).toBe('Ann and 2 others');
    expect(followUpRequest({ to: people.slice(0, 1), subject: 'Hi' })).toBe(
      'Draft a follow-up to Ann about “Hi”',
    );
    expect(sendDraftRequest({ to: people.slice(0, 1), subject: 'Hi' })).toBe(
      'Send the draft to a@x.org about “Hi”',
    );
    expect(isAddress('maya@example.com')).toBe(true);
    for (const bad of ['maya', 'maya@', '@x.org', 'a b@x.org', '<a@x.org>', 'a@x'])
      expect(isAddress(bad)).toBe(false);
  });
});
