import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Message, MessageList } from '../Message';
import { Prose } from '../Prose';
import {
  QuestionCard,
  type QuestionCardProps,
  type QuestionCardQuestion,
  type QuestionCardValues,
} from './QuestionCard';

const TODAY = '2026-10-05';

const callType: QuestionCardQuestion = {
  questionId: 'q-type',
  fields: [
    {
      id: 'type',
      kind: 'choice',
      label: 'How would you like to talk?',
      options: [
        { id: 'video', label: 'Video call', description: 'A Meet link in the invite' },
        { id: 'phone', label: 'Phone', description: 'Ada calls your mobile' },
        { id: 'person', label: 'In person', description: 'At the Lisbon office' },
      ],
    },
  ],
};

const sizes: QuestionCardQuestion = {
  questionId: 'q-size',
  fields: [
    {
      id: 'size',
      kind: 'choice',
      label: 'Which size should the logo be?',
      options: [
        { id: 's', label: 'Small' },
        { id: 'm', label: 'Medium' },
        { id: 'l', label: 'Large' },
      ],
      other: true,
    },
  ],
};

const toppings: QuestionCardQuestion = {
  questionId: 'q-sections',
  fields: [
    {
      id: 'sections',
      kind: 'choice',
      label: 'What should the weekly report cover?',
      multiple: true,
      other: true,
      options: [
        { id: 'sales', label: 'Sales' },
        { id: 'support', label: 'Support tickets' },
        { id: 'hiring', label: 'Hiring' },
        { id: 'roadmap', label: 'Roadmap' },
      ],
    },
  ],
};

const day: QuestionCardQuestion = {
  questionId: 'q-day',
  fields: [{ id: 'day', kind: 'date', label: 'Which day suits you?', suggested: '2026-10-08' }],
};

const time: QuestionCardQuestion = {
  questionId: 'q-time',
  fields: [
    { id: 'time', kind: 'time', label: 'What time should it remind you?', suggested: '08:30' },
  ],
};

const when: QuestionCardQuestion = {
  questionId: 'q-when',
  fields: [
    {
      id: 'when',
      kind: 'datetime',
      label: 'When should the call be?',
      suggested: '2026-10-08T10:00:00+01:00',
      min: '2026-10-05',
    },
  ],
};

const text: QuestionCardQuestion = {
  questionId: 'q-name',
  fields: [
    {
      id: 'name',
      kind: 'text',
      label: 'What should the project be called?',
      placeholder: 'A name',
    },
  ],
};

const notes: QuestionCardQuestion = {
  questionId: 'q-notes',
  fields: [
    {
      id: 'notes',
      kind: 'text',
      label: 'Anything Ada should know before the call?',
      multiline: true,
      placeholder: 'A few lines',
    },
  ],
};

const guests: QuestionCardQuestion = {
  questionId: 'q-guests',
  fields: [
    {
      id: 'guests',
      kind: 'number',
      label: 'How many people is the table for?',
      min: 1,
      max: 12,
      suggested: 2,
      unit: 'people',
    },
  ],
};

const booking: QuestionCardQuestion = {
  questionId: 'q-booking',
  title: 'A few things for the call with Ada',
  fields: [
    {
      id: 'when',
      kind: 'datetime',
      label: 'When?',
      suggested: '2026-10-08T10:00',
      min: '2026-10-05',
    },
    {
      id: 'type',
      kind: 'choice',
      label: 'How?',
      options: [
        { id: 'video', label: 'Video call' },
        { id: 'phone', label: 'Phone' },
      ],
    },
    {
      id: 'length',
      kind: 'number',
      label: 'How long?',
      min: 15,
      max: 120,
      step: 15,
      suggested: 30,
      unit: 'min',
    },
    { id: 'agenda', kind: 'text', label: 'Agenda', optional: true, placeholder: 'What to cover' },
  ],
};

