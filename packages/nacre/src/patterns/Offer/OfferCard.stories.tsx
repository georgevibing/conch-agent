import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { fn } from 'storybook/test';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { Message } from '../Message';
import { Prose } from '../Prose';
import { OfferAlsoTry, OfferCard, type OfferCardState } from './OfferCard';

const calendar = {
  kind: 'app' as const,
  name: 'Google Calendar',
  brand: 'google-calendar',
  color: '#4285F4',
  description: 'See what’s coming up and find time for things.',
  why: 'Your week is in your calendar, so I could see what’s actually booked.',
  assistant: 'Conch',
};

const review = {
  kind: 'skill' as const,
  name: 'Weekly review',
  brand: 'weekly-review',
  description: 'Plans the week from your calendar and open work.',
  why: 'Your Weekly review skill plans a week the way you like it.',
  skillMode: 'off' as const,
  permissions: {
    capabilities: ['files' as const, 'apps' as const],
    words: ['change files in your work folder', 'use your connected apps'],
    declared: true,
  },
  assistant: 'Conch',
};

const examples = ['What’s on my calendar tomorrow?', 'When am I free for an hour this week?'];

const meta = {
  title: 'Patterns/Chat/Offer',
  component: OfferCard,
  args: {
    ...calendar,
    state: 'suggested',
    onTake: fn(),
    onTurnOn: fn(),
    onUseOnce: fn(),
    onCarryOn: fn(),
    onNotNow: fn(),
    onMute: fn(),
    onUnmute: fn(),
  },
  argTypes: {
    state: {
      control: 'inline-radio',
      options: [
        'suggested',
        'connecting',
        'review',
        'ready',
        'accepted',
        'dismissed',
        'muted',
        'expired',
      ],
    },
    kind: { control: 'inline-radio', options: ['app', 'skill'] },
    skillMode: { control: 'inline-radio', options: ['off', 'manual'] },
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The one thing a request is missing, offered right under the reply that needed it (ADR 0060): an app to connect, or a skill that’s off. It says why in the assistant’s own words, with one button — **Connect**, **Turn on** or **Use it** — a quiet **Not now**, and **Don’t suggest** tucked in the overflow. A skill opens in place to show what it may do before it’s on. Taken, the card folds into a quiet line, “Connected Google Calendar · carrying on”, its check drawing itself once, and the chat carries on by itself. A newer message overtakes an unanswered offer, which shrinks to a small line. Nothing about it moves once it has arrived, and with reduced motion it simply changes.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 720 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OfferCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** The assistant asked: its reason, in its own voice. */
export const Suggested: Story = { args: { state: 'suggested' } };

/** Noticed in the person’s words (“…in Linear”): the catalog’s own line. */
export const FromTheirWords: Story = {
  args: {
    name: 'Linear',
    brand: 'linear',
    color: '#5E6AD2',
    description: 'Find, create and update issues and projects.',
    why: undefined,
  },
};

export const Connecting: Story = { args: { state: 'connecting' } };

/** It was connected somewhere else first: one press carries on. */
export const Ready: Story = { args: { state: 'ready' } };

/** Folded into a quiet line while the chat carries on. */
export const Accepted: Story = { args: { state: 'accepted' } };

/** Overtaken by a newer message: it never carries on. */
export const Expired: Story = { args: { state: 'expired' } };

/** “Don’t suggest Google Calendar”: one line, with Undo. */
export const Muted: Story = { args: { state: 'muted' } };

/** A Conch app you have but switched off (ADR 0061): its own icon, and **Turn on**. */
export const AppSwitchedOff: Story = {
  args: {
    name: 'Tally',
    brand: undefined,
    color: undefined,
    app: { glyph: 'calculator', color: 'teal' },
    description: 'Count things for you, one tap at a time.',
    why: undefined,
    state: 'suggested',
  },
};

export const AppTurnedOn: Story = {
  args: { ...AppSwitchedOff.args, state: 'accepted' },
};

export const SkillOff: Story = { args: { ...review, state: 'suggested' } };

/** **Turn on** first shows what it may do, in place. */
export const SkillReview: Story = { args: { ...review, state: 'review' } };

/** A skill that waits to be asked: **Use it** once, or **Always**. */
export const SkillWhenAsked: Story = {
  args: {
    ...review,
    name: 'PDF tools',
    brand: 'pdf',
    description: 'Fill in, merge and split PDFs.',
    why: 'Your PDF tools skill can fill this form in for you.',
    skillMode: 'manual',
    permissions: {
      capabilities: ['files' as const],
      words: ['change files in your work folder'],
      declared: true,
    },
    state: 'review',
  },
};

export const SkillAccepted: Story = { args: { ...review, state: 'accepted', taken: 'on' } };

const shared = {
  kind: 'market' as const,
  name: 'Meeting notes',
  brand: 'meeting-notes',
  description: 'Turns rough meeting notes into decisions, actions and open questions.',
  why: 'It turns notes like these into a list of who does what by when.',
  market: {
    sourceLabel: 'ClawHub',
    publisher: 'Ada',
    trust: 'verified' as const,
    installs: 18_400,
  },
  muteLabel: 'Don’t suggest skills from Discover',
  assistant: 'Conch',
};

/** A skill people share (ADR 0081): where it's from and what that place says; **Look at it** reads it first. */
export const SharedSkill: Story = { args: { ...shared, state: 'suggested' } };

/** Added from the card: the chat carries on with it. */
export const SharedSkillAdded: Story = { args: { ...shared, state: 'accepted' } };

/** Don't suggest: every skill from Discover, with Undo. */
export const SharedSkillMuted: Story = { args: { ...shared, state: 'muted' } };

export const SkillUsedOnce: Story = {
  args: { ...review, name: 'PDF tools', brand: 'pdf', state: 'accepted', taken: 'once' },
};

function DismissDemo(args: Story['args']) {
  const [state, setState] = useState<OfferCardState>('suggested');
  const [gone, setGone] = useState(false);
  return (
    <Stack gap={4} align="start">
      {!gone && (
        <OfferCard
          {...calendar}
          {...args}
          state={state}
          onNotNow={() => setState('dismissed')}
          onGone={() => setGone(true)}
        />
      )}
      {gone && (
        <Button
          size="sm"
          variant="surface"
          onClick={() => {
            setState('suggested');
            setGone(false);
          }}
        >
          Show it again
        </Button>
      )}
    </Stack>
  );
}

/** “Not now”: it folds away, and the chat closes the gap. */
export const Dismissed: Story = { render: (args) => <DismissDemo {...args} /> };

function Walkthrough({ skill }: { skill?: boolean }) {
  const [state, setState] = useState<OfferCardState>('suggested');
  const [taken, setTaken] = useState<'on' | 'once'>();
  useEffect(() => {
    if (state !== 'connecting') return;
    const timer = setTimeout(() => setState('accepted'), 1600);
    return () => clearTimeout(timer);
  }, [state]);
  const props = skill ? { ...review, skillMode: 'manual' as const } : calendar;
  return (
    <Stack gap={4} align="start">
      <OfferCard
        {...props}
        state={state}
        taken={taken}
        onTake={() => setState(skill ? 'review' : 'connecting')}
        onTurnOn={() => {
          setTaken('on');
          setState('accepted');
        }}
        onUseOnce={() => {
          setTaken('once');
          setState('accepted');
        }}
        onNotNow={() => setState('dismissed')}
        onMute={() => setState('muted')}
        onUnmute={() => setState('suggested')}
        onGone={() => setState('suggested')}
      />
      {state === 'accepted' && (
        <Button size="sm" variant="ghost" onClick={() => setState('suggested')}>
          Again
        </Button>
      )}
    </Stack>
  );
}

/** Press it: Connect → signing in → folded into “carrying on”; or mute and undo. */
export const Flow: Story = { render: () => <Walkthrough /> };

/** A skill: Use it → what it may do → Use it, or Always. */
export const SkillFlow: Story = { render: () => <Walkthrough skill /> };

/** What else it can do, once it’s on: the words on a chip are the words sent. */
export const AlsoTry: Story = {
  render: () => <OfferAlsoTry examples={[...examples, 'Not shown: two at most']} onPick={fn()} />,
};

/** Where it sits: under the reply that couldn’t see the calendar. */
export const InTheChat: Story = {
  render: (args) => (
    <Stack gap={5} style={{ maxInlineSize: 720 }}>
      <Message from="user" timestamp={new Date('2026-10-03T09:12:00')}>
        what’s on my plate this week?
      </Message>
      <Message from="assistant" author="Conch" timestamp={new Date('2026-10-03T09:12:04')}>
        <Prose>
          <p>
            I can’t see your calendar yet, so I won’t guess at it. From this chat, you wanted to
            finish the budget review by Thursday.
          </p>
        </Prose>
      </Message>
      <OfferCard {...args} state="suggested" />
    </Stack>
  ),
};

/** Taken: a quiet line, the answer, and what to try next. */
export const CarryingOn: Story = {
  render: (args) => (
    <Stack gap={5} style={{ maxInlineSize: 720 }}>
      <Message from="user" timestamp={new Date('2026-10-03T09:12:00')}>
        what’s on my plate this week?
      </Message>
      <Message from="assistant" author="Conch" timestamp={new Date('2026-10-03T09:12:04')}>
        <Prose>
          <p>I can’t see your calendar yet, so I won’t guess at it.</p>
        </Prose>
      </Message>
      <OfferCard {...args} state="accepted" />
      <Message from="assistant" author="Conch" timestamp={new Date('2026-10-03T09:13:10')}>
        <Prose>
          <p>
            Three things are booked: the design review on Tuesday at 10, lunch with Sam on
            Wednesday, and the board call on Friday at 4. Thursday is clear for the budget.
          </p>
        </Prose>
      </Message>
      <OfferAlsoTry examples={examples} onPick={fn()} />
    </Stack>
  ),
};

/** Every state, side by side, for review. */
export const States: Story = {
  render: (args) => (
    <Stack gap={4}>
      {(['suggested', 'connecting', 'ready', 'accepted', 'expired', 'muted'] as const).map(
        (state) => (
          <OfferCard key={state} {...args} state={state} />
        ),
      )}
      <OfferCard {...args} {...review} state="suggested" />
      <OfferCard {...args} {...review} state="review" />
      <OfferCard
        {...args}
        {...review}
        name="PDF tools"
        brand="pdf"
        skillMode="manual"
        state="review"
      />
      <OfferCard {...args} {...review} state="accepted" taken="on" />
      <OfferCard {...args} {...review} state="expired" />
    </Stack>
  ),
};
