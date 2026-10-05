import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Stack } from '../../components/Stack';
import {
  LearnedEntry,
  LearnedLine,
  LearningTimeline,
  NeverList,
  WeeklyRecap,
  type LearnedThing,
} from './Learning';

const why = {
  chat: 'Rename my photos',
  when: 'Today at 14:02',
  quotes: ['No, I meant TypeScript.'],
  signals: ['correction' as const],
  model: 'Claude Haiku 4.5',
};

const preference: LearnedThing = {
  id: 'le_1',
  text: 'Prefers TypeScript over Python',
  state: 'applied',
  why,
};
const moved: LearnedThing = {
  id: 'le_2',
  text: 'Lives in Lisbon',
  was: 'Lives in Berlin',
  state: 'applied',
  why: { ...why, quotes: ['I moved to Lisbon last month'], signals: [] },
};
const computer: LearnedThing = {
  id: 'le_3',
  text: 'On this computer, `python` isn’t found; `py` works.',
  state: 'applied',
  why: { chat: 'Run the build', signals: ['worked-another-way'] },
};
const waiting: LearnedThing = {
  id: 'le_4',
  text: 'Prefers trains over flights in Europe',
  state: 'waiting',
  waits: 'Learned in a chat that read trains.example.',
  why: {
    ...why,
    quotes: ['Only trains, please'],
    waits: 'Learned in a chat that read trains.example.',
  },
};

const meta = {
  title: 'Patterns/Learning/LearnedLine',
  component: LearnedLine,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Quiet learning (ADR 0088). Once a chat you were in goes quiet, Conch reads your words in it and keeps what lasts: a correction, a move, what this computer needs. It says so afterwards in one folded line at the end of the chat — “Learned 2 things” — never a dialog or a toast. Open, every thing has Undo (and what you undo is never learned again) and Why?, which shows the chat, your words, what Conch noticed and the model that read it. What came after reading something from outside waits for your OK: the line opens by itself, and Keep and Forget are the only things asking for attention.',
      },
    },
  },
  args: { items: [preference, moved], onUndo: fn(), onKeep: fn(), onForget: fn() },
  decorators: [(Story) => <div style={{ maxInlineSize: 736 }}>{Story()}</div>],
} satisfies Meta<typeof LearnedLine>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** Open: each thing with Undo and Why?; a move shows what it replaced. */
export const Open: Story = { args: { defaultOpen: true, items: [preference, moved, computer] } };

/** Learned after reading something from outside: it waits, and the line opens by itself. */
export const Waiting: Story = { args: { items: [preference, waiting] } };

/** What you decided stays said: kept, undone (never learned again), not kept. */
export const Decided: Story = {
  args: {
    defaultOpen: true,
    items: [
      { ...preference, state: 'kept' },
      { ...moved, state: 'undone' },
      { ...waiting, state: 'dismissed' },
    ],
  },
};

/** On a phone, the answers go under the words. */
export const Narrow: Story = {
  args: { defaultOpen: true, items: [moved, waiting] },
  decorators: [(Story) => <div style={{ maxInlineSize: 340 }}>{Story()}</div>],
};

export const UndoOne: Story = {
  args: { defaultOpen: true, items: [preference] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Undo' }));
    await expect(args.onUndo).toHaveBeenCalledWith('le_1');
  },
};

/** The Memory page: the week at a glance, the record, and what Conch won't learn again. */
export const MemoryPage: Story = {
  render: () => (
    <Stack gap={4}>
      <WeeklyRecap
        count={6}
        items={['Prefers TypeScript over Python', 'Lives in Lisbon', 'Has a dog called Rex']}
        onSeeAll={fn()}
        onDismiss={fn()}
      />
      <LearningTimeline>
        <LearnedEntry
          thing={waiting}
          meta="From “Trains to Lyon” · 2 hours ago"
          onKeep={fn()}
          onForget={fn()}
        />
        <LearnedEntry thing={moved} meta="From “Weekend ideas” · yesterday" onUndo={fn()} />
        <LearnedEntry
          thing={{ ...preference, state: 'undone' }}
          meta="From “Rename my photos” · 3 days ago"
        />
      </LearningTimeline>
      <NeverList
        items={[
          { id: 'nv_1', text: 'Prefers dark mode everywhere', when: 'Taken back 3 days ago' },
          { id: 'nv_2', text: 'Works at Acme', when: 'Taken back last week' },
        ]}
        onRemove={fn()}
      />
    </Stack>
  ),
};
