import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { ChatMessageCard } from './ChatMessage';

const meta = {
  title: 'Patterns/Chat/ChatMessage',
  component: ChatMessageCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A message between two of your chats (ADR 0134). Where it was sent, it says to whom and whether it has been read. Where it came, it says from which chat, marked as another chat’s words, never yours; while the chat holds messages, Pass it on and Dismiss decide. ⋯ chooses whether this chat lets them in, holds them, or turns them away. The title opens the other chat.',
      },
    },
  },
  args: {
    direction: 'in',
    chatTitle: 'Fix the login redirect',
    text: 'I changed the login API: the client should call loginV2 now. I’ve left the old one in place until you’re done.',
    state: 'read',
    onOpenChat: fn(),
    inbound: 'accept',
    onInboundChange: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 640 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatMessageCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** Sent from here, not read yet. */
export const Sent: Story = {
  args: { direction: 'out', state: 'waiting', inbound: undefined, onInboundChange: undefined },
};

/** Sent to start the other chat's next reply. */
export const StartsAReply: Story = {
  args: {
    direction: 'out',
    state: 'waiting',
    wakes: true,
    text: 'The build is fixed: carry on with the release.',
    inbound: undefined,
    onInboundChange: undefined,
  },
};

/** Come to a chat that holds messages: it waits for you. */
export const Held: Story = {
  args: { state: 'held', inbound: 'hold', onPass: fn(), onDismiss: fn() },
};

/** Another chat stopped this one's reply, and said why. */
export const StoppedBy: Story = {
  args: { kind: 'stop', text: 'It would push over the changes I’m making to package.json.' },
};

/** Long words fold to a few lines. */
export const Long: Story = {
  args: {
    text: Array.from(
      { length: 8 },
      (_, i) =>
        `Step ${i + 1}: I moved the session helpers into auth/session.ts and updated the imports.`,
    ).join('\n'),
  },
};

/** On a phone. */
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 360 }}>
        <Story />
      </div>
    ),
  ],
};
