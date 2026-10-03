import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { Message } from '../Message';
import { Prose } from '../Prose';
import { ReplyChips } from './ReplyChips';

const three = [
  { text: 'Compare it with last year' },
  { text: 'Which month had the most new customers?' },
  { text: 'Add a column for profit' },
];

const meta = {
  title: 'Patterns/Chat/ReplyChips',
  component: ReplyChips,
  args: { replies: three, onSend: fn(), entrance: true },
  argTypes: {
    sent: { control: 'select', options: [undefined, ...three.map((r) => r.text)] },
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Replies to send next, under the latest reply (ADR 0060). Up to three quiet chips, each holding exactly the words it sends — nothing hides behind a label. They come from the assistant (`suggest_replies`) or from Conch itself (“Show it as a chart” under a table of numbers). They rise in one after another once the reply is done (at once with reduced motion), sit back from the reply in tone so the answer stays the thing you read, line up with its words, and wrap onto more lines on a phone. One tab stop; arrow keys move between chips. A press lights the chip for a beat and fades the rest, then sends the words as if typed — the message box keeps whatever you were writing.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 720 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReplyChips>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const One: Story = { args: { replies: [{ text: 'Show it as a chart' }] } };

export const Two: Story = {
  args: { replies: [{ text: 'Make it shorter' }, { text: 'Add Ada to the invite' }] },
};

export const Three: Story = {};

/** Long words wrap inside the chip, and chips wrap onto new lines: here at a phone's width. */
export const LongText: Story = {
  args: {
    replies: [
      { text: 'Move the design review to Thursday afternoon and let everyone on the invite know' },
      {
        text: 'Draft a reply to Sam saying the budget looks fine but the timeline needs another week',
      },
      { text: 'Make it shorter' },
    ],
  },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 358 }}>
        <Story />
      </div>
    ),
  ],
};

/** Just pressed: the one going out stays lit for a beat, and the rest have stepped aside. */
export const AfterSend: Story = { args: { sent: 'Which month had the most new customers?' } };

/** Abalone. */
export const Dark: Story = { globals: { mode: 'dark' } };

/** Every count side by side, for review. */
export const States: Story = {
  render: (args) => (
    <Stack gap={5} align="start">
      <ReplyChips {...args} replies={three.slice(0, 1)} />
      <ReplyChips {...args} replies={three.slice(0, 2)} />
      <ReplyChips {...args} replies={three} />
      <ReplyChips {...args} replies={three} sent={three[0]?.text} />
    </Stack>
  ),
};

function Conversation() {
  const [sent, setSent] = useState<string>();
  return (
    <Stack gap={6} style={{ maxInlineSize: 720 }}>
      <Message from="user" timestamp={new Date('2026-10-03T09:12:00')}>
        how did the shop do this spring?
      </Message>
      <Message from="assistant" author="Conch" timestamp={new Date('2026-10-03T09:12:05')}>
        <Prose>
          <p>Here are this year’s sales by month:</p>
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th style={{ textAlign: 'right' }}>Orders</th>
                <th style={{ textAlign: 'right' }}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>April</td>
                <td style={{ textAlign: 'right' }}>112</td>
                <td style={{ textAlign: 'right' }}>$4,480</td>
              </tr>
              <tr>
                <td>May</td>
                <td style={{ textAlign: 'right' }}>138</td>
                <td style={{ textAlign: 'right' }}>$5,520</td>
              </tr>
              <tr>
                <td>June</td>
                <td style={{ textAlign: 'right' }}>161</td>
                <td style={{ textAlign: 'right' }}>$6,440</td>
              </tr>
            </tbody>
          </table>
          <p>June was the best month so far.</p>
        </Prose>
      </Message>
      {sent ? (
        <Message from="user" timestamp={new Date('2026-10-03T09:12:30')}>
          {sent}
        </Message>
      ) : (
        // Lined up with the reply's words, a little closer than the next message.
        <ReplyChips
          replies={three}
          onSend={setSent}
          style={{ marginBlockStart: 'calc(var(--nc-space-3) * -1)', marginInlineStart: '2.5rem' }}
        />
      )}
      {sent && (
        <Button size="sm" variant="ghost" onClick={() => setSent(undefined)}>
          Start again
        </Button>
      )}
    </Stack>
  );
}

/** Where they sit: under the latest reply, lined up with its words. Press one. */
export const InTheChat: Story = { render: () => <Conversation /> };
