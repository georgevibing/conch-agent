import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { OtherChatsLook, type OtherChatView } from './OtherChats';

const chats: OtherChatView[] = [
  {
    id: 'c1',
    title: 'Fix the login redirect',
    state: 'working',
    words: 'Editing files',
    sameFolder: true,
  },
  { id: 'c2', title: 'Release notes for 0.12', state: 'needs-you', words: 'Needs you' },
  {
    id: 'c3',
    title: 'Check the nightly evals',
    state: 'working',
    words: 'Running checks',
    from: 'a task',
  },
  { id: 'c4', title: 'Lisbon in March', state: 'idle', words: 'Done for now' },
  {
    id: 'c5',
    title: 'A very long title about moving the build to the new runners and what breaks',
    state: 'stopped',
    words: 'Didn’t finish',
    from: 'Telegram',
  },
];

const meta = {
  title: 'Patterns/Chat/OtherChats',
  component: OtherChatsLook,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Your assistant checked on your other chats (ADR 0134). One calm row in the chat that says how many are busy. Open it to see each chat with the mark the chat list gives it (the working pearl, amber when it needs you, a ring when it didn’t finish), what it’s doing and whether it works in the same folder. Every row opens that chat.',
      },
    },
  },
  args: { chats, onOpen: fn() },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 640 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OtherChatsLook>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** Open, as it is when you look at what it found. */
export const Open: Story = { args: { defaultOpen: true } };

/** Nothing else is going on: nothing to open. */
export const NothingElse: Story = { args: { chats: [] } };

/** Some chats, none of them busy. */
export const Quiet: Story = {
  args: { chats: chats.filter((c) => c.state === 'idle'), defaultOpen: true },
};

/** On a phone, what each is doing goes under its title. */
export const Narrow: Story = {
  args: { defaultOpen: true },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 360 }}>
        <Story />
      </div>
    ),
  ],
};
