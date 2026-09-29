import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Stack } from '../../components/Stack';
import { modes } from '../ModelPicker/fixtures';
import { ModePicker } from './ModePicker';

function Stateful({ initial = 'default', open }: { initial?: string; open?: boolean }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  return (
    <ModePicker
      options={modes}
      value={value}
      onValueChange={setValue}
      isDefault={value === saved}
      onMakeDefault={() => setSaved(value)}
      open={open}
    />
  );
}

const meta = {
  title: 'Patterns/Chat/ModePicker',
  component: ModePicker,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'How much Claude may do without asking. The chip takes the tone of the mode, so a trusting mode always looks armed; turning on Full trust needs a deliberate second step.',
      },
    },
  },
  args: { options: modes, value: 'default', onValueChange: () => {}, isDefault: true },
  decorators: [
    (Story) => (
      <div style={{ paddingBlockStart: '26rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ModePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { render: () => <Stateful /> };
export const Open: Story = { render: () => <Stateful open /> };

export const Chips: Story = {
  decorators: [(Story) => <Story />],
  render: () => (
    <Stack direction="row" gap={2}>
      {modes.map((m) => (
        <Stateful key={m.value} initial={m.value} />
      ))}
    </Stack>
  ),
};
