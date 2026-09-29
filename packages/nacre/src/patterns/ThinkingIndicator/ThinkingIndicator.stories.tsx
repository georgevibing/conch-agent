import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Stack } from '../../components/Stack';
import { ThinkingIndicator } from './ThinkingIndicator';

const meta = {
  title: 'Patterns/Chat/ThinkingIndicator',
  component: ThinkingIndicator,
  args: { label: 'Thinking' },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md'] } },
  parameters: {
    docs: {
      description: {
        component:
          'Shown while the agent works before any output. A tiny luminous pearl swirls and breathes; a band of light sweeps across the label. It is a live region, so status changes are announced.',
      },
    },
  },
} satisfies Meta<typeof ThinkingIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithDetailAndTimer: Story = {
  render: function Render(args) {
    const [startedAt] = useState(() => Date.now() - 7000);
    return (
      <Stack gap={4}>
        <ThinkingIndicator {...args} startedAt={startedAt} />
        <ThinkingIndicator
          label="Reading files"
          detail="apps/server/src/session.ts"
          startedAt={startedAt}
        />
        <ThinkingIndicator label="Running tests" size="sm" />
      </Stack>
    );
  },
};
