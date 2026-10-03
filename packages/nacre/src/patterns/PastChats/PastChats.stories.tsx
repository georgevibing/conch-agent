import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { PastChatsLook, type PastChatView } from './PastChats';

const wedding: PastChatView = {
  id: 'c1',
  title: 'Wedding planning',
  when: '6 days ago',
  lines: [
    { id: 'u1', who: 'You', text: 'Which venue did we pick in the end?', ranges: [[6, 11]] },
    {
      id: 'a1',
      who: 'Shelly',
      text: 'We decided on the venue at Quinta da Regaleira, with the garden for the ceremony and the hall if it rains.',
      ranges: [[18, 23]],
    },
  ],
};

const telegram: PastChatView = {
  id: 'c2',
  title: 'Venue shortlist',
  when: 'Sep 12',
  from: 'Telegram',
  archived: true,
  lines: [
    {
      id: 'u2',
      who: 'You',
      text: 'Send me three venue ideas near Sintra for about eighty people',
      ranges: [[14, 19]],
    },
  ],
};

const chats: PastChatView[] = [
  wedding,
  telegram,
  {
    id: 'c3',
    title:
      'A very long title about the catering tasting, the seating plan and who sits beside whom',
    when: 'Aug 30',
    from: 'a routine',
    lines: [
      {
        id: 'a3',
        who: 'Shelly',
        text: 'The venue asked for the final numbers by the first of October.',
        ranges: [[4, 9]],
      },
    ],
  },
];

const meta = {
  title: 'Patterns/Chat/PastChats',
  component: PastChatsLook,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Your assistant looked through your other chats (ADR 0059). A calm row in the chat, said the way a person would: what it looked for and how much it found. Open it to see where: each chat, when, and the lines that matched, marked. The title opens the chat at its first match; every line opens it at that line. Reading part of one chat is the same row with one chat in it.',
      },
    },
  },
  args: {
    action: 'search',
    query: 'venue',
    chats,
    onOpen: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 640 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PastChatsLook>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** Open, as it is when you look at what it found. */
export const Found: Story = { args: { defaultOpen: true } };

/** It read around one line of one chat. */
export const Read: Story = {
  args: { action: 'read', query: undefined, chats: [wedding], defaultOpen: true },
};

/** Nothing matched exactly; these are near (a typo). */
export const CloseMatches: Story = {
  args: { query: 'venu', close: true, chats: [wedding], defaultOpen: true },
};

/** Nothing in any other chat. Nothing to open, so it doesn't open. */
export const NothingFound: Story = { args: { query: 'zeppelin', chats: [] } };

/** On a phone, the place and the day go under the title. */
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
