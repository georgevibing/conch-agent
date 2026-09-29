import type { Meta, StoryObj } from '@storybook/react-vite';

import { Stack } from '../../components/Stack';
import { RunStatusBadge } from './RunStatusBadge';
import type { RunStatusValue } from './types';

const statuses: RunStatusValue[] = [
  'running',
  'needs-you',
  'succeeded',
  'nothing-to-do',
  'failed',
  'skipped',
  'missed',
  'stopped',
];

const meta = {
  title: 'Patterns/Routines/RunStatusBadge',
  component: RunStatusBadge,
  args: { status: 'succeeded' },
} satisfies Meta<typeof RunStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const All: Story = {
  render: () => (
    <Stack direction="row" gap={2} wrap>
      {statuses.map((s) => (
        <RunStatusBadge key={s} status={s} />
      ))}
    </Stack>
  ),
};
