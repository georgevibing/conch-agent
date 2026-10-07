import type { Meta, StoryObj } from '@storybook/react-vite';

import { Stack } from '../../components/Stack';
import { InlineCode } from '../CodeBlock';
import { TaskCard } from './TaskCard';

const NOW = 1_790_000_000_000;

const meta = {
  title: 'Patterns/Tasks/TaskCard',
  component: TaskCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A task working away in the background: what it is, how it’s going in words, what it’s doing right now and what it did, how long it’s been, and the one or two things you can do. In a chat it’s compact; on the Tasks page it shows everything. A helper (part of a bigger job the assistant split up) is marked as one.',
      },
    },
  },
  args: {
    title: 'Tidy up the README',
    status: 'running',
    startedAt: NOW - 95_000,
    now: NOW,
    current: (
      <>
        Running <InlineCode>npm test</InlineCode>
      </>
    ),
    steps: [
      'Read README.md',
      <>
        Ran <InlineCode>npm install</InlineCode>
      </>,
    ],
    onOpen: () => undefined,
    onStop: () => undefined,
    onRetry: () => undefined,
    onRemove: () => undefined,
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 600 }}>{Story()}</div>],
} satisfies Meta<typeof TaskCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};
export const Queued: Story = {
  args: { status: 'queued', startedAt: undefined, current: undefined, steps: [] },
};
export const NeedsYou: Story = {
  args: {
    status: 'needs-you',
    current: (
      <>
        Wants to run <InlineCode>git push</InlineCode>
      </>
    ),
  },
};
export const Done: Story = {
  args: {
    status: 'done',
    finishedAt: NOW - 10_000,
    summary:
      'The README now has install steps, a quick start and a troubleshooting section. Tests pass.',
    note: 'Claude Code reached its limit, so OpenRouter carried on.',
  },
};
export const Failed: Story = {
  args: {
    status: 'failed',
    finishedAt: NOW,
    error: 'OpenRouter isn’t available right now. Try again in a moment.',
  },
};
export const Interrupted: Story = {
  args: { status: 'interrupted', finishedAt: NOW, error: 'Conch stopped while this was running.' },
};
export const HelpersInAChat: Story = {
  render: (args) => (
    <Stack gap={2}>
      <TaskCard
        {...args}
        variant="compact"
        kind="helper"
        title="Read the README"
        status="done"
        summary="Install steps are missing."
        onStop={undefined}
        onRemove={undefined}
      />
      <TaskCard {...args} variant="compact" kind="helper" title="Check the tests" />
      <TaskCard {...args} variant="compact" kind="helper" title="Write the tests" by="Codex CLI" />
      <TaskCard
        {...args}
        variant="compact"
        kind="helper"
        title="Change the parser"
        status="done"
        summary="Fixed the off-by-one."
        branch="conch/task_1a2b3c"
        onStop={undefined}
        onRemove={undefined}
      />
    </Stack>
  ),
};

export const Unverified: Story = {
  args: {
    status: 'unverified',
    finishedAt: NOW,
    summary: 'A draft may have been saved.',
    error:
      'The provider response was lost. Inspect your drafts; Conch will not create another one automatically.',
  },
};

/** Waiting for your OK, answered right on its card in the chat it came from. */
export const AskingInAChat: Story = {
  args: {
    variant: 'compact',
    kind: 'helper',
    title: 'Check the tests',
    status: 'needs-you',
    mode: 'Ask first',
    asking: {
      summary: (
        <>
          run <InlineCode>npm test</InlineCode>
        </>
      ),
      command: 'npm test -- --run src/parser',
      onAllow: () => undefined,
      onDeny: () => undefined,
    },
  },
};

/** On the Tasks page: where it came from, and the mode it runs in (its chat’s). */
export const FromAChat: Story = {
  args: {
    mode: 'Full trust',
    from: <a href="#chat">Fix the parser</a>,
  },
};

export const FinishedUnchecked: Story = {
  args: {
    status: 'unverified',
    unchecked: true,
    finishedAt: NOW,
    summary:
      'Read the source files and wrote the report. No automatic completion criteria were set.',
    error: undefined,
  },
};
