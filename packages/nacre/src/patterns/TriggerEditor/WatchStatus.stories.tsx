import type { Meta, StoryObj } from '@storybook/react-vite';

import { WatchStatus } from './WatchStatus';

const NOW = Date.UTC(2026, 9, 3, 12);

const meta = {
  title: 'Patterns/Routines/WatchStatus',
  component: WatchStatus,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'How a routine that starts when something happens is doing: watching or not and why, in a sentence, with one thing to do; what it noticed and what it started; and for another app, its address with a copy button and a secret shown exactly once.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: '22rem' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    state: 'watching',
    text: 'When Anna Smith emails you',
    onlyIf: 'it’s about the invoice',
    noticed: 5,
    woke: 2,
    passed: 3,
    lastNoticedAt: NOW - 40 * 60_000,
    now: NOW,
  },
} satisfies Meta<typeof WatchStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Watching: Story = {};

/** A burst while a run went: what came waits for the next one. */
export const Waiting: Story = {
  args: {
    message: 'It has run 4 times this hour; what came since goes in its next run.',
    waiting: 3,
  },
};

/** Only a person can fix it: one sentence, one button. */
export const NeedsYou: Story = {
  args: {
    state: 'needs-you',
    message: 'Gmail needs you to sign in again.',
    action: { label: 'Open Apps', onClick: () => {} },
  },
};

export const Trouble: Story = {
  args: {
    state: 'trouble',
    text: 'When example.com/pricing changes',
    onlyIf: undefined,
    message: 'example.com took too long to answer. Conch keeps trying.',
    passed: 0,
  },
};

export const Paused: Story = { args: { state: 'off' } };

/** Another app's address, with a secret made on request and shown once. */
export const AnotherApp: Story = {
  args: {
    text: 'When another app sends a message',
    onlyIf: undefined,
    passed: 0,
    address: 'https://studio.tail1a2b3.ts.net/conch/hooks/Xq3v…',
    signed: false,
    onNewSecret: async () => 'whsec_' + 'MfKQ9r2s8aZx1y7p0LkW3eYbN4cV6tUh',
  },
};

export const AnotherAppDoorOff: Story = {
  args: {
    state: 'needs-you',
    text: 'When another app sends a message',
    onlyIf: undefined,
    message: 'Turn on its public address so other apps can reach this routine.',
    action: { label: 'Turn it on', onClick: () => {} },
    passed: 0,
    noticed: 0,
    woke: 0,
  },
};
