import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { Stack } from '../Stack';
import { Progress } from './Progress';

const meta = {
  title: 'Components/Feedback/Progress',
  component: Progress,
  args: { value: 62, label: 'Indexing repository', showValue: true },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    tone: { control: 'inline-radio', options: ['accent', 'neutral', 'success', 'danger'] },
    value: { control: { type: 'range', min: 0, max: 100 } },
  },
  decorators: [(Story) => <div style={{ inlineSize: 380 }}>{Story()}</div>],
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Indeterminate: Story = {
  args: { value: null, label: 'Waiting for the host…', showValue: false },
};

export const Sizes: Story = {
  render: () => (
    <Stack gap={5}>
      <Progress size="sm" value={30} aria-label="Small" />
      <Progress size="md" value={55} aria-label="Medium" />
      <Progress size="lg" value={80} aria-label="Large" />
    </Stack>
  ),
};

export const Tones: Story = {
  render: () => (
    <Stack gap={5}>
      <Progress tone="accent" value={45} label="Accent" showValue />
      <Progress tone="neutral" value={60} label="Neutral" showValue />
      <Progress
        tone="success"
        value={100}
        label="Tests"
        showValue={(v, m) => `${v}/${m} passed`}
        max={128}
      />
      <Progress tone="danger" value={92} label="Context window" showValue />
    </Stack>
  ),
};

export const Live: Story = {
  render: function Render() {
    const [value, setValue] = useState(8);
    useEffect(() => {
      const id = setInterval(
        () => setValue((v) => (v >= 100 ? 4 : Math.min(100, v + Math.random() * 18))),
        900,
      );
      return () => clearInterval(id);
    }, []);
    return <Progress value={value} label="Applying 14 edits" showValue />;
  },
};
