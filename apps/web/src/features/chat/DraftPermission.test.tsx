import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { TranscriptItem } from '../../live/reducer';
import { renderApp } from '../../test/harness';
import { foldedAnswers } from './approval';
import { mailMoment } from './MailItems';
import { PermissionCard } from './TranscriptItems';

type Permission = Extract<TranscriptItem, { kind: 'permission' }>;
type Tool = Extract<TranscriptItem, { kind: 'tool' }>;

const email = {
  accountEmail: 'ada@work.example',
  to: ['maya@example.com'],
  subject: 'Friday',
  body: 'Please review the launch checklist.',
};

describe('review a draft before saving', () => {
  it('shows the concrete message and offers a one-time save, not a standing approval', async () => {
    const respond = vi.fn();
    const item: Permission = {
      kind: 'permission',
      id: 'permission_draft',
      toolName: 'google_mail_create_draft',
      summary: 'Save a draft, not send it',
      input: email,
    };
    renderApp(<PermissionCard item={item} name="Conch" onRespond={respond} />);
    expect(screen.getByText('ada@work.example')).toBeInTheDocument();
    expect(screen.getByText('Please review the launch checklist.')).toBeInTheDocument();
    // The draft is its task's exact words: they change in Gmail, never on the card.
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Always allow' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Don’t save' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Save draft/ }));
    expect(respond).toHaveBeenCalledExactlyOnceWith('allow', undefined);
    expect(screen.getByRole('button', { name: /^Save draft/ })).toBeDisabled();
  });
});

describe('an email before it goes', () => {
  const asking: Permission = {
    kind: 'permission',
    id: 'permission_send',
    toolName: 'google_mail_send',
    toolUseId: 'call_send',
    summary: 'send an email',
    input: { ...email, names: { 'maya@example.com': 'Maya Kim' } },
    once: true,
    editable: true,
  };
  const call: Tool = {
    kind: 'tool',
    id: 'call_send',
    name: 'mcp__conch__google_mail_send',
    input: email,
    status: 'running',
    startedAt: 0,
  } as Tool;

  it('sends what the person changed on the card, and only that', async () => {
    const respond = vi.fn();
    renderApp(<PermissionCard item={asking} name="Conch" onRespond={respond} call={call} />);
    expect(screen.getByText('Maya Kim')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const body = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.clear(body);
    await userEvent.type(body, 'See you Friday.');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await userEvent.click(screen.getByRole('button', { name: /^Send/ }));
    expect(respond).toHaveBeenCalledExactlyOnceWith('allow', {
      to: ['maya@example.com'],
      subject: 'Friday',
      body: 'See you Friday.',
    });
    // The letter folds and flies while Gmail answers.
    expect(screen.getByText('Sending to Maya Kim…')).toBeInTheDocument();
  });

  it('keeps an allowed email’s card while it goes, and folds it once Gmail answers', () => {
    const allowed = { ...asking, decision: 'allow' as const };
    expect(foldedAnswers([call, allowed]).has(allowed.id)).toBe(false);
    expect(foldedAnswers([{ ...call, status: 'success' }, allowed]).has(allowed.id)).toBe(true);
    renderApp(<PermissionCard item={allowed} name="Conch" onRespond={vi.fn()} call={call} />);
    expect(screen.getByText('Sending to Maya Kim…')).toBeInTheDocument();
  });

  it('“Save as a draft instead” sends nothing and asks for a draft in the composer', async () => {
    const respond = vi.fn();
    renderApp(<PermissionCard item={asking} name="Conch" onRespond={respond} call={call} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save as a draft instead' }));
    expect(respond).toHaveBeenCalledExactlyOnceWith('deny');
  });
});

describe('an email that didn’t go, or may have', () => {
  const tool = (over: Partial<Tool>): Tool =>
    ({
      kind: 'tool',
      id: 'call_send',
      name: 'mcp__conch__google_mail_send',
      input: email,
      status: 'error',
      startedAt: 0,
      ...over,
    }) as Tool;

  it('says it may have gone, points at Sent, and never offers to try again', () => {
    renderApp(
      <>
        {mailMoment(
          tool({ output: 'Gmail may have sent this email. Look in Sent before sending it again.' }),
        )}
      </>,
    );
    expect(screen.getByText('Gmail may have sent this')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Look in Sent/ })).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/?authuser=ada%40work.example#sent',
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('says it didn’t go, in the gateway’s words', () => {
    renderApp(
      <>
        {mailMoment(
          tool({
            status: 'success',
            output:
              'The account’s access changed while waiting for the approval. Nothing was sent.',
          }),
        )}
      </>,
    );
    expect(screen.getByText('Didn’t send to maya@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('draws nothing for one that went, or one the person said no to', () => {
    expect(
      mailMoment(tool({ status: 'success', output: '{"state":"confirmed"}' })),
    ).toBeUndefined();
    expect(
      mailMoment(tool({ status: 'success', approval: 'declined', output: 'Nothing was sent.' })),
    ).toBeUndefined();
  });
});
