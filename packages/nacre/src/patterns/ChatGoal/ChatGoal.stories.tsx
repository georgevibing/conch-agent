import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Composer } from '../Composer';
import { ChatGoal, GoalNote } from './ChatGoal';

const meta = {
  title: 'Patterns/Chat/ChatGoal',
  component: ChatGoal,
  parameters: {
    docs: {
      description: {
        component:
          'A chat’s goal (`/goal`): what the chat is for, kept in the assistant’s mind in every reply, whichever provider answers, and kept when the chat is cleared. One quiet line above the composer, in the same family as a skill’s hold; it opens to show the goal whole, with Edit and Clear goal. In the transcript, `GoalNote` marks where it was set or cleared.',
      },
    },
  },
  args: {
    goal: 'Get the release notes for 2.4 written and checked against the changelog',
    onEdit: fn(),
    onClear: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', gap: 12, inlineSize: 'min(40rem, 90vw)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatGoal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** A long goal stays one line; the whole of it is a press away. */
export const Long: Story = {
  args: {
    goal: 'Move every photo from the old laptop into the family library, sorted by year, with duplicates set aside for me to check, and nothing deleted for good',
  },
};

/** Where it sits: above the message box, with what the chat is held to. */
export const AboveTheComposer: Story = {
  render: (args) => (
    <>
      <ChatGoal {...args} />
      <Composer placeholder="Message Conch, or type / for commands" />
    </>
  ),
};

/** In the transcript. */
export const Notes: Story = {
  render: (args) => (
    <>
      <GoalNote goal={args.goal} />
      <GoalNote />
    </>
  ),
};
