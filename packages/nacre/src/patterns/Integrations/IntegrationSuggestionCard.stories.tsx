import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { fn } from 'storybook/test';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { Message } from '../Message';
import { Prose } from '../Prose';
import {
  IntegrationSuggestionCard,
  type IntegrationSuggestionState,
} from './IntegrationSuggestionCard';

const linear = {
  name: 'Linear',
  brand: 'linear',
  color: '#5E6AD2',
  description: 'Find, create and update issues and projects.',
  assistant: 'Conch',
};

const meta = {
  title: 'Patterns/Chat/IntegrationSuggestion',
  component: IntegrationSuggestionCard,
  args: {
    ...linear,
    state: 'suggested',
    onConnect: fn(),
    onNotNow: fn(),
    onMute: fn(),
    onUnmute: fn(),
    onAskAgain: fn(),
  },
  argTypes: {
    state: {
      control: 'inline-radio',
      options: ['suggested', 'connecting', 'connected', 'dismissed', 'muted'],
    },
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Offered in a chat when a message is about an app that isn’t connected (“what’s assigned to me in Linear?”). One small, calm card under the reply — the app’s own logo is the only colour — with one obvious button. “Connect” opens the connect dialog in place; once connected the card settles into a confirmation with “Ask again”. “Not now” folds it away for this chat; the quiet “Don’t suggest Linear” stops it everywhere, with Undo right there. It never reads as an ad: no badges, no exclamation marks, nothing that moves once it has arrived.',
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
} satisfies Meta<typeof IntegrationSuggestionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Suggested: Story = { args: { state: 'suggested' } };

export const Connecting: Story = { args: { state: 'connecting' } };

export const Connected: Story = { args: { state: 'connected' } };

/** Asked again already (or a reply is being written): nothing left to press. */
export const ConnectedSettled: Story = { args: { state: 'connected', onAskAgain: undefined } };

/** “Don’t suggest Linear”: one quiet line, with Undo. */
export const Muted: Story = { args: { state: 'muted' } };

/** The provider can’t connect Gmail itself, so Zapier is the way in, for every model. */
export const ThroughZapier: Story = {
  args: {
    name: 'Gmail',
    brand: 'gmail',
    color: '#EA4335',
    description: 'Search your inbox, read threads and draft replies.',
    via: 'Zapier',
  },
  render: (args) => (
    <Stack gap={4}>
      <IntegrationSuggestionCard {...args} state="suggested" />
      <IntegrationSuggestionCard {...args} state="connected" />
    </Stack>
  ),
};

function DismissDemo(args: Story['args']) {
  const [state, setState] = useState<IntegrationSuggestionState>('suggested');
  const [gone, setGone] = useState(false);
  return (
    <Stack gap={4} align="start">
      {!gone && (
        <IntegrationSuggestionCard
          {...linear}
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

function Walkthrough() {
  const [state, setState] = useState<IntegrationSuggestionState>('suggested');
  useEffect(() => {
    if (state !== 'connecting') return;
    const timer = setTimeout(() => setState('connected'), 1800);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <IntegrationSuggestionCard
      {...linear}
      state={state}
      onConnect={() => setState('connecting')}
      onNotNow={() => setState('dismissed')}
      onMute={() => setState('muted')}
      onUnmute={() => setState('suggested')}
      onAskAgain={() => setState('suggested')}
    />
  );
}

/** Press the buttons: Connect → signing in → connected → Ask again; or mute and undo. */
export const Flow: Story = { render: () => <Walkthrough /> };

/** Where it sits: under the reply that couldn’t use the app. */
export const InTheChat: Story = {
  parameters: { layout: 'padded' },
  render: (args) => (
    <Stack gap={5} style={{ maxInlineSize: 720 }}>
      <Message from="user" timestamp={new Date('2026-09-30T09:12:00')}>
        what’s assigned to me in Linear this week?
      </Message>
      <Message from="assistant" author="Conch" timestamp={new Date('2026-09-30T09:12:04')}>
        <Prose>
          <p>
            I can’t see your Linear yet, so I won’t guess at what’s in it. Once Linear is connected,
            I can look that up for you.
          </p>
        </Prose>
      </Message>
      <IntegrationSuggestionCard {...args} state="suggested" />
    </Stack>
  ),
};

/** Every state, side by side, for review. */
export const States: Story = {
  render: (args) => (
    <Stack gap={4}>
      {(['suggested', 'connecting', 'connected', 'muted'] as const).map((state) => (
        <IntegrationSuggestionCard key={state} {...args} state={state} />
      ))}
      <IntegrationSuggestionCard {...args} state="connected" onAskAgain={undefined} />
    </Stack>
  ),
};
