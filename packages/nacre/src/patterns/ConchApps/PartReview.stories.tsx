import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Message } from '../Message';
import { Prose } from '../Prose';
import { AppOffer } from './AppOffer';
import {
  fireworks,
  fireworksProvider,
  fireworksWords,
  zulip,
  zulipChannel,
  zulipWords,
} from './fixtures';
import { PartReview, type PartTestView, type PartValues } from './PartReview';

const meta = {
  title: 'Patterns/Chat/Part review',
  component: PartReview,
  args: {
    provider: fireworksProvider,
    values: { key: '', fields: {} },
    onValuesChange: fn(),
    test: { state: 'idle' },
    onTest: fn(),
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A provider or a chat app a Conch app brings, reviewed on its card before it’s added (ADR 0119). What it is and where its key goes; its models with their window and price; the steps in the chat app; the key typed right here, never seen by the assistant; and **Test it**: a real one-line answer that streams in, in the provider’s own words, or who the chat app’s bot is. **Add** waits for a test that passed.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 640 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PartReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** A provider, its key not typed yet: **Test it** waits for one. */
export const Provider: Story = {};

/** The key is in: one short question, with it, before adding. */
export const ProviderReady: Story = {
  args: { values: { key: 'fw_3kJx…9aQ', fields: {} } },
};

export const ProviderTesting: Story = {
  args: { values: { key: 'fw_3kJx…9aQ', fields: {} }, test: { state: 'testing' } },
};

/** It answered: its first words stream in, in its own voice. */
export const ProviderPassed: Story = {
  args: {
    values: { key: 'fw_3kJx…9aQ', fields: {} },
    test: {
      state: 'passed',
      said: 'Hello! Glad to be here — ready when you are.',
      model: 'accounts/fireworks/models/llama4-maverick-instruct-basic',
      ms: 640,
    },
  },
};

export const ProviderFailed: Story = {
  args: {
    values: { key: 'fw_wrong', fields: {} },
    test: {
      state: 'failed',
      message: 'Fireworks AI refused your key. Check that you copied all of it.',
    },
  },
};

/** A chat app: the steps in the app itself, then its fields. */
export const ChatApp: Story = {
  args: { provider: undefined, channel: zulipChannel },
};

export const ChatAppPassed: Story = {
  args: {
    provider: undefined,
    channel: zulipChannel,
    values: {
      key: '',
      fields: {
        site: 'https://ada.zulipchat.com',
        email: 'conch-bot@ada.zulipchat.com',
        apiKey: '•••',
      },
    },
    test: { state: 'passed', said: 'Connected as Conch (@conch-bot)', ms: 420 },
  },
};

/** On the card under the assistant's reply, the whole way: type, test, add. */
export const OnTheCard: Story = {
  render: () => <CardDemo />,
};

function CardDemo() {
  const [state, setState] = useState<'ready' | 'added'>('ready');
  const test = async (values: PartValues): Promise<PartTestView> => {
    await new Promise((r) => setTimeout(r, 700));
    return values.key.startsWith('fw_')
      ? {
          state: 'passed',
          said: 'Hello! Fireworks here, fast and ready.',
          model: fireworksProvider.models[0]?.id,
          ms: 640,
        }
      : { state: 'failed', message: 'Fireworks AI refused your key. Fireworks keys start fw_.' };
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Message from="assistant">
        <Prose>
          <p>
            I read Fireworks’ API docs and made it a provider. Paste your key into the card, press
            Test it, then Add.
          </p>
        </Prose>
      </Message>
      <AppOffer
        action="add"
        manifest={fireworks}
        tools={[]}
        source={{ kind: 'made' }}
        signature={{ state: 'unsigned' }}
        words={fireworksWords}
        state={state}
        brings={{ provider: fireworksProvider }}
        onTest={test}
        onAdd={() => setState('added')}
        onNotNow={fn()}
      />
    </div>
  );
}

/** A chat app's card, from a sentence: “connect me on Zulip”. */
export const ChatAppOnTheCard: Story = {
  render: () => (
    <AppOffer
      action="add"
      manifest={zulip}
      tools={[]}
      source={{ kind: 'made' }}
      signature={{ state: 'unsigned' }}
      words={zulipWords}
      state="ready"
      brings={{ channel: zulipChannel }}
      onTest={async () => ({ state: 'passed', said: 'Connected as Conch (@conch-bot)', ms: 420 })}
      onAdd={fn()}
      onNotNow={fn()}
    />
  ),
};

/** Added: one of your providers, with where to find it. */
export const ProviderAdded: Story = {
  render: () => (
    <AppOffer
      action="add"
      manifest={fireworks}
      tools={[]}
      source={{ kind: 'made' }}
      signature={{ state: 'unsigned' }}
      words={fireworksWords}
      state="added"
      brings={{ provider: fireworksProvider }}
      onOpenApp={fn()}
    />
  ),
};
