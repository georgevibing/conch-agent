import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Stack } from '../Stack';
import { Checkbox, type CheckedState } from './Checkbox';

const meta = {
  title: 'Components/Forms/Checkbox',
  component: Checkbox,
  args: { label: 'Auto-approve file edits' },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md'] } },
  parameters: {
    docs: {
      description: {
        component:
          'Binary choice. The tick draws itself in along its path while the box settles with a small spring. Pass `label` / `description` for a correctly associated row, or use the bare box inside your own layout.',
      },
    },
  },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithDescription: Story = {
  args: {
    label: 'Run tests before committing',
    description:
      'Claude will run the project’s test script and fix failures before creating a commit.',
    defaultChecked: true,
  },
  decorators: [(Story) => <div style={{ inlineSize: 360 }}>{Story()}</div>],
};

export const States: Story = {
  render: () => (
    <Stack gap={3}>
      <Checkbox label="Unchecked" />
      <Checkbox label="Checked" defaultChecked />
      <Checkbox label="Indeterminate" checked="indeterminate" />
      <Checkbox label="Invalid" invalid />
      <Checkbox label="Disabled" disabled />
      <Checkbox label="Disabled checked" disabled defaultChecked />
      <Checkbox label="Small" size="sm" defaultChecked />
    </Stack>
  ),
};

const tools = ['Read files', 'Edit files', 'Run shell commands', 'Browse the web'];

export const SelectAll: Story = {
  render: function Render() {
    const [enabled, setEnabled] = useState<string[]>(['Read files', 'Edit files']);
    const all: CheckedState =
      enabled.length === tools.length ? true : enabled.length ? 'indeterminate' : false;
    return (
      <Stack gap={3}>
        <Checkbox
          label="All tools"
          checked={all}
          onCheckedChange={(c) => setEnabled(c === true ? tools : [])}
        />
        <Stack gap={2.5} style={{ paddingInlineStart: 28 }}>
          {tools.map((tool) => (
            <Checkbox
              key={tool}
              label={tool}
              checked={enabled.includes(tool)}
              onCheckedChange={(c) =>
                setEnabled((prev) =>
                  c === true ? [...prev, tool] : prev.filter((t) => t !== tool),
                )
              }
            />
          ))}
        </Stack>
      </Stack>
    );
  },
};

export const KeyboardToggle: Story = {
  tags: ['!autodocs'],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByRole('checkbox', { name: 'Auto-approve file edits' });
    await userEvent.tab();
    await expect(box).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(box).toBeChecked();
  },
};
