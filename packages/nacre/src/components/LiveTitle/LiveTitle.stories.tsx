import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { Button } from '../Button';
import { Stack } from '../Stack';
import { Text } from '../Text';
import { LiveTitle } from './LiveTitle';

const meta = {
  title: 'Components/Display/LiveTitle',
  component: LiveTitle,
  args: { children: 'Hi conch how are you', pending: true },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 240 }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          'A title that may still be being written — a new chat is shown under its first line while a small model names it. The placeholder carries a slow pearl shimmer (and `aria-busy`); when the real title lands it is written in with a soft left-to-right sweep. If the placeholder is kept, it simply settles. Renames never animate.',
      },
    },
  },
} satisfies Meta<typeof LiveTitle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Pending: Story = {};

export const Settled: Story = { args: { children: 'Friendly check-in', pending: false } };

export const Truncated: Story = {
  args: { children: 'Could you help me work out why the deploy keeps failing on staging' },
};

/** The full journey, on a loop: placeholder → shimmer → the real title writes in. */
export const Resolving: Story = {
  render: function Render() {
    const [run, setRun] = useState(0);
    const [pending, setPending] = useState(true);
    useEffect(() => {
      setPending(true);
      const t = setTimeout(() => setPending(false), 2200);
      return () => clearTimeout(t);
    }, [run]);
    return (
      <Stack gap={3}>
        <Text as="div" size="md">
          <LiveTitle pending={pending}>
            {pending ? 'my espresso machine leaks from the…' : 'Fixing a leaky espresso machine'}
          </LiveTitle>
        </Text>
        <Button size="sm" variant="surface" onClick={() => setRun((r) => r + 1)}>
          Replay
        </Button>
      </Stack>
    );
  },
};
