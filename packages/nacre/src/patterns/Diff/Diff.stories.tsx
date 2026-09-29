import type { Meta, StoryObj } from '@storybook/react-vite';

import { sampleDiff } from '../fixtures';
import { Diff, DiffStat } from './Diff';

const meta = {
  title: 'Patterns/Chat/Diff',
  component: Diff,
  args: { diff: sampleDiff, filename: 'apps/server/src/session.ts' },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Unified diff for file edits made by the agent: old/new gutters, tinted add/remove rows with an edge marker, hunk headers, and a GitHub-style change bar.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 760, marginInline: 'auto' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Diff>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
export const WithoutLineNumbers: Story = { args: { lineNumbers: false } };
export const Stat: Story = {
  render: () => <DiffStat additions={42} deletions={7} />,
};
