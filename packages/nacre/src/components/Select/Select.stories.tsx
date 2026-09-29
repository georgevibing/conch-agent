import type { Meta, StoryObj } from '@storybook/react-vite';
import { Brain, Cpu, Feather, GitBranch } from 'lucide-react';
import { expect, screen, userEvent, within } from 'storybook/test';

import { Field } from '../Field';
import { Stack } from '../Stack';
import { Select } from './Select';

const meta = {
  title: 'Components/Forms/Select',
  component: Select,
  args: { children: null },
  parameters: {
    docs: {
      description: {
        component:
          'Single-value picker with typeahead and full keyboard support. The menu surfaces from the trigger with Nacre’s signature entrance. Use `variant="surface"` for toolbar pickers such as the model switcher.',
      },
    },
  },
  decorators: [(Story) => <div style={{ inlineSize: 300, minBlockSize: 320 }}>{Story()}</div>],
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

const models = (
  <>
    <Select.Item value="opus" icon={<Brain />} description="Most capable for complex work">
      Opus 5.5
    </Select.Item>
    <Select.Item value="sonnet" icon={<Cpu />} description="Balanced speed and intelligence">
      Sonnet 5
    </Select.Item>
    <Select.Item value="haiku" icon={<Feather />} description="Fastest for quick tasks">
      Haiku 4.5
    </Select.Item>
  </>
);

export const Default: Story = {
  render: () => (
    <Field>
      <Field.Label>Model</Field.Label>
      <Select defaultValue="opus">{models}</Select>
      <Field.Description>Applies to new sessions.</Field.Description>
    </Field>
  ),
};

export const Placeholder: Story = {
  render: () => (
    <Field>
      <Field.Label>Branch</Field.Label>
      <Select placeholder="Choose a branch" leading={<GitBranch />}>
        <Select.Group label="Local">
          <Select.Item value="main">main</Select.Item>
          <Select.Item value="feat/lustre">feat/lustre</Select.Item>
        </Select.Group>
        <Select.Separator />
        <Select.Group label="Remote">
          <Select.Item value="origin/main">origin/main</Select.Item>
          <Select.Item value="origin/release" disabled>
            origin/release
          </Select.Item>
        </Select.Group>
      </Select>
    </Field>
  ),
};

export const Variants: Story = {
  render: () => (
    <Stack gap={4} align="start">
      <Select aria-label="Model (field)" defaultValue="sonnet">
        {models}
      </Select>
      <Select aria-label="Model (surface)" variant="surface" defaultValue="sonnet" size="sm">
        {models}
      </Select>
      <Select aria-label="Model (ghost)" variant="ghost" defaultValue="haiku" size="sm">
        {models}
      </Select>
    </Stack>
  ),
};

export const Invalid: Story = {
  render: () => (
    <Field invalid required>
      <Field.Label>Region</Field.Label>
      <Select placeholder="Pick a region">
        <Select.Item value="eu">Europe</Select.Item>
        <Select.Item value="us">United States</Select.Item>
      </Select>
      <Field.Error>Choose where sessions should run.</Field.Error>
    </Field>
  ),
};

export const Open: Story = {
  tags: ['!autodocs'],
  render: Default.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('combobox', { name: 'Model' }));
    await expect(await screen.findByRole('listbox')).toBeInTheDocument();
  },
};

export const KeyboardSelect: Story = {
  tags: ['!autodocs'],
  render: Default.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('combobox', { name: 'Model' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('listbox');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(trigger).toHaveTextContent('Sonnet 5');
  },
};
