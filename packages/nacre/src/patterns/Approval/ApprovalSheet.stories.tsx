import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { AgentAvatar } from '../AgentAvatar';
import { ApprovalSheet, type ApprovalSheetOutcome } from './ApprovalSheet';

const meta = {
  title: 'Patterns/Chat/ApprovalSheet',
  component: ApprovalSheet,
  args: {
    open: true,
    onOpenChange: fn(),
    onDecide: fn(),
    name: 'Pearl',
    face: <AgentAvatar name="Pearl" size="sm" />,
    where: 'Fix the build',
    title: 'Run npm test',
    detail: 'In your work folder',
    until: 'No answer by 14:32 is a no.',
    children: <pre>npm test -- --run src/push</pre>,
  },
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'mobile1' },
    docs: {
      description: {
        component:
          'One question on a phone, opened from its notification (ADR 0108). Who asks and where, what will happen as a big title, exactly what it would do under it, and two big answers at the bottom where a thumb rests. A step that matters says why it asks for a passkey first, and Allow says so too. Once answered, a seal closes over the answer and the sheet offers the way back to the chat.',
      },
    },
  },
} satisfies Meta<typeof ApprovalSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** A routine step: one press, as from the notification. */
export const Routine: Story = {};

/** A step that matters: the passkey first, and why. */
export const ConfirmFirst: Story = {
  args: {
    title: 'Send an email to Ana',
    detail: 'From you@example.com',
    confirm: 'It sends something to other people.',
    caution: 'This chat read a web page. Check this is what you asked for.',
    children: <pre>{'To: ana@example.com\nSubject: The draft\n\nHere it is, as promised.'}</pre>,
  },
};

/** It costs money: said first. */
export const Paid: Story = {
  args: {
    title: 'Make a picture with Gemini on OpenRouter',
    cost: 'Paid · about $0.04',
    detail: 'What you asked for goes to OpenRouter',
    confirm: 'It costs money.',
    children: undefined,
  },
};

export const Sending: Story = { args: { sent: 'allow' } };

export const Allowed: Story = { args: { outcome: 'allow' } };
export const Denied: Story = { args: { outcome: 'deny' } };
export const AlreadyAnswered: Story = { args: { outcome: 'gone' } };

/** The whole moment: press Allow, the seal closes, and back to the chat. */
export const Composed: Story = {
  render: (args) => {
    const [outcome, setOutcome] = useState<ApprovalSheetOutcome>();
    const [sent, setSent] = useState<'allow' | 'deny'>();
    return (
      <ApprovalSheet
        {...args}
        sent={sent}
        outcome={outcome}
        onDecide={(d) => {
          setSent(d);
          setTimeout(() => setOutcome(d), 500);
        }}
        onOpenChange={() => {
          setOutcome(undefined);
          setSent(undefined);
        }}
      />
    );
  },
};
