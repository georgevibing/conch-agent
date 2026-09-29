import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, screen, userEvent, within } from 'storybook/test';

import { Field } from '../Field';
import { Stack } from '../Stack';
import { addDays, localToday } from './calendar';
import { DatePicker } from './DatePicker';

const today = localToday();

const meta = {
  title: 'Components/Forms/DatePicker',
  component: DatePicker,
  parameters: {
    docs: {
      description: {
        component:
          'A calendar in a popover. The trigger reads like speech (“Tomorrow · Thu, Oct 1”). Arrow keys walk the days, Page Up/Down turn months (Shift for years), Home/End jump to the edges of the week; months slide in the direction you’re going. Today wears a small accent pearl. Quick picks cover the common cases in one tap. Values are `YYYY-MM-DD`.',
      },
    },
  },
  args: { 'aria-label': 'Date' },
  decorators: [(Story) => <div style={{ inlineSize: 300, minBlockSize: 440 }}>{Story()}</div>],
} satisfies Meta<typeof DatePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { defaultValue: addDays(today, 1) },
};

export const InAField: Story = {
  render: function Render() {
    const [value, setValue] = useState<string>();
    return (
      <Field>
        <Field.Label>Run on</Field.Label>
        <DatePicker value={value} onValueChange={setValue} min={today} />
        <Field.Description>
          {value ? `Value: ${value}` : 'Past days can’t be picked.'}
        </Field.Description>
      </Field>
    );
  },
};

export const Open: Story = {
  args: { defaultValue: addDays(today, 1), min: today },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Date' }));
    await expect(await screen.findByRole('dialog', { name: 'Choose a date' })).toBeInTheDocument();
  },
};

export const States: Story = {
  render: () => (
    <Stack gap={4}>
      <DatePicker aria-label="Placeholder" />
      <DatePicker aria-label="Today" defaultValue={today} size="sm" />
      <DatePicker aria-label="Next year" defaultValue={addDays(today, 400)} size="lg" />
      <DatePicker aria-label="Invalid" invalid defaultValue={addDays(today, -3)} />
      <DatePicker aria-label="Disabled" disabled defaultValue={today} />
    </Stack>
  ),
};
