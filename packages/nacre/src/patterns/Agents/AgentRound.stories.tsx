import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { Stack } from '../../components/Stack';
import { AgentRound, type RoundFace } from './AgentRound';
import { OutsideReply } from './OutsideReply';

const faces: RoundFace[] = [
  { id: 'ag_hoot', name: 'Researcher', avatar: 'owl' },
  { id: 'ag_juniper', name: 'Writer', avatar: { kind: 'preset', id: 'feather', color: 'violet' } },
  { id: 'oa_travel', name: 'Travel Agent', outside: true },
  { id: 'ag_bolt', name: 'Critic', avatar: { kind: 'preset', id: 'bot' } },
];

const meta = {
  title: 'Patterns/Agents/AgentRound',
  component: AgentRound,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Agents taking turns (ADR 0112). Mention agents in a message and they answer one after another; each pass of the floor is an arc of pearl light from one face to the next, the newest bright, with a pearl that travels along it. Whoever has the floor wears its working light, an outside agent is marked as one, and the card says who’s answering and how far the round has come, with Stop. Once it’s over it folds to one quiet line. Reduced motion: the arcs are drawn at once and the pearl rests where the floor is.',
      },
    },
  },
  args: { faces, passes: ['ag_hoot', 'ag_juniper'], speaking: 'ag_juniper', limit: 8 },
} satisfies Meta<typeof AgentRound>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { args: { onStop: () => undefined } };

export const FirstToSpeak: Story = {
  args: { passes: ['ag_hoot'], speaking: 'ag_hoot', onStop: () => undefined },
};

export const WaitingForAnOutsideAgent: Story = {
  args: {
    passes: ['ag_hoot', 'ag_juniper', 'oa_travel'],
    speaking: 'oa_travel',
    onStop: () => undefined,
  },
};

export const BackAndForth: Story = {
  args: {
    passes: ['ag_hoot', 'ag_juniper', 'ag_hoot', 'ag_bolt', 'ag_juniper'],
    speaking: 'ag_juniper',
    onStop: () => undefined,
  },
};

export const Done: Story = {
  args: {
    passes: ['ag_hoot', 'ag_juniper', 'oa_travel'],
    speaking: undefined,
    ended: { words: '' },
  },
};

export const StoppedForYou: Story = {
  args: {
    passes: ['ag_hoot', 'ag_juniper', 'ag_hoot', 'ag_juniper'],
    speaking: undefined,
    ended: { words: 'They were going back and forth, so they’ve stopped here. Over to you.' },
  },
};

const ORDER = ['ag_hoot', 'ag_juniper', 'oa_travel', 'ag_bolt', 'ag_juniper'];

/** The floor passing round, live: a new arc and the pearl each time. */
export const Live: Story = {
  render: function Render(args) {
    const [count, setCount] = useState(1);
    useEffect(() => {
      const timer = setInterval(() => setCount((n) => (n >= ORDER.length ? 1 : n + 1)), 1800);
      return () => clearInterval(timer);
    }, []);
    const passes = ORDER.slice(0, count);
    return (
      <AgentRound {...args} passes={passes} speaking={passes.at(-1)} onStop={() => undefined} />
    );
  },
};

/** In a chat: the card, then an outside agent's words as theirs. */
export const InAChat: Story = {
  render: (args) => (
    <Stack gap={4} style={{ maxInlineSize: '40rem' }}>
      <AgentRound
        {...args}
        passes={['ag_hoot', 'oa_travel']}
        speaking="oa_travel"
        onStop={() => undefined}
      />
      <OutsideReply name="Travel Agent">
        Three flights on 3 May: 07:10 (€89), 12:45 (€112) and 18:30 (€74). The evening one has the
        best seats left.
      </OutsideReply>
      <OutsideReply name="Travel Agent" failed>
        Couldn’t reach Travel Agent. Is it running?
      </OutsideReply>
    </Stack>
  ),
};
