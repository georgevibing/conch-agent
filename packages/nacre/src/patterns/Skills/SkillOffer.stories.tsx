import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { SkillOffer } from './SkillOffer';

const meta = {
  title: 'Patterns/Skills/SkillOffer',
  component: SkillOffer,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Save how I did this (ADR 0058). After the assistant worked something out — many steps, maybe a false start, then it worked — one quiet line under the reply offers to keep that know-how as a skill. One button opens the draft, set to When I ask; nothing is saved until you save it. Never a dialog, never while an answer is being written, never twice in a chat. Learned in a chat that read something from outside, it says so.',
      },
    },
  },
  args: { steps: 14, onSave: fn(), onDismiss: fn() },
  decorators: [(Story) => <div style={{ maxInlineSize: 736 }}>{Story()}</div>],
} satisfies Meta<typeof SkillOffer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** After reading a web page: still offered, and it says where it was learned. */
export const AfterReading: Story = {
  args: { steps: 11, untrusted: 'Learned in a chat that read trains.example.' },
};

/** On a phone, the button goes under the words. */
export const Narrow: Story = {
  decorators: [(Story) => <div style={{ maxInlineSize: 340 }}>{Story()}</div>],
};

export const Save: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Save how I did this as a skill' }));
    await expect(args.onSave).toHaveBeenCalled();
  },
};
