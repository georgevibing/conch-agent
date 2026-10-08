import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Message } from '../Message';
import { StoryStack } from '../Story';
import { MailSent } from './MailSent';

const NOW = Date.parse('2026-10-08T14:45:00Z');

const meta = {
  title: 'Patterns/Chat/MailSent',
  component: MailSent,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'An email Conch sent, as a letter that went — never a row in an inbox. A postmarked stamp, “Sent to Maya Kim” and the time, the subject, the first lines of what it said, opening to all of it and everyone it went to, and the next step: **Open in Gmail**, **Follow up** (words for the composer, never sent). A draft is the same letter kept, not posted. One that may have gone says so and points at Sent; nothing offers an undo Gmail doesn’t have.',
      },
    },
  },
  args: {
    state: 'sent',
    from: 'ada@work.example',
    to: [{ address: 'maya.kim@example.com', name: 'Maya Kim' }],
    subject: 'Friday launch checklist',
    body: 'Hi Maya,\n\nCould you share the latest launch checklist before Friday? I’d like to walk through the open items with the team on Thursday afternoon.\n\nThanks,\nAda',
    at: '2026-10-08T14:41:00Z',
    url: 'https://mail.google.com/mail/?authuser=ada%40work.example#sent/18c2',
    now: NOW,
    locale: 'en-GB',
    timeZone: 'Europe/Berlin',
    onFollowUp: fn(),
    onSendDraft: fn(),
    onRetry: fn(),
  },
} satisfies Meta<typeof MailSent>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** It went just now: the stamp lands and the postmark is pressed on. */
export const Arriving: Story = { args: { arriving: true } };

/** Only an address: the address it is. */
export const ToAnAddress: Story = {
  args: { to: ['kaltsikis.software@gmail.com'], subject: 'Hi', body: 'Hi!' },
};

export const ToSeveral: Story = {
  args: {
    to: [
      { address: 'maya.kim@example.com', name: 'Maya Kim' },
      { address: 'sam@example.org', name: 'Sam Rivera' },
      { address: 'ops@example.org' },
    ],
    cc: [{ address: 'lee@example.org', name: 'Lee Park' }],
    edited: true,
  },
};

export const ReplyInThread: Story = {
  args: {
    reply: true,
    to: [{ address: 'reply@example.com', name: 'Alice Moreau' }],
    subject: 'Re: Café on Thursday',
    body: 'Thursday at ten works for me. See you there!\n\nAda',
  },
};

export const WithFiles: Story = {
  args: {
    files: [
      { name: 'Launch checklist.pdf', mime: 'application/pdf', size: 248_000 },
      { name: 'Budget.xlsx', size: 41_000 },
    ],
  },
};

export const Sending: Story = { args: { state: 'sending' } };

/** Saved in Drafts, not sent: open it in Gmail, or ask for it to go. */
export const DraftSaved: Story = {
  args: {
    state: 'draft',
    arriving: true,
    url: 'https://mail.google.com/mail/?authuser=ada%40work.example#drafts/r-77',
  },
};

/** Gmail may have it: look in Sent before sending again. No Try again. */
export const Uncertain: Story = {
  args: {
    state: 'uncertain',
    url: 'https://mail.google.com/mail/?authuser=ada%40work.example#sent',
  },
};

export const Failed: Story = {
  args: {
    state: 'failed',
    url: undefined,
    reason: 'Gmail turned it down: that address doesn’t take email. Nothing was sent.',
  },
};

/** Where it sits: under the step that sent it, on the reply's own edge. */
export const InTheChat: Story = {
  parameters: { layout: 'fullscreen' },
  render: (args) => (
    <div style={{ maxInlineSize: '46rem', margin: '0 auto', padding: '2rem 1.5rem' }}>
      <Message from="user">Send Maya a note asking for the launch checklist before Friday.</Message>
      <Message
        from="assistant"
        attached={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--nc-chat-step)' }}>
            <StoryStack
              stories={[
                {
                  id: 'send',
                  headline: 'Sent an email',
                  family: 'connect',
                  status: 'done',
                  steps: [
                    {
                      id: 'toolu_send',
                      text: 'Sent an email',
                      status: 'success',
                      family: 'connect',
                      durationMs: 2300,
                    },
                  ],
                  durationMs: 2300,
                },
              ]}
            />
            <MailSent {...args} />
          </div>
        }
      >
        Done — I sent it to Maya from your work account.
      </Message>
    </div>
  ),
};
