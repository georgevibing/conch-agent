import type { Meta, StoryObj } from '@storybook/react-vite';

import { Stack } from '../Stack';
import { Kbd } from './Kbd';

const meta = {
  title: 'Components/Display/Kbd',
  component: Kbd,
  args: { keys: 'mod+k' },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Common: Story = {
  render: () => (
    <Stack direction="row" gap={4} align="center">
      <Kbd keys="mod+k" />
      <Kbd keys={['shift', 'enter']} />
      <Kbd keys="esc" />
      <Kbd keys="mod+shift+p" size="sm" />
    </Stack>
  ),
};
