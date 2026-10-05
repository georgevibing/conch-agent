import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Button } from '../../components/Button';
import { Message } from '../Message';
import { Prose } from '../Prose';
import { AppOffer, type AppOfferState } from './AppOffer';
import {
  coffeeTab,
  coffeeTools,
  coffeeWords,
  plantDiary,
  plantTools,
  plantUpdate,
  plantWords,
  samplePictures,
} from './fixtures';

const meta = {
  title: 'Patterns/Chat/App offer',
  component: AppOffer,
  args: {
    action: 'add',
    manifest: plantDiary,
    tools: plantTools,
    source: { kind: 'made' },
    signature: { state: 'unsigned' },
    summary:
      'I made you a plant diary: tell me when you water something, and ask me which plants are thirsty. It checks the forecast first, so rain counts.',
    words: plantWords,
    state: 'ready',
    onAdd: fn(),
    onOpenPage: fn(),
    onNotNow: fn(),
    onTry: fn(),
    onOpenApp: fn(),
  },
  argTypes: {
    state: {
      control: 'inline-radio',
      options: ['ready', 'added', 'updated', 'stale', 'declined', 'failed'],
    },
    action: { control: 'inline-radio', options: ['add', 'update'] },
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'An app the assistant made or found, offered under its reply (ADR 0061). Its icon, name and what it does; the assistant’s one sentence; **what it can do** in the protocol’s plain words (the same on its page and in the preview); its pages and tools; who it’s from; a field for each setting it needs, typed here so the assistant never sees it; and **Add to my apps**. The agent proposes, the person adds: this press is the only way in. Never a dialog. Added, it turns into a short welcome — the icon lands while one ring of pearl light passes out from it — with its examples as chips to try. A newer version or **Not now** folds it to one quiet line. With reduced motion it simply changes.',
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
} satisfies Meta<typeof AppOffer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** Made in this chat: what it can do, what it needs, and Add to my apps. */
export const Ready: Story = {};

/** Pressed: the card holds still while it's added. */
export const Busy: Story = { args: { busy: true } };

/** An app with a picture as its icon (ADR 0090): the card shows it where the glyph would be. */
export const WithAPicture: Story = { args: { picture: samplePictures.blossom } };

/** A new version of one you have: what changed first, new reach marked. */
export const Update: Story = {
  args: {
    action: 'update',
    manifest: { ...plantDiary, version: '1.1.0' },
    changes: plantUpdate.changes,
    words: plantUpdate.words,
    saved: ['weatherKey', 'city'],
    summary: 'It can now name a plant from a photo, using GBIF’s species list.',
  },
};

/** Found on GitHub and signed by its maker: who it’s from, in full. */
export const FromSomeoneElse: Story = {
  args: {
    manifest: coffeeTab,
    tools: coffeeTools,
    source: { kind: 'github' },
    signature: {
      state: 'untrusted',
      publisher: 'Ada Lovelace',
      fingerprint: '3F9A 21C0 7B44 E1D2',
    },
    words: coffeeWords,
    summary: undefined,
  },
};

export const Added: Story = { args: { state: 'added' } };

export const Updated: Story = {
  args: { state: 'updated', action: 'update', manifest: { ...plantDiary, version: '1.1.0' } },
};

export const Stale: Story = { args: { state: 'stale' } };

export const Declined: Story = { args: { state: 'declined' } };

export const Failed: Story = {
  args: {
    state: 'failed',
    message: 'Plant diary changed after this card was shown. Ask for it again to see the newest.',
  },
};

/** The whole moment: press Add, watch it arrive. */
export const InAChat: Story = {
  render: function InAChat(args) {
    const [state, setState] = useState<AppOfferState>('ready');
    const [busy, setBusy] = useState(false);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Message from="assistant">
          <Prose>
            <p>Here it is. Try it out, and tell me if you want it to track feeding too.</p>
          </Prose>
        </Message>
        <AppOffer
          {...args}
          state={state}
          busy={busy}
          onAdd={() => {
            setBusy(true);
            setTimeout(() => {
              setBusy(false);
              setState('added');
            }, 900);
          }}
          onNotNow={() => setState('declined')}
        />
        <div>
          <Button size="sm" variant="ghost" onClick={() => setState('ready')}>
            Start over
          </Button>
        </div>
      </div>
    );
  },
};
