import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { Stack } from '../../components/Stack';
import { TalkMode, type TalkState } from './TalkMode';
import { VoiceButton } from './VoiceButton';

const meta = {
  title: 'Patterns/Voice/TalkMode',
  component: TalkMode,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Talking, hands free. The whole screen rests; the pearl listens (swelling with your voice), thinks, and speaks. Tap it to interrupt, Escape or × to end, or go back to typing in the same chat.',
      },
    },
  },
  args: {
    open: true,
    onOpenChange: () => undefined,
    state: 'listening',
    name: 'Pearl',
    onPearl: () => undefined,
    onMute: () => undefined,
    onKeyboard: () => undefined,
  },
} satisfies Meta<typeof TalkMode>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The pearl follows a pretend voice. */
export const Playground: Story = {
  render: (args) => {
    const [level, setLevel] = useState(0);
    useEffect(() => {
      const t = setInterval(() => setLevel(Math.abs(Math.sin(Date.now() / 260)) * 0.8), 80);
      return () => clearInterval(t);
    }, []);
    return <TalkMode {...args} level={level} heard="What’s on my calendar tomorrow?" />;
  },
};

export const Listening: Story = { args: { heard: 'What’s on my calendar' } };
export const Thinking: Story = {
  args: { state: 'thinking', heard: 'What’s on my calendar tomorrow?' },
};
export const Speaking: Story = {
  args: {
    state: 'speaking',
    level: 0.4,
    heard: 'What’s on my calendar tomorrow?',
    reply:
      'Three things: stand-up at 9, lunch with Ada at 12:30, and the dentist at 4. Want me to move the dentist?',
  },
};
export const Paused: Story = { args: { state: 'paused' as TalkState } };
export const Problem: Story = {
  args: {
    state: 'error',
    problem:
      'The microphone isn’t allowed for Conch. Allow it in the browser’s settings for this site.',
  },
};

export const Buttons: StoryObj<typeof VoiceButton> = {
  render: () => (
    <Stack direction="row" gap={4} style={{ padding: 32 }}>
      <VoiceButton />
      <VoiceButton state="listening" level={0.6} />
      <VoiceButton state="working" />
    </Stack>
  ),
};
