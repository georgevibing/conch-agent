import type { Meta, StoryObj } from '@storybook/react-vite';

import { Stack } from '../Stack';
import { Spinner } from './Spinner';

const meta = {
  title: 'Components/Feedback/Spinner',
  component: Spinner,
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sizes: Story = {
  render: () => (
    <Stack direction="row" gap={4} align="center" style={{ color: 'var(--nc-text-muted)' }}>
      {(['xs', 'sm', 'md', 'lg'] as const).map((size) => (
        <Spinner key={size} size={size} />
      ))}
    </Stack>
  ),
};
