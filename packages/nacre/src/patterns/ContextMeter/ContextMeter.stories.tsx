import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { ContextMeter } from './ContextMeter';

const meta = {
  title: 'Patterns/Chat/ContextMeter',
  component: ContextMeter,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'How full the chat’s context is, beside the mode picker: a small ring that fills as the chat grows, and the share in words. Amber from three quarters, red from nine tenths.',
          'While a turn runs the chip counts what it has used instead, quietly ticking up (“30k”, “1.2M”), so a long job’s appetite is never a surprise.',
          'It opens to the detail and **Compact now**, which summarises older messages to make room (held until the running message is done). Nothing shows on a chat that hasn’t started.',
        ].join('\n\n'),
      },
    },
  },
  args: { used: 84_000, window: 200_000, onCompact: () => {} },
} satisfies Meta<typeof ContextMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const NearlyFull: Story = {
  name: 'Nearly full',
  args: { used: 186_000, window: 200_000 },
};

/** A turn at work: the count ticks up as it goes. */
function Working() {
  const [working, setWorking] = useState(1_200);
  useEffect(() => {
    const timer = setInterval(() => setWorking((n) => Math.round(n * 1.18 + 900)), 750);
    return () => clearInterval(timer);
  }, []);
  return (
    <ContextMeter used={64_000} window={272_000} working={working} running onCompact={() => {}} />
  );
}

export const WhileItWorks: Story = { name: 'While it works', render: () => <Working /> };

export const NoWindow: Story = {
  name: 'No window known',
  args: { used: 12_400, window: undefined, onCompact: undefined },
};
