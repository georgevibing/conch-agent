import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { Stack } from '../../components/Stack';
import { ListeningIndicator } from './ListeningIndicator';
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
/** Talking over it interrupts it: the line says so. */
export const SpeakingWithBargeIn: Story = {
  args: {
    state: 'speaking',
    level: 0.4,
    bargeIn: true,
    reply: 'Three things: stand-up at 9, lunch with Ada at 12:30, and the dentist at 4.',
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

/** Listening for the wake phrase, wherever you are, with one press to stop. */
export const ListeningForHeyConch: StoryObj<typeof ListeningIndicator> = {
  render: () => (
    <Stack direction="row" gap={4} style={{ padding: 32 }}>
      <ListeningIndicator phrase="“Hey Conch”" onStop={() => undefined} />
      <ListeningIndicator phrase="“Hey Conch”" hearing onStop={() => undefined} />
    </Stack>
  ),
};

/** On a phone it stops by itself to save the battery, says so, and listens again in one press (ADR 0108). */
export const ListeningPausedOnAPhone: StoryObj<typeof ListeningIndicator> = {
  render: () => (
    <Stack direction="row" gap={4} style={{ padding: 32 }}>
      <ListeningIndicator phrase="“Hey Pearl”" onStop={() => undefined} />
      <ListeningIndicator
        phrase="“Hey Pearl”"
        paused
        onResume={() => undefined}
        onStop={() => undefined}
      />
    </Stack>
  ),
};