const meta = {
  title: 'Patterns/Chat/QuestionCard',
  component: QuestionCard,
  parameters: {
    docs: {
      description: {
        component:
          'A question the assistant asks in the middle of a reply (ADR 0060), answered with a tap instead of a typed paragraph: options, a day and a time, a number, a few words. It sits in the flow of the chat — never a modal — and wears the pearl rim, barely, while it waits for you. A single choice goes the moment you tap it; anything more has one **Send**. **Skip** is always there, quietly, and the assistant carries on with its best guess. Once answered it folds to one line: the question, muted, and what you said. Keys: 1–6 pick, arrows move, Enter sends. Dates and times never use the browser’s own pickers: a strip of the coming days, a calendar for the rest, and a few times to tap.',
      },
    },
  },
  args: {
    question: callType,
    today: TODAY,
    locale: 'en-GB',
    assistant: 'Conch',
    onAnswer: () => {},
    onSkip: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', gap: 16, maxInlineSize: '44rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof QuestionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** One choice, one field: a tap is the answer. No Send. */
export const SingleChoice: Story = {};

/** Several at once: tick them, then Send. */
export const MultipleChoice: Story = { args: { question: toppings } };

/** “Something else…” opens a line to say it in your own words. */
export const SomethingElse: Story = { args: { question: sizes } };

/** The coming days at a glance, the suggested one already chosen; a calendar for the rest. */
export const Day: Story = { args: { question: day } };

export const Time: Story = { args: { question: time } };

export const DayAndTime: Story = { args: { question: when } };

export const AFewWords: Story = { args: { question: text } };

export const SeveralLines: Story = { args: { question: notes } };

export const ANumber: Story = { args: { question: guests } };

/** More than one thing: a short form with one Send. */
export const AShortForm: Story = { args: { question: booking } };

export const Sending: Story = { args: { question: guests, state: 'sending' } };

export const CouldNotSend: Story = {
  args: {
    question: guests,
    error: 'That didn’t reach Conch. Check your connection, then send it again.',
  },
};

export const Answered: Story = {
  args: { question: when, state: 'answered', answer: 'Thursday 8 Oct, 10:00' },
};

export const AnsweredInYourMessage: Story = {
  args: { question: callType, state: 'answered', answeredInMessage: true },
};

export const Skipped: Story = { args: { question: booking, state: 'skipped' } };

/** The reply ended before it was answered: nothing to press. */
export const Locked: Story = { args: { question: callType, disabled: true } };

const words = (values: QuestionCardValues) =>
  [
    values.when === '2026-10-08T10:00' ? 'Thursday 8 Oct, 10:00' : String(values.when ?? ''),
    values.type === 'video' ? 'Video call' : values.type === 'phone' ? 'Phone' : '',
  ]
    .filter(Boolean)
    .join(' · ');

function InChat(props: Partial<QuestionCardProps>) {
  const [answer, setAnswer] = useState<string>();
  const [state, setState] = useState<QuestionCardProps['state']>('open');
  const question: QuestionCardQuestion = {
    questionId: 'q-call',
    title: 'Booking a call with Ada',
    fields: [
      { id: 'when', kind: 'datetime', label: 'When?', suggested: '2026-10-08T10:00', min: TODAY },
      {
        id: 'type',
        kind: 'choice',
        label: 'How?',
        options: [
          { id: 'video', label: 'Video call' },
          { id: 'phone', label: 'Phone' },
        ],
      },
    ],
  };
  return (
    <MessageList>
      <Message from="user">Book a call with Ada next week</Message>
      <Message from="assistant">
        <Prose>Ada is free most mornings next week. Two things before I send the invite:</Prose>
      </Message>
      <QuestionCard
        question={question}
        today={TODAY}
        locale="en-GB"
        {...props}
        state={state}
        answer={answer}
        onAnswer={(values) => {
          setState('sending');
          setTimeout(() => {
            setAnswer(words(values));
            setState('answered');
          }, 700);
        }}
        onSkip={() => setState('skipped')}
      />
      {state === 'answered' && (
        <Message from="assistant">
          <Prose>Done — the invite is in both calendars, with a Meet link.</Prose>
        </Message>
      )}
      {state === 'skipped' && (
        <Message from="assistant">
          <Prose>
            I went with Thursday at 10:00 as a video call, the first slot you both have free.
          </Prose>
        </Message>
      )}
    </MessageList>
  );
}

export const InAConversation: Story = { render: () => <InChat /> };
