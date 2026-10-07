import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { fn } from 'storybook/test';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { Message } from '../Message';
import { Prose } from '../Prose';
import { ToolCall } from '../ToolCall';
import { PlanApproval } from './PlanApproval';
import { PlanChecklist, type PlanChecklistStep } from './PlanChecklist';

const TITLES: [string, string][] = [
  ['Look through the folder', 'Looking through the folder'],
  ['Sort everything by kind', 'Sorting everything by kind'],
  ['Give the screenshots clear names', 'Giving the screenshots clear names'],
  ['Clear out the duplicates', 'Clearing out the duplicates'],
  ['Write a short note of what moved', 'Writing a short note of what moved'],
];

/** The plan with `done` steps finished and the next one being done. */
const at = (done: number, titles = TITLES): PlanChecklistStep[] =>
  titles.map(([title, doing], i) => ({
    title: i === done ? doing : title,
    status: i < done ? 'done' : i === done ? 'active' : 'pending',
  }));

const LONG: [string, string][] = [
  ['Read the failing tests', 'Reading the failing tests'],
  ['Find where dates are parsed', 'Finding where dates are parsed'],
  ['Fix the time zone offset', 'Fixing the time zone offset'],
  ['Handle dates before 1970', 'Handling dates before 1970'],
  ['Add tests for leap years', 'Adding tests for leap years'],
  ['Update the importer', 'Updating the importer'],
  ['Check the export still matches', 'Checking the export still matches'],
  ['Run the whole test suite', 'Running the whole test suite'],
  ['Tidy the changelog', 'Tidying the changelog'],
  ['Write up what changed', 'Writing up what changed'],
  ['Open the pull request', 'Opening the pull request'],
  ['Ask for a review', 'Asking for a review'],
];

const meta = {
  title: 'Patterns/Chat/PlanChecklist',
  component: PlanChecklist,
  args: { steps: at(2), folded: false, limit: 6 },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The assistant’s plan for this reply, ticking itself off as it works (ADR 0060). It sits in the reply’s flow, one per turn, updated in place: a heading with how far along it is (“2 of 5”), a thin line that fills, and the steps. Done steps are checked and step back in tone; the one being done is in full colour, named by what it’s doing, with a slow breath on its marker; the rest wait as hollow rings. A step that finishes draws its check in (instantly with reduced motion), and a step that was already done when the plan appeared just sits there. A long plan shows the steps around the work, with “Show all”. When the reply ends it folds to one quiet line, “Plan · 5 of 5 done”, which opens on a press. Claude Code’s todos, Codex’s plan updates and Conch’s own `update_plan` all draw it.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 640 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PlanChecklist>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** Just written: the first step is under way. */
export const Starting: Story = { args: { steps: at(0) } };

/** Two done, the third being done. */
export const Midway: Story = { args: { steps: at(2) } };

/** Every step ticked off, while the reply is still being written. */
export const Done: Story = { args: { steps: at(5) } };

/** Twelve steps: the ones around the work, and “Show all 12”. */
export const Long: Story = { args: { steps: at(6, LONG) } };

/** The reply ended: one quiet line. Press it to see the steps. */
export const Folded: Story = { args: { steps: at(5), folded: true } };

/** Folded, opened. */
export const FoldedOpen: Story = { args: { steps: at(5), folded: true, defaultOpen: true } };

/** Stopped partway: the plan stays as it stood. */
export const FoldedPartway: Story = { args: { steps: at(3), folded: true } };

/** Abalone. */
export const Dark: Story = { args: { steps: at(2) }, globals: { mode: 'dark' } };

/** At a phone's width, with steps long enough to wrap. */
export const Phone: Story = {
  args: {
    steps: at(1, [
      ['Read every invoice from last quarter', 'Reading every invoice from last quarter'],
      [
        'Match each one with its payment in the bank statement',
        'Matching each one with its payment in the bank statement',
      ],
      ['List the ones still unpaid', 'Listing the ones still unpaid'],
    ]),
  },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 358 }}>
        <Story />
      </div>
    ),
  ],
};

/** Ticks through by itself, so the check drawing in can be seen. */
function Ticking() {
  const [done, setDone] = useState(0);
  useEffect(() => {
    if (done > TITLES.length) return;
    const t = setTimeout(() => setDone((d) => d + 1), 1400);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <Stack gap={3}>
      <PlanChecklist steps={at(Math.min(done, TITLES.length))} folded={done > TITLES.length} />
      <Button size="sm" variant="ghost" onClick={() => setDone(0)}>
        Start again
      </Button>
    </Stack>
  );
}

export const Ticks: Story = { render: () => <Ticking /> };

/** Plan mode: the plan to approve, with Start and Keep planning. */
const written = (
  <Prose>
    <p>Here’s how I’d tidy it up:</p>
    <ol>
      <li>Look through the folder</li>
      <li>Sort everything by kind: pictures, documents, installers</li>
      <li>Give the screenshots clear names, by what’s in them</li>
      <li>Clear out the duplicates</li>
    </ol>
    <p>Nothing is deleted for good: duplicates go to the bin.</p>
  </Prose>
);

export const Approval: Story = {
  render: () => (
    <PlanApproval name="Conch" onStart={fn()} onKeepPlanning={fn()}>
      {written}
    </PlanApproval>
  ),
};

/** Plan mode, answered: a quiet line that opens to the plan again. */
export const ApprovalAnswered: Story = {
  render: () => (
    <Stack gap={3}>
      {(['started', 'kept', 'expired'] as const).map((state) => (
        <PlanApproval key={state} name="Conch" state={state} steps={at(-1).slice(0, 4)} />
      ))}
    </Stack>
  ),
};

/** Plan mode, in Abalone. */
export const ApprovalDark: Story = {
  ...Approval,
  globals: { mode: 'dark' },
};

/** Where it sits: in the reply, between the tools doing the work. */
function Conversation() {
  const [done, setDone] = useState(2);
  const ended = done > TITLES.length;
  return (
    <Stack gap={5} style={{ maxInlineSize: 720 }}>
      <Message from="user" timestamp={new Date('2026-10-03T09:12:00')}>
        tidy up this folder
      </Message>
      <Message
        from="assistant"
        timestamp={new Date('2026-10-03T09:12:04')}
        status={ended ? 'complete' : 'streaming'}
      >
        <Stack gap={3}>
          <Prose>
            <p>I’ll go through it in a few steps.</p>
          </Prose>
          <PlanChecklist steps={at(Math.min(done, TITLES.length))} folded={ended} />
          <Stack gap={1.5}>
            <ToolCall name="Glob" summary="**/*" status="success" duration={140} />
            <ToolCall name="Grep" summary="“Screenshot”" status="success" duration={320} />
            <ToolCall
              name="Bash"
              summary='mv "Screenshot 1.png" "Desk setup.png"'
              status={ended ? 'success' : 'running'}
              duration={ended ? 410 : undefined}
            />
          </Stack>
          {ended && (
            <Prose>
              <p>
                All tidy. Everything is sorted by kind, the screenshots have names you can find, and
                the duplicates are in the bin.
              </p>
            </Prose>
          )}
        </Stack>
      </Message>
      <Stack direction="row" gap={2}>
        <Button size="sm" variant="surface" onClick={() => setDone((d) => d + 1)}>
          {ended ? 'Ended' : 'Next step'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDone(0)}>
          Start again
        </Button>
      </Stack>
    </Stack>
  );
}

export const InTheChat: Story = { render: () => <Conversation /> };
