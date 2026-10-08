import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { REPLAY_STEPS, REPLAY_TURNS } from './fixtures';
import { RunReplay } from './RunReplay';
import { RunSave, type RunSaveRemoved } from './RunSave';

const meta = {
  title: 'Patterns/Chat/RunReplay',
  component: RunReplay,
  parameters: {
    docs: {
      description: {
        component:
          'How it did it (ADR 0113): every step of a chat, a routine run or a task on one time axis. Scrub it with the pointer or the arrow keys (Page Up and Down go a turn at a time); the step at the scrubber opens below with what it found or changed, and the list fills in up to it. Replay plays it back a step at a time with the pearl riding the scrubber. Long waits fold to a break. Reduced motion keeps every step and drops the glide.',
      },
    },
  },
  args: { steps: REPLAY_STEPS, turns: REPLAY_TURNS, speaker: 'Pearl', onJump: fn() },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 560 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RunReplay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** Scrubbed back to the failing test run: everything after it waits, dimmed. */
export const PartWay: Story = { args: { initialStep: 7 } };

/** At the edit: the change it made, as lines. */
export const AtAnEdit: Story = { args: { initialStep: 5 } };

/** At a question it asked you: how long it waited for your answer. */
export const AtAQuestion: Story = { args: { initialStep: 4 } };

/** A routine's run that hit a problem. */
export const WentWrong: Story = {
  args: {
    speaker: 'Morning brief',
    steps: [
      { id: 'a', kind: 'asked', at: 0, turn: 0, title: 'Morning brief: mail, calendar, weather' },
      {
        id: 'm',
        kind: 'tool',
        family: 'connect',
        at: 1000,
        durationMs: 800,
        turn: 0,
        title: 'Looked through your mail',
        detail: 'Signed out of Gmail',
        status: 'failed',
      },
      {
        id: 'p',
        kind: 'problem',
        at: 2500,
        turn: 0,
        title: 'It stopped with a problem',
        detail: 'Gmail needs you to sign in again.',
        status: 'failed',
      },
    ],
    turns: [{ index: 0, at: 0, endAt: 2500 }],
  },
};

export const Empty: Story = { args: { steps: [], turns: [] } };

const FORMATS = [
  {
    id: 'report',
    title: 'A page to read',
    detail: 'Every step with what it found, opens in any browser.',
  },
  { id: 'markdown', title: 'Markdown', detail: 'The same, as plain text for notes and documents.' },
  {
    id: 'openai',
    title: 'OpenAI chat, for training',
    detail: 'Messages with tool calls, one chat a line (JSONL).',
  },
  {
    id: 'sharegpt',
    title: 'ShareGPT, as Hermes writes it',
    detail: 'Conversations with <tool_call> turns, one chat a line.',
  },
  {
    id: 'atif',
    title: 'ATIF, for agent research',
    detail: 'Harbor’s trajectory format: steps, tool calls, tokens and cost.',
  },
];

const REMOVED: RunSaveRemoved[] = [
  {
    kind: 'key',
    label: '2 keys and tokens',
    examples: [
      'export OPENAI_API_KEY=[key]',
      'git remote add origin https://[key]@github.com/[name]/notes',
    ],
  },
  { kind: 'email', label: '1 email address', examples: ['…send it to [email] by Friday…'] },
  {
    kind: 'home',
    label: '6 folder names',
    examples: ['Opened ~/Projects/conch/src/auth/login.ts'],
  },
];

function Save(props: Partial<React.ComponentProps<typeof RunSave>>) {
  const [format, setFormat] = useState('report');
  const [redact, setRedact] = useState(true);
  return (
    <div style={{ maxInlineSize: 480 }}>
      <RunSave
        formats={FORMATS}
        format={format}
        onFormatChange={setFormat}
        redact={redact}
        onRedactChange={setRedact}
        removed={REMOVED}
        summary="1 chat · 15 steps"
        folder="~/Downloads"
        onChooseFolder={fn()}
        onSave={fn()}
        {...props}
      />
    </div>
  );
}

/** Saving it: the format, what comes out (shown before anything's written), the folder. */
export const Saving: StoryObj = { render: () => <Save /> };

export const WorkingOutWhatComesOut: StoryObj = { render: () => <Save removed={undefined} /> };

export const NothingToTakeOut: StoryObj = { render: () => <Save removed={[]} /> };

export const Saved: StoryObj = {
  render: () => (
    <Save saved={{ name: 'Conch – Fix the login test – 2026-10-08.html', folder: '~/Downloads' }} />
  ),
};

export const CantSaveThere: StoryObj = {
  render: () => (
    <Save problem="Conch keeps that folder to itself: sign-ins and keys live there. Choose another." />
  ),
};
