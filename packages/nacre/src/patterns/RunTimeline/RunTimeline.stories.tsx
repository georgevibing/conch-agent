import type { Meta, StoryObj } from '@storybook/react-vite';

import { RunTimeline, type RunTimelineItem } from './RunTimeline';

const hour = 3_600_000;
const now = Date.now();

const runs: RunTimelineItem[] = [
  { id: '1', status: 'running', at: now - 40_000, trigger: 'manual' },
  {
    id: '2',
    status: 'needs-you',
    at: now - 3 * hour,
    trigger: 'schedule',
    outcome: 'Wants to move 14 files into Documents/Invoices.',
    durationMs: 42_000,
  },
  {
    id: '3',
    status: 'succeeded',
    at: now - 26 * hour,
    trigger: 'schedule',
    outcome: 'Sent your briefing — 3 meetings, light rain after 4 PM.',
    durationMs: 38_000,
  },
  {
    id: '4',
    status: 'nothing-to-do',
    at: now - 50 * hour,
    trigger: 'schedule',
    outcome: 'No new files in Downloads.',
    durationMs: 9_000,
  },
  {
    id: '5',
    status: 'failed',
    at: now - 74 * hour,
    trigger: 'catch-up',
    error: 'Claude Code was signed out.',
    durationMs: 2_000,
  },
  { id: '6', status: 'missed', at: now - 98 * hour, trigger: 'schedule' },
  { id: '7', status: 'skipped', at: now - 99 * hour, trigger: 'schedule' },
];

const meta = {
  title: 'Patterns/Routines/RunTimeline',
  component: RunTimeline,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A routine’s history, newest first and grouped by day. Every run says what happened in one plain line; open one to see its full conversation.',
      },
    },
  },
  args: { runs, onOpen: () => {} },
} satisfies Meta<typeof RunTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const History: Story = {
  render: (args) => (
    <div style={{ maxInlineSize: '40rem' }}>
      <RunTimeline {...args} />
    </div>
  ),
};

export const Empty: Story = { args: { runs: [] } };

export const ReadOnly: Story = { args: { onOpen: undefined } };

/** What each run cost, and the runs a spending guard decided (ADR 0057). */
export const Spending: Story = {
  args: {
    runs: [
      {
        id: 's1',
        status: 'needs-you',
        at: now - 1 * hour,
        trigger: 'schedule',
        outcome:
          'This run stopped at its spending limit: it had used about $1.92, and a run may use $1.83.',
        durationMs: 64_000,
        cost: '$1.92',
      },
      {
        id: 's2',
        status: 'skipped',
        at: now - 5 * hour,
        trigger: 'schedule',
        outcome:
          'Waited so your own chats have room: your Claude Max plan is 84% used. It runs when it resets at 3:40 PM.',
      },
      {
        id: 's3',
        status: 'succeeded',
        at: now - 26 * hour,
        trigger: 'schedule',
        outcome: 'Sent your briefing — 3 meetings, light rain after 4 PM.',
        durationMs: 38_000,
        cost: '$0.61',
      },
      {
        id: 's4',
        status: 'succeeded',
        at: now - 50 * hour,
        trigger: 'schedule',
        outcome: 'Sent your briefing — a quiet day.',
        durationMs: 31_000,
        cost: '4% of your plan',
      },
    ],
  },
  render: (args) => (
    <div style={{ maxInlineSize: '40rem' }}>
      <RunTimeline {...args} />
    </div>
  ),
};

/** Runs something started (ADR 0056): what it was, and where. */
export const StartedByEvents: Story = {
  args: {
    runs: [
      {
        id: 'e1',
        status: 'succeeded',
        at: now - 20 * 60_000,
        trigger: 'event',
        outcome: 'Anna sent the October invoice; it needs paying by Friday.',
        durationMs: 21_000,
        event: {
          label: 'Anna Smith’s email “Invoice for October”',
          link: 'https://mail.google.com/mail/#all/18f0c',
        },
      },
      {
        id: 'e2',
        status: 'nothing-to-do',
        at: now - 5 * hour,
        trigger: 'event',
        outcome: 'Only the footer changed.',
        durationMs: 12_000,
        event: { label: 'the changes on example.com/pricing', link: 'https://example.com/pricing' },
      },
      {
        id: 'e3',
        status: 'succeeded',
        at: now - 26 * hour,
        trigger: 'event',
        outcome: 'Told you about 3 new files in Downloads.',
        durationMs: 15_000,
        event: { label: '3 changes in Downloads' },
      },
    ],
  },
  render: (args) => (
    <div style={{ maxInlineSize: '40rem' }}>
      <RunTimeline {...args} />
    </div>
  ),
};
