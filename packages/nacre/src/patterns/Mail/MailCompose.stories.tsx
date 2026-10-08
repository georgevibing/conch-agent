import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { MailCompose } from './MailCompose';
import { MailSent } from './MailSent';
import type { MailChange } from './people';

const meta = {
  title: 'Patterns/Chat/MailCompose',
  component: MailCompose,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'An email before it goes, as a letter: who it’s from, who it’s for (names beside their addresses), the subject as its headline and the words in reading type, exactly as they’ll be sent. **Edit** turns the same sheet into fields in place — chips to add and remove people, the subject, the words — and **Done** marks it “Edited by you”. Send leads (⌘/Ctrl+Enter), Don’t send is quiet, Esc cancels editing. On Send the letter folds away and the stamp’s plane takes off; the sent card that follows says how it went.',
      },
    },
  },
  args: {
    from: 'ada@work.example',
    to: [{ address: 'maya.kim@example.com', name: 'Maya Kim' }],
    subject: 'Friday launch checklist',
    body: 'Hi Maya,\n\nCould you share the latest launch checklist before Friday? I’d like to walk through the open items with the team on Thursday afternoon.\n\nThanks,\nAda',
    editable: true,
    onSend: fn(),
    onDecline: fn(),
    onDraftInstead: fn(),
  },
} satisfies Meta<typeof MailCompose>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** Someone the thread didn’t name: the address is all there is, and that’s what shows. */
export const Review: Story = {
  args: {
    to: ['kaltsikis.software@gmail.com'],
    subject: 'Hi',
    body: 'Hi!',
  },
};

/** Opened for editing: the same sheet, in fields. */
export const Editing: Story = {
  args: {
    cc: [{ address: 'sam@example.org', name: 'Sam Rivera' }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Edit' }));
    await expect(canvas.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
  },
};

/** Changed and kept: marked, with the way back to the assistant’s words. */
export const Edited: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Edit' }));
    const subject = canvas.getByRole('textbox', { name: 'Subject' });
    await userEvent.clear(subject);
    await userEvent.type(subject, 'Friday launch checklist (updated)');
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Add someone to To' }),
      'sam@example.org ',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Done' }));
    await expect(canvas.getByText('Edited by you')).toBeInTheDocument();
  },
};

/** A reply goes to the thread’s people with its subject: those stay as they are. */
export const ReplyInThread: Story = {
  args: {
    reply: true,
    to: [{ address: 'reply@example.com', name: 'Alice Moreau' }],
    subject: 'Re: Café on Thursday',
    body: 'Thursday at ten works for me. See you there!\n\nAda',
  },
};

export const LongBody: Story = {
  args: {
    subject: 'Notes from the planning review',
    body: Array.from(
      { length: 18 },
      (_, i) =>
        `${i + 1}. ${['Ship the onboarding fixes', 'Move the beta to Tuesday', 'Write the release notes', 'Check the pricing page copy'][i % 4]} — owner to confirm by end of week.`,
    ).join('\n'),
  },
};

export const WithFiles: Story = {
  args: {
    files: [
      { id: 'att_1', name: 'Launch checklist.pdf', mime: 'application/pdf', size: 248_000 },
      {
        id: 'att_2',
        name: 'Budget.xlsx',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 41_000,
      },
    ],
  },
};

/** Words that read like a link or code are only ever words. */
export const LiteralContent: Story = {
  args: {
    subject: '',
    body: '<script>not code</script>\n[Not a link](https://example.com)\nUnicode is kept: Καλημέρα.',
  },
};

/** After reading something from outside, one quiet line asks for a second look. */
export const WithCaution: Story = {
  args: {
    caution: 'This chat read email from outside. Check this is what you asked for.',
  },
};

/** Saving to Drafts: nothing goes, so it says so, and the change is made in Gmail. */
export const SaveDraft: Story = {
  args: { intent: 'draft', editable: false },
};

/** Sent: the letter folds away and the plane is in the air. */
export const Sending: Story = {
  args: { status: 'sending', busy: 'send' },
};

/** The whole moment: press Send, it folds and flies, then lands as the sent card. */
export const Journey: Story = {
  render: function Journey(args) {
    const [step, setStep] = useState<'asking' | 'sending' | 'sent'>('asking');
    const [change, setChange] = useState<MailChange>();
    if (step === 'sent')
      return (
        <MailSent
          state="sent"
          arriving
          from={args.from}
          to={change?.to ?? args.to}
          subject={change?.subject ?? args.subject}
          body={change?.body ?? args.body}
          at={new Date().toISOString()}
          url="https://mail.google.com/mail/#sent/1"
          edited={Boolean(change)}
          onFollowUp={fn()}
        />
      );
    return (
      <MailCompose
        {...args}
        status={step === 'sending' ? 'sending' : 'asking'}
        {...(step === 'sending' && { busy: 'send' as const })}
        onSend={(edit) => {
          setChange(edit);
          setStep('sending');
          setTimeout(() => setStep('sent'), 1800);
        }}
      />
    );
  },
};
