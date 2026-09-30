import type { Meta, StoryObj } from '@storybook/react-vite';
import { Copy, MoreHorizontal, Paperclip, RotateCcw, Settings, Square } from 'lucide-react';
import { expect, userEvent, within } from 'storybook/test';

import { Stack } from '../Stack';
import { IconButton } from './IconButton';

const meta = {
  title: 'Components/Actions/IconButton',
  component: IconButton,
  args: { label: 'Settings', children: <Settings /> },
  argTypes: { children: { control: false } },
  parameters: {
    docs: {
      description: {
        component:
          'Icon-only button. `label` is required — it becomes the accessible name and, by default, a tooltip. Pass `shortcut` to show a key hint in the tooltip.',
      },
    },
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Toolbar: Story = {
  render: () => (
    <Stack direction="row" gap={1}>
      <IconButton label="Copy" shortcut="mod+c">
        <Copy />
      </IconButton>
      <IconButton label="Retry">
        <RotateCcw />
      </IconButton>
      <IconButton label="Attach file">
        <Paperclip />
      </IconButton>
      <IconButton label="More actions">
        <MoreHorizontal />
      </IconButton>
    </Stack>
  ),
};

export const Variants: Story = {
  render: () => (
    <Stack direction="row" gap={3} align="center">
      <IconButton label="Stop" variant="solid" shape="circle">
        <Square fill="currentColor" />
      </IconButton>
      <IconButton label="Settings" variant="soft">
        <Settings />
      </IconButton>
      <IconButton label="Settings" variant="surface">
        <Settings />
      </IconButton>
      <IconButton label="Settings" variant="ghost">
        <Settings />
      </IconButton>
      <IconButton label="Settings" variant="surface" loading>
        <Settings />
      </IconButton>
    </Stack>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Stack direction="row" gap={3} align="center">
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <IconButton key={size} label={`Settings ${size}`} size={size} variant="surface">
          <Settings />
        </IconButton>
      ))}
    </Stack>
  ),
};

export const TooltipOnFocus: Story = {
  tags: ['!autodocs'],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Settings' })).toHaveFocus();
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole('tooltip')).toHaveTextContent('Settings');
  },
};

/**
 * Something waits behind the button — an update, say. A small dot, never a
 * count or a colour alone: the words are read with the label and shown in its
 * tooltip.
 */
export const WithDot: Story = {
  render: () => (
    <Stack direction="row" gap={3} align="center">
      <IconButton label="Settings" size="sm" dot="Update available">
        <Settings />
      </IconButton>
      <IconButton label="Settings" dot="Update available">
        <Settings />
      </IconButton>
      <IconButton label="Settings" size="lg" dot="Update available">
        <Settings />
      </IconButton>
    </Stack>
  ),
};
