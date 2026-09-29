import type { Meta, StoryObj } from '@storybook/react-vite';
import { Columns2, LayoutList, Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Stack } from '../Stack';
import { Text } from '../Text';
import { SegmentedControl } from './SegmentedControl';

const meta = {
  title: 'Components/Forms/SegmentedControl',
  component: SegmentedControl,
  args: { 'aria-label': 'View', defaultValue: 'chat' },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md'] } },
  parameters: {
    docs: {
      description: {
        component:
          'Switch between a few mutually exclusive views. A porcelain pill glides between segments on a spring; it can never be deselected. Arrow keys move focus, Space/Enter select.',
      },
    },
  },
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <SegmentedControl {...args}>
      <SegmentedControl.Item value="chat">Chat</SegmentedControl.Item>
      <SegmentedControl.Item value="diff">Diff</SegmentedControl.Item>
      <SegmentedControl.Item value="terminal">Terminal</SegmentedControl.Item>
      <SegmentedControl.Item value="files">Files</SegmentedControl.Item>
    </SegmentedControl>
  ),
};

export const WithIcons: Story = {
  render: function Render() {
    const [mode, setMode] = useState('system');
    return (
      <Stack gap={3} align="center">
        <SegmentedControl aria-label="Appearance" value={mode} onValueChange={setMode}>
          <SegmentedControl.Item value="light" icon={<Sun />}>
            Pearl
          </SegmentedControl.Item>
          <SegmentedControl.Item value="dark" icon={<Moon />}>
            Abalone
          </SegmentedControl.Item>
          <SegmentedControl.Item value="system" icon={<Monitor />}>
            System
          </SegmentedControl.Item>
        </SegmentedControl>
        <Text size="sm" tone="subtle">
          Selected: {mode}
        </Text>
      </Stack>
    );
  },
};

export const IconOnly: Story = {
  render: () => (
    <SegmentedControl aria-label="Layout" defaultValue="list" size="sm">
      <SegmentedControl.Item value="list" aria-label="List" icon={<LayoutList />} />
      <SegmentedControl.Item value="split" aria-label="Split" icon={<Columns2 />} />
    </SegmentedControl>
  ),
};

export const Block: Story = {
  decorators: [(Story) => <div style={{ inlineSize: 360 }}>{Story()}</div>],
  render: () => (
    <SegmentedControl aria-label="Effort" defaultValue="medium" block>
      <SegmentedControl.Item value="low">Low</SegmentedControl.Item>
      <SegmentedControl.Item value="medium">Medium</SegmentedControl.Item>
      <SegmentedControl.Item value="high">High</SegmentedControl.Item>
    </SegmentedControl>
  ),
};

export const Keyboard: Story = {
  tags: ['!autodocs'],
  render: Playground.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}{Enter}');
    await expect(canvas.getByRole('radio', { name: 'Diff' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  },
};
