import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { MakeItYours, type MakeItYoursState, type PasswordVerdict } from './MakeItYours';

/** A stand-in for `checkPassword` from `@conch/protocol` (Nacre doesn't depend on it). */
function checkPassword(password: string): PasswordVerdict {
  const length = Array.from(password).length;
  if (length < 15)
    return {
      ok: false,
      score: 0,
      label: 'Too short',
      message: 'Use at least 15 characters — a short sentence works well.',
    };
  if (length < 20)
    return {
      ok: true,
      score: 2,
      label: 'Okay',
      message: 'Acceptable. A few more unexpected words make it much stronger.',
    };
  return { ok: true, score: 4, label: 'Strong', message: 'Strong password.' };
}

const suggestPassword = () => 'k7mbqe-x3tnzr-wd8pha';

const meta = {
  title: 'Patterns/Security/MakeItYours',
  component: MakeItYours,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The page the hello link opens on a new Conch (ADR 0064). One warm question and one big button for the way that fits this device: its own passkey, named for it, with a password a press away. Where there’s nothing built in, the password leads and the phone is the small link. Whoever opens the link first owns Conch, and the page says so. The card holds its size from first moment to last, so nothing jumps; when it’s done, a check lands with one ring of pearl light.',
      },
    },
  },
  args: {
    state: 'ready',
    address: 'conch.example.com',
    platform: 'mac',
    username: 'george',
    checkPassword,
    suggestPassword,
    onPasskey: () => undefined,
    onPassword: () => undefined,
  },
  argTypes: {
    state: {
      control: 'inline-radio',
      options: ['ready', 'working', 'done', 'expired', 'error'],
    },
    platform: {
      control: 'inline-radio',
      options: [undefined, 'mac', 'windows', 'ios', 'android', 'phone'],
    },
  },
} satisfies Meta<typeof MakeItYours>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** A MacBook: Touch ID is the big button. */
export const TouchId: Story = {};

/** A Windows PC: Windows Hello. */
export const WindowsHello: Story = { args: { platform: 'windows' } };

/** Nothing built in: the password leads, the phone is the small link. */
export const NothingBuiltIn: Story = { args: { platform: 'phone' } };

/** Passkeys don’t work here at all: just the password. */
export const PasswordOnly: Story = { args: { platform: undefined } };

export const Working: Story = { args: { state: 'working' } };

export const Failed: Story = {
  args: {
    state: 'error',
    error: 'Touch ID was cancelled. Try again, or choose a password instead.',
  },
};

export const Done: Story = { args: { state: 'done', onContinue: () => undefined } };

/** Done, while the app opens by itself. */
export const DoneOpening: Story = { args: { state: 'done' } };

export const Expired: Story = { args: { state: 'expired', onSignIn: () => undefined } };

/** The whole thing: press the button, the browser asks, it’s yours. */
export const Journey: Story = {
  render: (args) => {
    const [state, setState] = useState<MakeItYoursState>('ready');
    const finish = () => {
      setState('working');
      setTimeout(() => setState('done'), 1400);
    };
    return (
      <MakeItYours
        {...args}
        state={state}
        onPasskey={finish}
        onPassword={finish}
        onContinue={() => setState('ready')}
      />
    );
  },
};
