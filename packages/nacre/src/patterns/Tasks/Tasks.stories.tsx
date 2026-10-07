import type { Meta, StoryObj } from '@storybook/react-vite';

import { Stack } from '../../components/Stack';
import { InlineCode } from '../CodeBlock';
import { TaskCard } from './TaskCard';

const NOW = 1_790_000_000_000;

/** `code` in a step, as code: what the web app does. */
const code = (label: string) =>
  label
    .split(/`([^`]+)`/)
    .map((part, i) => (i % 2 ? <InlineCode key={i}>{part}</InlineCode> : part));

const meta = {
  title: 'Patterns/Tasks/TaskCard',
  component: TaskCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A task, read at a glance: what it is, how it’s going in words and with a mark that moves (a band of pearl light turning while it works, a check that draws itself, a nudge when it didn’t finish), and how long it’s been. Once it’s over it says one of two things: Done, or Didn’t finish (Stopped, when you stopped it). Done is worth a look only for a concrete reason, said in a few words. One line says what came of it — or what went wrong — without ids or bookkeeping; its whole result, what was confirmed and what it did wait behind the Details chevron. Whoever started it, the assistant or you, it’s a task.',
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
    steps: ['Read README.md', 'Ran `npm install`'],
    renderStep: code,
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
  args: { status: 'interrupted', finishedAt: NOW, error: 'Conch stopped while it was working.' },
};
export const SeveralInAChat: Story = {
  render: (args) => (
    <Stack gap={2}>
      <TaskCard
        {...args}
        variant="compact"
        title="Read the README"
        status="done"
        summary="Install steps are missing."
        onStop={undefined}
        onRemove={undefined}
      />
      <TaskCard {...args} variant="compact" title="Check the tests" />
      <TaskCard {...args} variant="compact" title="Write the tests" by="Codex CLI" />
      <TaskCard
        {...args}
        variant="compact"
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

/** Done, but worth a look: a concrete reason, in a few words. */
export const WorthALook: Story = {
  args: {
    status: 'unverified',
    finishedAt: NOW,
    summary: 'A draft may have been saved.',
    worth: 'Couldn’t confirm one of its actions worked.',
  },
};

/** Waiting for your OK, answered right on its card in the chat it came from. */
export const AskingInAChat: Story = {
  args: {
    variant: 'compact',
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

/** Nothing set to check it against: done is done. */
export const DoneUnchecked: Story = {
  args: {
    status: 'unverified',
    finishedAt: NOW,
    summary: 'Read the source files and wrote the report.',
  },
};

/**
 * A long, machine-flavoured result, as tasks often write them: one line in
 * view, ids left out, the rest behind Details.
 */
export const LongResult: Story = {
  args: {
    variant: 'compact',
    title: 'Task probe recovery rerun',
    status: 'unverified',
    startedAt: NOW - 31_000,
    finishedAt: NOW,
    current: undefined,
    summary:
      'Diagnostic passed. Initial Read returned the expected ENOENT for conch-task-probe-intentionally-missing-rerun-20261007-b92e.txt. Write and final Read succeeded; the final content matched exactly "recovered successfully\\n", including the trailing newline. No unexpected errors. Left conch-task-probe-recovery-rerun-20261007-b92e.txt in the work folder for inspection.',
    details: (
      <ul aria-label="Confirmed results">
        <li>Verified conch-task-probe-recovery-rerun-20261007-b92e.txt</li>
        <li>Read conch-task-probe-recovery-rerun-20261007-b92e.txt</li>
      </ul>
    ),
    onStop: undefined,
    onRemove: undefined,
    onRetry: undefined,
  },
};

/**
 * A busy task, as the gateway reports it: the same poll again and again said
 * once (×6), a run of reads folded into one line that opens, a failure marked.
 */
export const ManySteps: Story = {
  args: {
    status: 'done',
    finishedAt: NOW,
    current: undefined,
    summary: 'Fixed the flaky pager test: it counted one page too many.',
    defaultExpanded: true,
    steps: [
      'Tool returned: Read src/pager.ts',
      'Tool returned: Read src/pager.test.ts',
      'Tool returned: Read src/fixtures/pages.ts',
      'Tool returned: Read src/index.ts',
      'Tool returned: Run `npm test`',
      ...Array.from({ length: 6 }, () => 'Tool returned: Read command progress'),
      'Tool failed: Edit src/pager.ts',
      'Tool returned: Edit src/pager.ts',
      'Tool returned: Run `npm test`',
    ],
  },
};

/** Every state side by side, as they'd stack in a chat. */
export const AllStates: Story = {
  render: (args) => (
    <Stack gap={2}>
      <TaskCard
        {...args}
        variant="compact"
        title="Waiting"
        status="queued"
        current={undefined}
        steps={[]}
      />
      <TaskCard {...args} variant="compact" title="Working" />
      <TaskCard
        {...args}
        variant="compact"
        title="Ship it"
        status="needs-you"
        current="Wants to run git push"
        steps={[]}
      />
      <TaskCard
        {...args}
        variant="compact"
        title="Checked and done"
        status="done"
        finishedAt={NOW}
        summary="Saved the draft “Weekly update”."
      />
      <TaskCard
        {...args}
        variant="compact"
        title="Done, nothing to check against"
        status="unverified"
        finishedAt={NOW}
        summary="Wrote the report."
      />
      <TaskCard
        {...args}
        variant="compact"
        title="Worth a look"
        status="unverified"
        finishedAt={NOW}
        worth="Couldn’t confirm one of its actions worked."
      />
      <TaskCard
        {...args}
        variant="compact"
        title="Didn’t finish"
        status="failed"
        finishedAt={NOW}
        error="OpenRouter isn’t available right now."
      />
      <TaskCard {...args} variant="compact" title="Stopped" status="stopped" finishedAt={NOW} />
    </Stack>
  ),
};
