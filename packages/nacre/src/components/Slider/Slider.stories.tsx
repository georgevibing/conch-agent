import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Field } from '../Field';
import { Stack } from '../Stack';
import { Text } from '../Text';
import { Slider } from './Slider';

const meta = {
  title: 'Components/Forms/Slider',
  component: Slider,
  args: { defaultValue: [40], 'aria-label': 'Volume' },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md'] },
    showValue: { control: 'inline-radio', options: [false, 'hover', 'always'] },
  },
  decorators: [(Story) => <div style={{ inlineSize: 320, paddingBlockStart: 32 }}>{Story()}</div>],
  parameters: {
    docs: {
      description: {
        component:
          'Pick a value from a range. The track firms up on hover and the thumb grows as you grab it; `showValue` floats the current value above the thumb.',
      },
    },
  },
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { args: { showValue: 'hover' } };

export const InField: Story = {
  render: function Render() {
    const [budget, setBudget] = useState([16]);
    return (
      <Field>
        <Stack direction="row" justify="between" align="baseline">
          <Field.Label>Thinking budget</Field.Label>
          <Text as="span" size="sm" tone="muted" tabular>
            {budget[0]}k tokens
          </Text>
        </Stack>
        <Slider
          value={budget}
          onValueChange={setBudget}
          min={2}
          max={64}
          step={2}
          getValueText={(v) => `${v} thousand tokens`}
        />
        <Field.Description>Higher budgets help on hard problems but take longer.</Field.Description>
      </Field>
    );
  },
};

export const AlwaysShowValue: Story = {
  args: { defaultValue: [72], showValue: 'always', formatValue: (v: number) => `${v}%` },
};

export const Range: Story = {
  args: {
    defaultValue: [20, 70],
    thumbLabels: ['Minimum', 'Maximum'],
    showValue: 'hover',
  },
};

export const Sizes: Story = {
  render: () => (
    <Stack gap={5}>
      <Slider aria-label="Small" size="sm" defaultValue={[30]} />
      <Slider aria-label="Medium" defaultValue={[60]} />
      <Slider aria-label="Disabled" defaultValue={[45]} disabled />
    </Stack>
  ),
};

export const Keyboard: Story = {
  tags: ['!autodocs'],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const thumb = canvas.getByRole('slider', { name: 'Volume' });
    await userEvent.tab();
    await expect(thumb).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    await expect(thumb).toHaveAttribute('aria-valuenow', '42');
  },
};
