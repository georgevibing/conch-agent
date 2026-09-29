import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, screen, userEvent, within } from 'storybook/test';

import { Field } from '../Field';
import { Stack } from '../Stack';
import { TimePicker } from './TimePicker';

const meta = {
  title: 'Components/Forms/TimePicker',
  component: TimePicker,
  parameters: {
    docs: {
      description: {
        component:
          'Time of day. Each part is a spin button you can type into (↑/↓ nudge, digits overwrite, ←/→ move). The clock button opens a face of hour and minute chips: tap an hour, then a minute, and it closes. The selection pill glides between chips on a spring. Follows the reader’s 12/24-hour habit unless `hourCycle` says otherwise; the value is always `HH:MM`.',
      },
    },
  },
  args: { defaultValue: '09:00', 'aria-label': 'Time' },
  decorators: [(Story) => <div style={{ inlineSize: 260, minBlockSize: 400 }}>{Story()}</div>],
} satisfies Meta<typeof TimePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { hourCycle: 'h12', minuteStep: 5 },
};

export const InAField: Story = {
  render: function Render() {
    const [value, setValue] = useState('07:30');
    return (
      <Field>
        <Field.Label>Remind me at</Field.Label>
        <TimePicker value={value} onValueChange={setValue} hourCycle="h12" />
        <Field.Description>Value: {value}</Field.Description>
      </Field>
    );
  },
};

export const TwentyFourHour: Story = {
  args: { hourCycle: 'h23', defaultValue: '18:45' },
};

export const WithPresets: Story = {
  args: {
    hourCycle: 'h12',
    presets: [
      { label: 'Morning', value: '08:00' },
      { label: 'Midday', value: '12:00' },
      { label: 'Evening', value: '18:00' },
    ],
  },
};

export const Open: Story = {
  args: WithPresets.args,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Choose a time' }));
    await expect(await screen.findByRole('dialog', { name: 'Choose a time' })).toBeInTheDocument();
  },
};

export const OpenTwentyFourHour: Story = {
  args: { hourCycle: 'h23', defaultValue: '14:15' },
  play: Open.play,
};

export const States: Story = {
  render: () => (
    <Stack gap={4}>
      <TimePicker aria-label="Small" size="sm" defaultValue="06:00" />
      <TimePicker aria-label="Large" size="lg" defaultValue="22:30" />
      <TimePicker aria-label="Invalid" invalid defaultValue="03:00" />
      <TimePicker aria-label="Disabled" disabled defaultValue="12:00" />
    </Stack>
  ),
};
