import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { type LibraryVoice, VoiceLibrary } from './VoiceLibrary';

const voices: LibraryVoice[] = [
  {
    id: 'piper:en_US-lessac-medium',
    name: 'Lessac',
    language: 'American English',
    bytes: 63_206_179,
    state: 'ready',
  },
  {
    id: 'piper:en_US-ryan-medium',
    name: 'Ryan',
    language: 'American English',
    bytes: 63_206_177,
    state: 'downloading',
    done: 21_000_000,
    total: 63_206_177,
  },
  {
    id: 'piper:en_US-amy-medium',
    name: 'Amy',
    language: 'American English',
    bytes: 63_206_176,
    state: 'missing',
  },
  {
    id: 'piper:en_GB-alba-medium',
    name: 'Alba',
    language: 'British English',
    bytes: 63_206_182,
    state: 'missing',
    problem: 'Alba didn’t finish downloading: the internet seems to be unreachable. Try again.',
  },
];

const meta = {
  title: 'Patterns/Voice/VoiceLibrary',
  component: VoiceLibrary,
  parameters: {
    docs: {
      description: {
        component:
          'Natural voices that run on the computer: one row each, with its size or its progress, and once it’s here, Try and Use. The one in use says so in words.',
      },
    },
  },
  args: {
    voices,
    chosen: 'piper:en_US-lessac-medium',
    onDownload: () => undefined,
    onPause: () => undefined,
    onChoose: () => undefined,
    onTry: () => undefined,
    onRemove: () => undefined,
    'aria-label': 'Natural voices',
  },
} satisfies Meta<typeof VoiceLibrary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Press Get it, Use and Try: the rows follow. */
export const Playground: Story = {
  render: (args) => {
    const [list, setList] = useState(voices);
    const [chosen, setChosen] = useState(args.chosen);
    return (
      <VoiceLibrary
        {...args}
        voices={list}
        chosen={chosen}
        onDownload={(id) =>
          setList((all) =>
            all.map((v) => (v.id === id ? { ...v, state: 'ready', problem: undefined } : v)),
          )
        }
        onChoose={setChosen}
      />
    );
  },
};

export const NothingYet: Story = {
  args: {
    voices: voices.map((v) => ({ ...v, state: 'missing', problem: undefined })),
    chosen: undefined,
  },
};
