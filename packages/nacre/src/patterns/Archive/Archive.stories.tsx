import type { Meta, StoryObj } from '@storybook/react-vite';

import { IntegrationLogo } from '../Integrations';
import { ArchivedChats, type ArchivedChat } from './ArchivedChats';

const lisbon: ArchivedChat = {
  id: 'c1',
  title: 'Plan a week in Lisbon',
  archived: '2 hours ago',
  preview: 'Book the tram tour for Thursday morning, before the rain.',
};
const openRouter: ArchivedChat = {
  id: 'c2',
  title: 'Testing OpenRouter connectivity',
  archived: 'yesterday',
  preview: 'It answered. Keep this key for the small jobs.',
};

const chats: ArchivedChat[] = [
  lisbon,
  openRouter,
  {
    id: 'c3',
    title: 'Groceries for Sunday',
    archived: '3 days ago',
    preview: 'Add lemons and the good olive oil.',
    icon: <IntegrationLogo brand="telegram" name="Telegram" size="xs" decorative />,
  },
  {
    id: 'c4',
    title:
      'A very long title that goes on and on about the quarterly planning offsite and its agenda',
    archived: 'Sep 12',
  },
];

const meta = {
  title: 'Patterns/Chat/ArchivedChats',
  component: ArchivedChats,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Chats put away from the list, most recently archived first. A row opens the chat; beside it are the two ways out of the archive — **Unarchive** back to the list, or delete. Quiet on purpose: a drawer, not an inbox. Narrow, Unarchive keeps its icon and its name, and gives up the room for the word.',
      },
    },
  },
  args: {
    chats,
    onOpen: () => undefined,
    onUnarchive: () => undefined,
    onDelete: () => undefined,
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 720 }}>{Story()}</div>],
} satisfies Meta<typeof ArchivedChats>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** On a phone: the word “Unarchive” gives way to its icon. */
export const Narrow: Story = {
  decorators: [(Story) => <div style={{ maxInlineSize: 360 }}>{Story()}</div>],
};

/** Typing in the filter marks where each title matched. */
export const Filtered: Story = {
  args: {
    chats: [
      { ...lisbon, ranges: [[12, 14]] },
      { ...openRouter, ranges: [[4, 6]] },
    ],
  },
};

/** Only to read: no ways out, as on a device that may not change things. */
export const ReadOnly: Story = {
  args: { onUnarchive: undefined, onDelete: undefined },
};
