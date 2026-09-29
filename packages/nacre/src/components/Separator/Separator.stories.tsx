import type { Meta, StoryObj } from '@storybook/react-vite';

import { Stack } from '../Stack';
import { Text } from '../Text';
import { Separator } from './Separator';

const meta = {
  title: 'Components/Display/Separator',
  component: Separator,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  render: (args) => (
    <Stack gap={4} style={{ inlineSize: 420 }}>
      <Text tone="muted">Session settings</Text>
      <Separator {...args} />
      <Text tone="muted">Permissions</Text>
    </Stack>
  ),
};

export const Vertical: Story = {
  render: () => (
    <Stack direction="row" gap={3} align="center" style={{ blockSize: 24 }}>
      <Text size="sm">Opus 5.5</Text>
      <Separator orientation="vertical" />
      <Text size="sm" tone="muted">
        ~/projects/conch
      </Text>
      <Separator orientation="vertical" />
      <Text size="sm" tone="muted">
        main
      </Text>
    </Stack>
  ),
};

export const WithLabel: Story = {
  args: { label: 'Today' },
  render: (args) => (
    <Stack gap={4} style={{ inlineSize: 480 }}>
      <Text size="sm" tone="muted">
        Refactored the session store.
      </Text>
      <Separator {...args} />
      <Text size="sm" tone="muted">
        Can you add retries to the gateway?
      </Text>
    </Stack>
  ),
};
