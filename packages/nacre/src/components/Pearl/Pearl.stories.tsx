import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { Stack } from '../Stack';
import { Surface } from '../Surface';
import { Text } from '../Text';
import { Pearl, type PearlState } from './Pearl';

const meta = {
  title: 'Components/Feedback/Pearl',
  component: Pearl,
  args: { state: 'thinking', size: 'xl' },
  argTypes: {
    state: { control: 'inline-radio', options: ['idle', 'thinking', 'streaming', 'error'] },
    size: { control: 'inline-radio', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Nacre's signature mark for the agent's presence. Two counter-rotating films of iridescence drift over a softly lit sphere. It rests when idle, breathes while thinking, quickens while streaming and stills on error. Motion is removed under reduced-motion; state stays legible through glow and tint.",
      },
    },
  },
} satisfies Meta<typeof Pearl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

const states: PearlState[] = ['idle', 'thinking', 'streaming', 'error'];

export const States: Story = {
  render: () => (
    <Stack direction="row" gap={10} align="end">
      {states.map((state) => (
        <Stack key={state} gap={4} align="center">
          <Pearl state={state} size="xl" />
          <Text size="xs" tone="muted">
            {state}
          </Text>
        </Stack>
      ))}
    </Stack>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Stack direction="row" gap={6} align="center">
      {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
        <Pearl key={size} size={size} state="thinking" />
      ))}
    </Stack>
  ),
};

export const InlineStatus: Story = {
  render: function Render() {
    const [state, setState] = useState<PearlState>('thinking');
    useEffect(() => {
      const seq: PearlState[] = ['thinking', 'streaming', 'idle'];
      let i = 0;
      const id = setInterval(() => {
        i = (i + 1) % seq.length;
        setState(seq[i] ?? 'idle');
      }, 2600);
      return () => clearInterval(id);
    }, []);
    const copy: Record<PearlState, string> = {
      idle: 'Ready',
      thinking: 'Thinking about the retry strategy…',
      streaming: 'Writing src/gateway/retry.ts',
      error: 'Lost connection',
    };
    return (
      <Surface padding={4} radius="xl" style={{ inlineSize: 380 }}>
        <Stack direction="row" gap={3} align="center">
          <Pearl state={state} size="md" label={null} />
          <Text size="sm" tone={state === 'idle' ? 'muted' : 'default'} aria-live="polite">
            {copy[state]}
          </Text>
        </Stack>
      </Surface>
    );
  },
};
