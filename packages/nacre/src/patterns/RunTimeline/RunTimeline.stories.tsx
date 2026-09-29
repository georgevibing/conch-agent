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
