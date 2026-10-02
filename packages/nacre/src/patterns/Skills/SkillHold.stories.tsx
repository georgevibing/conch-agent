import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { Stack } from '../../components/Stack';
import { SkillHold, SkillHoldEnded, type SkillHoldEntry } from './SkillHold';
import { SkillUsed } from './SkillUsed';

const quickSetup: SkillHoldEntry = {
  skillId: 'quick-setup',
  title: 'Quick setup',
  declared: true,
  capabilities: ['commands', 'files'],
  words: ['run commands (only `git`, `npm install`)', 'change files in your work folder'],
};
const weekly: SkillHoldEntry = {
  skillId: 'weekly-review',
  title: 'Weekly review',
  declared: false,
  capabilities: ['files', 'web'],
  words: ['change files in your work folder', 'read the web'],
};

const meta = {
  title: 'Patterns/Skills/SkillHold',
  component: SkillHold,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'What a chat is held to (ADR 0040). Once a skill’s instructions are in a chat they stay in its context, so the chat stays held to its list in every later turn, not only the one it came in: anything else it tries asks first. One quiet line above the composer per skill; its name opens the list. **Stop holding** asks once, in words, and only a person can do it. Several skills are held together, the strictest way: a call has to be on every list.',
      },
    },
  },
  args: { holds: [quickSetup], onStop: () => {} },
  decorators: [(Story) => <div style={{ maxInlineSize: 736 }}>{Story()}</div>],
} satisfies Meta<typeof SkillHold>;

export default meta;
type Story = StoryObj<typeof meta>;

export const One: Story = {};

export const Several: Story = { args: { holds: [quickSetup, weekly] } };

/** While an answer is being written, stopping waits for it. */
export const WhileAnswering: Story = { args: { busy: true } };

export const SeeTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Held to Quick setup’s list. See what it can do' }),
    );
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole('region', { name: 'This skill can:' })).toBeVisible();
  },
};

export const Stopping: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Stop holding this chat to Quick setup’s list' }),
    );
    const body = within(canvasElement.ownerDocument.body);
    await expect(
      await body.findByRole('alertdialog', {
        name: 'Stop holding this chat to Quick setup’s list?',
      }),
    ).toBeVisible();
  },
};

/** In the transcript: where it came in, carried from elsewhere, and where you ended it. */
export const InTheChat: Story = {
  render: () => (
    <Stack gap={2} align="start">
      <SkillUsed name="quick-setup" title="Quick setup" by="user" onOpen={() => {}} />
      <SkillUsed name="quick-setup" title="Quick setup" by="carried" carriedFrom="chat" />
      <SkillUsed name="weekly-review" title="Weekly review" by="carried" carriedFrom="helper" />
      <SkillHoldEnded title="Quick setup" />
    </Stack>
  ),
};

/** On a phone, the line wraps and the button stays whole. */
export const Phone: Story = {
  args: { holds: [quickSetup, weekly] },
  decorators: [(Story) => <div style={{ inlineSize: 358 }}>{Story()}</div>],
};
