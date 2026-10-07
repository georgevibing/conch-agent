import type { Meta, StoryObj } from '@storybook/react-vite';
import { MoreHorizontal } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { fn } from 'storybook/test';

import { IconButton } from '../../components/IconButton';
import { ChatListSection } from '../ChatList/ChatListSection';
import { ChatRow } from '../ChatList/ChatRow';
import { InlineCode } from '../CodeBlock';
import { ChatTasks, type ChatTask } from './ChatTasks';

const NOW = 1_790_000_000_000;

const sidebar: CSSProperties = {
  inlineSize: '17rem',
  background: 'var(--nc-canvas-raised)',
  borderRadius: 'var(--nc-radius-lg)',
  boxShadow: 'inset 0 0 0 1px var(--nc-border-subtle)',
};

const TASKS: ChatTask[] = [
  {
    id: 't1',
    link: <a href="#t1">Check the tests</a>,
    kind: 'helper',
    status: 'needs-you',
    startedAt: NOW - 70_000,
    current: (
      <>
        Wants to run <InlineCode>npm test</InlineCode>
      </>
    ),
    onStop: fn(),
  },
  {
    id: 't2',
    link: <a href="#t2">Write the parser tests</a>,
    kind: 'helper',
    status: 'running',
    startedAt: NOW - 95_000,
    current: (
      <>
        Changing <InlineCode>parser.test.ts</InlineCode>
      </>
    ),
    by: 'Codex CLI',
    onStop: fn(),
  },
  {
    id: 't3',
    link: <a href="#t3">Read the README</a>,
    kind: 'helper',
    status: 'done',
    startedAt: NOW - 200_000,
    finishedAt: NOW - 150_000,
  },
  {
    id: 't4',
    link: <a href="#t4">Tidy the changelog</a>,
    status: 'queued',
    onStop: fn(),
  },
];

const meta = {
  title: 'Patterns/Tasks/ChatTasks',
  component: ChatTasks,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A chat’s tasks, under it in the sidebar: one quiet line that says how many and how they’re going (what needs you first, in words and with a mark), opening into a row per task with what it’s doing right now and how long it’s been. A press opens the task’s own chat; a working one can be stopped right there. The app opens it by itself while something is going.',
      },
    },
  },
  args: {
    tasks: TASKS,
    open: true,
    onOpenChange: fn(),
    chat: 'Fix the parser',
    now: NOW,
  },
  decorators: [
    (Story) => (
      <div style={sidebar}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatTasks>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Closed: Story = { args: { open: false } };

export const AllFinished: Story = {
  args: {
    open: false,
    tasks: [
      { ...(TASKS[2] as ChatTask), id: 'a' },
      {
        id: 'b',
        link: <a href="#b">Draft the release notes</a>,
        status: 'failed',
        startedAt: NOW - 400_000,
        finishedAt: NOW - 380_000,
      },
    ],
  },
};

/** As it sits in the chat list: under its chat, the row above unchanged. */
export const InTheChatList: Story = {
  render: function Render(args) {
    const [open, setOpen] = useState(true);
    const more = (
      <IconButton size="sm" label="Options" tooltip={false}>
        <MoreHorizontal />
      </IconButton>
    );
    return (
      <ChatListSection label="Today">
        <ChatRow status="waiting" menu={more}>
          <a href="#c1">Plan a week in Lisbon</a>
        </ChatRow>
        <ChatRow
          active
          status="working"
          menu={more}
          below={<ChatTasks {...args} open={open} onOpenChange={setOpen} />}
        >
          <a href="#c2">Fix the parser</a>
        </ChatRow>
        <ChatRow menu={more}>
          <a href="#c3">Gift ideas for Ana</a>
        </ChatRow>
      </ChatListSection>
    );
  },
};

export const FinishedUnchecked: Story = {
  args: {
    tasks: [
      {
        id: 'finished',
        link: <a href="#finished">Read the source</a>,
        status: 'unverified',
        unchecked: true,
        startedAt: NOW - 60_000,
        finishedAt: NOW,
      },
    ],
  },
};
