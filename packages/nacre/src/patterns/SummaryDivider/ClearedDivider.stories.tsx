import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Message, MessageList } from '../Message';
import { Prose } from '../Prose';
import { ClearedDivider } from './ClearedDivider';

const meta = {
  title: 'Patterns/Chat/ClearedDivider',
  component: ClearedDivider,
  parameters: {
    docs: {
      description: {
        component:
          '`/clear` starts the conversation afresh for the assistant, whichever provider answers, without deleting anything: this quiet line marks where. Everything above stays for the person; nothing above reaches the model again. Until something new is sent, Undo puts it back. The chat’s goal and what it is held to stay.',
      },
    },
  },
  args: { name: 'Conch', onUndo: fn() },
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', gap: 16, maxInlineSize: '44rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ClearedDivider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** Once something new was sent, there's no going back: the line stays, Undo goes. */
export const Settled: Story = { args: { onUndo: undefined } };

export const Undoing: Story = { args: { undoing: true } };

/** Where it sits: after the old conversation, before a fresh start. */
export const InAChat: Story = {
  render: (args) => (
    <MessageList>
      <Message from="user" timestamp={new Date(2026, 9, 3, 9, 12)}>
        Thanks, that’s the garden sorted.
      </Message>
      <Message from="assistant" author="Conch" timestamp={new Date(2026, 9, 3, 9, 12)}>
        <Prose>
          <p>Enjoy the tomatoes!</p>
        </Prose>
      </Message>
      <ClearedDivider {...args} />
    </MessageList>
  ),
};
