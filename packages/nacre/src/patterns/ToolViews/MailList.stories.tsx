import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { AppTool, InChat, mail, ViewSurface } from './fixtures';
import { MailList, replyRequest, type MailMessage } from './MailList';

const now = Date.now();
const many: MailMessage[] = Array.from({ length: 12 }, (_, i) => ({
  ...(mail(now)[i % 4] as MailMessage),
  unread: i < 3,
}));

const meta = {
  title: 'Patterns/Chat/MailList',
  component: MailList,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Emails a search found, under its tool row (ADR 0060): who, what about, one line of what it says, and when, with a dot for unread and a clip for attachments. A row opens the email in a new tab. **Reply** is quiet (it waits for the pointer, and is always there on touch) and only puts words for the assistant in the composer: it never sends.',
      },
    },
  },
  args: { messages: mail(now), now, onReply: () => {} },
  decorators: [
    (Story) => (
      <ViewSurface>
        <Story />
      </ViewSurface>
    ),
  ],
} satisfies Meta<typeof MailList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** Without Reply: rows that only open. */
export const ReadOnly: Story = { args: { onReply: undefined } };

/** Many results fold after six. */
export const Many: Story = { args: { messages: many } };

/** Nothing matched. */
export const Empty: Story = { args: { messages: [] } };

/** What the service didn’t say is simply left out. */
export const Sparse: Story = {
  args: {
    messages: [
      {
        from: 'sam@example.org',
        subject: '(no subject)',
        date: new Date(now - 60_000).toISOString(),
      },
    ],
  },
};

/** As it sits in a chat; Reply puts its words in the composer. */
export const InAConversation: Story = {
  decorators: [(Story) => <Story />],
  render: function Render() {
    const [draft, setDraft] = useState('');
    return (
      <>
        <InChat
          ask="Find the budget email from Ada"
          answer="The newest is Ada’s “Q4 budget, final numbers” from two hours ago, with the spreadsheet attached. Sam also asked to move the budget review to Thursday."
        >
          <AppTool brand="gmail" app="Gmail" title="Search your mail" summary="budget">
            <MailList messages={mail(now)} now={now} onReply={(m) => setDraft(replyRequest(m))} />
          </AppTool>
        </InChat>
        <p style={{ maxInlineSize: 760, margin: '12px auto', color: 'var(--nc-text-muted)' }}>
          Composer: {draft || '(empty)'}
        </p>
      </>
    );
  },
};
