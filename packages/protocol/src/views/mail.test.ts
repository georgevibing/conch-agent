import { describe, expect, it } from 'vitest';

import { ClientCommand, ServerEvent, ToolView } from '../index';
import { MailEdit, MailSentView } from './mail';

const sent = {
  kind: 'mail-sent',
  state: 'sent',
  from: 'ada@work.example',
  to: [{ address: 'maya@example.com', name: 'Maya Kim' }],
  subject: 'Checklist',
  body: 'Here it is.',
  at: '2026-10-08T14:41:00Z',
  url: 'https://mail.google.com/mail/?authuser=ada%40work.example#sent/s1',
};

describe('an email that went, as a view', () => {
  it('is one of the views a tool can show, sent or kept as a draft', () => {
    expect(ToolView.parse(sent)).toEqual(sent);
    expect(MailSentView.parse({ ...sent, state: 'draft', reply: true, edited: true }).state).toBe(
      'draft',
    );
    expect(
      ServerEvent.safeParse({
        type: 'conversation.event',
        event: {
          type: 'tool.finished',
          conversationId: 'c1',
          seq: 2,
          at: 1,
          toolUseId: 't1',
          status: 'success',
          view: sent,
        },
      }).success,
    ).toBe(true);
  });

  it('never carries a link that isn’t a web link, nor more than a preview', () => {
    expect(MailSentView.safeParse({ ...sent, url: 'javascript:alert(1)' }).success).toBe(false);
    expect(MailSentView.safeParse({ ...sent, body: 'x'.repeat(4001) }).success).toBe(false);
    expect(MailSentView.safeParse({ ...sent, to: [] }).success).toBe(false);
    expect(MailSentView.safeParse({ ...sent, state: 'maybe' }).success).toBe(false);
  });
});

describe('an email changed on its card', () => {
  const change = { to: ['kim@example.org'], subject: 'Lunch', body: 'Noon.' };

  it('rides on the answer, and only its words and people', () => {
    expect(
      ClientCommand.parse({
        type: 'permission.respond',
        conversationId: 'c1',
        permissionId: 'p1',
        decision: 'allow',
        edit: change,
      }),
    ).toMatchObject({ edit: change });
    expect(MailEdit.safeParse({ ...change, accountId: 'other@x.org' }).success).toBe(false);
    expect(MailEdit.safeParse({ ...change, sourceMessageId: 'm1' }).success).toBe(false);
  });

  it('is an email Gmail could send: someone to send to, addresses, a one-line subject', () => {
    expect(MailEdit.safeParse({ ...change, to: [] }).success).toBe(false);
    expect(MailEdit.safeParse({ ...change, to: ['not an address'] }).success).toBe(false);
    expect(MailEdit.safeParse({ ...change, subject: 'Hi\r\nBcc: x@evil.example' }).success).toBe(
      false,
    );
    expect(MailEdit.safeParse({ ...change, cc: ['sam@example.org'] }).success).toBe(true);
  });
});
