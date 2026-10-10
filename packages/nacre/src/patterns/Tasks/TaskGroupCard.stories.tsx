import type { Meta, StoryObj } from '@storybook/react-vite';

import { InlineCode } from '../CodeBlock';
import { TaskGroupCard, type TaskGroupItem } from './TaskGroupCard';

const NOW = 1_790_000_000_000;

const working: TaskGroupItem[] = [
  {
    id: 'a',
    title: 'Add dark mode to settings',
    status: 'needs-you',
    startedAt: NOW - 120_000,
    asking: {
      summary: (
        <>
          run <InlineCode>pnpm install</InlineCode>
        </>
      ),
      command: 'pnpm install',
      onAllow: () => undefined,
      onDeny: () => undefined,
    },
  },
  {
    id: 'b',
    title: 'Write tests for the importer',
    status: 'running',
    startedAt: NOW - 95_000,
    current: (
      <>
        Running <InlineCode>pnpm test</InlineCode>
      </>
    ),
  },
  {
    id: 'c',
    title: 'Tidy up the README',
    status: 'done',
    startedAt: NOW - 90_000,
    finishedAt: NOW - 30_000,
    summary: 'Rewrote the setup section and fixed three broken links.',
  },
  { id: 'd', title: 'Look into the slow search', status: 'queued' },
];

const finished: TaskGroupItem[] = [
  {
    id: 'a',
    title: 'Add dark mode to settings',
    status: 'done',
    startedAt: NOW - 300_000,
    finishedAt: NOW - 60_000,
    summary: 'Added a theme switch to Settings › Appearance; it follows the system by default.',
  },
  {
    id: 'b',
    title: 'Write tests for the importer',
    status: 'failed',
    startedAt: NOW - 300_000,
    finishedAt: NOW - 100_000,
    error: 'The importer needs a sample export to test against, and there isn’t one in the repo.',
  },
  {
    id: 'c',
    title: 'Tidy up the README',
    status: 'done',
    startedAt: NOW - 290_000,
    finishedAt: NOW - 200_000,
    summary:
      'Saved markdown artifact “Setup” successfully.\nArtifact ID: a_a460ef7a7e25954d1f85dc2fe5fe2f3e\nVersion: 1\nError: none.',
  },
];

const meta = {
  title: 'Patterns/Tasks/TaskGroupCard',
  component: TaskGroupCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Tasks started together, as one card in the chat they came from: how the batch stands in a line and a bar (a segment per task, its colour its state, a sheen of pearl light on the working ones), then a line per task. What needs your OK rises to the top and is answered right there. Once every one has finished, the bar folds away and the lines are the result. Each opens its task.',
      },
    },
  },
  args: { tasks: working, now: NOW, onOpen: () => undefined },
  decorators: [(Story) => <div style={{ maxInlineSize: 600 }}>{Story()}</div>],
} satisfies Meta<typeof TaskGroupCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Working: Story = {};
export const Finished: Story = { args: { tasks: finished } };
export const TenAtOnce: Story = {
  args: {
    tasks: Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      title: `Feature ${i + 1}`,
      status: i < 6 ? 'done' : i < 9 ? 'running' : 'needs-you',
      startedAt: NOW - 200_000,
      ...(i < 6 && { finishedAt: NOW - 50_000, summary: `Built feature ${i + 1}.` }),
      ...(i >= 6 && i < 9 && { current: 'Editing files' }),
      ...(i === 9 && {
        asking: {
          summary: 'push to the remote',
          onAllow: () => undefined,
          onDeny: () => undefined,
        },
      }),
    })),
  },
};
export const OnAPhone: Story = {
  decorators: [(Story) => <div style={{ maxInlineSize: 343 }}>{Story()}</div>],
};

/**
 * Five at once, where this computer has room for four right now (ADR 0128):
 * the header says how many fit, each waiting line says why, and the one that
 * waits only for room offers **Start now**.
 */
const fiveAtOnce: TaskGroupItem[] = [
  {
    id: 'a',
    title: 'Fetch the release notes',
    status: 'running',
    startedAt: NOW - 40_000,
    current: 'Reading github.com',
  },
  {
    id: 'b',
    title: 'Run the test suite',
    status: 'running',
    startedAt: NOW - 38_000,
    current: (
      <>
        Running <InlineCode>pnpm test</InlineCode>
      </>
    ),
  },
  {
    id: 'c',
    title: 'Fix the login',
    status: 'running',
    startedAt: NOW - 38_000,
    current: 'Changing src/auth.ts',
  },
  {
    id: 'd',
    title: 'Draft the changelog',
    status: 'done',
    startedAt: NOW - 40_000,
    finishedAt: NOW - 10_000,
    summary: 'Drafted the changelog for 2.4 with the five user-facing changes.',
  },
  {
    id: 'e',
    title: 'Tidy the auth helpers',
    status: 'queued',
    waiting: { words: 'Starts when “Fix the login” finishes: both change auth.ts' },
  },
  {
    id: 'f',
    title: 'Check the docs build',
    status: 'queued',
    waiting: {
      words: 'Starts when one of the 3 working finishes',
      expectedAt: NOW + 4 * 60_000,
      onStartNow: () => undefined,
    },
  },
];
export const WaitingForRoom: Story = {
  args: { tasks: fiveAtOnce, capacity: '3 at once on this computer right now' },
};
export const ProviderSlowingDown: Story = {
  args: {
    tasks: [
      {
        id: 'a',
        title: 'Summarise the issues',
        status: 'running',
        startedAt: NOW - 20_000,
        current: 'Reading the issue list',
      },
      {
        id: 'b',
        title: 'Summarise the pull requests',
        status: 'queued',
        waiting: { words: 'Codex asked Conch to slow down', retryAt: NOW + 20_000 },
      },
    ],
  },
};
