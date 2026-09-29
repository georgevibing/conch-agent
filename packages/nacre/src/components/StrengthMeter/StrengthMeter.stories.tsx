import type { Meta, StoryObj } from '@storybook/react-vite';

import { Stack } from '../Stack';
import { StrengthMeter } from './StrengthMeter';

const meta = {
  title: 'Components/Feedback/StrengthMeter',
  component: StrengthMeter,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Shows how strong a new password is. The verdict is always spelled out, with one sentence on why or how to improve — colour only reinforces it.',
      },
    },
  },
  args: { score: 3, label: 'Good', message: 'Good password.' },
  argTypes: { score: { control: { type: 'range', min: 0, max: 4 } } },
  decorators: [(Story) => <div style={{ maxInlineSize: 360 }}>{Story()}</div>],
} satisfies Meta<typeof StrengthMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const AllStates: Story = {
  render: () => (
    <Stack gap={5}>
      <StrengthMeter score={0} label="Too short" empty />
      <StrengthMeter
        score={0}
        label="Too short"
        message="Use at least 15 characters — a short sentence works well."
      />
      <StrengthMeter
        score={1}
        label="Too easy to guess"
        message="That’s one of the most common passwords."
      />
      <StrengthMeter
        score={2}
        label="Okay"
        message="Acceptable. Adding a few more unexpected words makes it much stronger."
      />
      <StrengthMeter score={3} label="Good" message="Good password." />
      <StrengthMeter score={4} label="Strong" message="Strong password." />
    </Stack>
  ),
};
