import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Field } from '../Field';
import { Stack } from '../Stack';
import { NumberField } from './NumberField';

const meta = {
  title: 'Components/Forms/NumberField',
  component: NumberField,
  parameters: {
    docs: {
      description: {
        component:
          'A number in a well with − and + keys you can press and hold (it speeds up). Arrow keys step, Page Up/Down leap by ten steps, Home/End jump to the limits. Typing is free; the value settles into range when you leave the field or press Enter, and the keys dim at the limits. The number nudges in the direction it moved.',
      },
    },
  },
  args: { 'aria-label': 'Count', defaultValue: 4, min: 1, max: 20 },
  decorators: [(Story) => <div style={{ inlineSize: 220 }}>{Story()}</div>],
} satisfies Meta<typeof NumberField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const InAField: Story = {
  render: function Render() {
    const [value, setValue] = useState(30);
    return (
      <Field>
        <Field.Label>Every</Field.Label>
        <NumberField
          value={value}
          onValueChange={setValue}
          min={15}
          max={1440}
          step={5}
          unit="min"
        />
        <Field.Description>At least every 15 minutes.</Field.Description>
      </Field>
    );
  },
};

export const States: Story = {
  render: () => (
    <Stack gap={4}>
      <NumberField aria-label="Small" size="sm" defaultValue={2} min={0} />
      <NumberField aria-label="At minimum" defaultValue={1} min={1} max={9} />
      <NumberField aria-label="Large" size="lg" defaultValue={12} />
      <NumberField aria-label="Invalid" invalid defaultValue={0} />
      <NumberField aria-label="Disabled" disabled defaultValue={3} />
    </Stack>
  ),
};
