import type { Meta, StoryObj } from '@storybook/react-vite';
import { MoreHorizontal } from 'lucide-react';
import { useId, useState, type CSSProperties } from 'react';
import { fn } from 'storybook/test';

import { IconButton } from '../../components/IconButton';
import { ChatListSection } from '../ChatList/ChatListSection';
import { ChatRow } from '../ChatList/ChatRow';
import { InlineCode } from '../CodeBlock';
import { ChatTasks, ChatTasksToggle, type ChatTask } from './ChatTasks';

const NOW = 1_790_000_000_000;

const sidebar: CSSProperties = {
  inlineSize: '17rem',
  background: 'var(--nc-canvas-raised)',
  borderRadius: 'var(--nc-radius-lg)',
  boxShadow: 'inset 0 0 0 1px var(--nc-border-subtle)',
  padding: 'var(--nc-space-1)',
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
    finishedAt: NOW - 166_000,
  },
  {
    id: 't4',
    link: <a href="#t4">Draft the release notes</a>,
    status: 'failed',
    reason: 'The model ran out of room',
    startedAt: NOW - 400_000,
    finishedAt: NOW - 380_000,
  },
  {
    id: 't5',
    link: <a href="#t5">Tidy the changelog</a>,
    status: 'queued',
    onStop: fn(),
  },
];

const FINISHED: ChatTask[] = [
  { ...(TASKS[2] as ChatTask), id: 'a' },
  {
    id: 'b',
    link: <a href="#b">Read the source</a>,
    status: 'unverified',
    unchecked: true,
    startedAt: NOW - 31_000,
    finishedAt: NOW,
  },
  {
    id: 'c',
    link: <a href="#c">Watch the build</a>,
    status: 'stopped',
    startedAt: NOW - 90_000,
    finishedAt: NOW - 30_000,
  },
];

const more = (
  <IconButton size="sm" label="Options" tooltip={false}>
    <MoreHorizontal />
  </IconButton>
);

/** A chat with its tasks, as the app puts it in the list: the badge on its row, the rows under it. */
function ChatWithTasks({
  title,
  tasks,
  open: initial,
  now,
  active,
  earlier,
}: {
  title: string;
  tasks: readonly ChatTask[];
  open: boolean;
  now?: number;
  active?: boolean;
  earlier?: readonly ChatTask[];
}) {
  const id = useId();
  const [open, setOpen] = useState(initial);
  return (
    <ChatRow
      active={active}
      menu={more}
      disclosure={
        <ChatTasksToggle
          tasks={tasks}
          open={open}
          onOpenChange={setOpen}
          chat={title}
          aria-controls={id}
        />
      }
      below={
        <ChatTasks id={id} tasks={tasks} earlier={earlier} open={open} chat={title} now={now} />
      }
    >
      <a href="#chat">{title}</a>
    </ChatRow>
  );
}

const meta = {
  title: 'Patterns/Tasks/ChatTasks',
  component: ChatTasks,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A chat’s tasks in the sidebar. The chat keeps its one line: a small badge on it says how many and how they’re going — a turning ring of lustre while something works, a hand in amber when one needs you, a tint when one didn’t finish — and opens the tasks under it. Each sits on the chat’s own grid, its mark where the chat’s title starts, threaded on a guide: a tick when done, a cross when it didn’t finish (and why, in a few words), a stop when stopped. A press opens the task’s own chat; a working one can be stopped right there. The app opens them by itself while something is going. One that finished while you were elsewhere is `fresh`: a dot, its title forward, a sheen of lustre once. What you’ve seen goes in `earlier`, folded under “Earlier”, and a row that leaves folds shut where it was.',
      },
    },
  },
  args: {
    tasks: TASKS,
    open: true,
    chat: 'Fix the parser',
    now: NOW,
  },
  render: (args) => (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
      {/* Keyed, so the `open` control starts it over. */}
      <ChatWithTasks
        key={String(args.open)}
        title={args.chat}
        tasks={args.tasks}
        open={args.open}
        now={args.now}
      />
    </ul>
  ),
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

export const AllFinished: Story = { args: { tasks: FINISHED } };

export const OneDidntFinish: Story = {
  args: { open: false, tasks: [TASKS[3] as ChatTask, TASKS[2] as ChatTask] },
};

/** As it sits in the chat list: in a folder too, the tasks keep to their chat's grid. */
export const InTheChatList: Story = {
  render: (args) => (
    <>
      <ChatListSection label="Today">
        <ChatRow status="waiting" menu={more}>
          <a href="#c1">Plan a week in Lisbon</a>
        </ChatRow>
        <ChatWithTasks active title="Fix the parser" tasks={args.tasks} open now={NOW} />
        <ChatRow menu={more}>
          <a href="#c3">Gift ideas for Ana</a>
        </ChatRow>
      </ChatListSection>
      <ChatListSection label="Conch Codebase" kind="folder" collapsible defaultOpen>
        <ChatWithTasks title="Task system probes" tasks={FINISHED} open={false} now={NOW} />
        <ChatRow menu={more}>
          <a href="#c5">Release notes</a>
        </ChatRow>
      </ChatListSection>
    </>
  ),
};

const FRESH: ChatTask = {
  id: 'f',
  link: <a href="#f">Draft the release notes</a>,
  status: 'done',
  startedAt: NOW - 140_000,
  finishedAt: NOW - 20_000,
  fresh: true,
};

/** Seen or not: the row stands out until you've looked, then folds away under "Earlier". */
function Tidying() {
  const [seen, setSeen] = useState(false);
  const working = TASKS[1] as ChatTask;
  return (
    <>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        <ChatWithTasks
          title="Fix the parser"
          tasks={seen ? [working] : [working, FRESH]}
          earlier={seen ? [{ ...FRESH, fresh: false }, ...FINISHED] : FINISHED}
          open
          now={NOW}
        />
      </ul>
      <button type="button" style={{ marginBlockStart: 16 }} onClick={() => setSeen((v) => !v)}>
        {seen ? 'Bring it back' : 'Seen it'}
      </button>
    </>
  );
}

/**
 * Tidied away: what finished while you were elsewhere stands out (a dot, the
 * title forward, a sheen of lustre once), and what you've seen folds under
 * "Earlier". Press "Seen it" to watch the row fold shut where it was.
 */
export const TidiedAway: Story = {
  render: () => <Tidying />,
};
