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
          'Save how I did this (ADR 0058). After the assistant worked something out — many steps, maybe a false start, then it worked — a small card under the reply offers to keep that know-how as a skill: what it would do (a few words the draft’s model wrote, checked), one quiet line on how it went, and **Save as skill**, which opens the draft set to When I ask; nothing is saved until you save it. Never a dialog, never while an answer is being written, never twice in a chat. Learned in a chat that read something from outside, the same line says where, in words Conch writes from the chat’s marks, never a model’s.',
      },
    },
  },
  args: { title: 'Log a meal in Yazio', steps: 14, onSave: fn(), onDismiss: fn() },
  decorators: [(Story) => <div style={{ maxInlineSize: 736 }}>{Story()}</div>],
} satisfies Meta<typeof SkillOffer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** After reading a web page: still offered, and it says where it was learned. */
export const AfterReading: Story = {
  args: {
    title: 'Find a train',
    steps: 17,
    untrusted: 'Learned from trains.example and Yazio content.',
  },
};

/** On a phone, the buttons go under the words, on the words' edge. */
export const Narrow: Story = {
  args: { untrusted: 'Learned from Yazio and GitHub content.' },
  decorators: [(Story) => <div style={{ maxInlineSize: 340 }}>{Story()}</div>],
};

export const Save: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Save as skill' }));
    await expect(args.onSave).toHaveBeenCalled();
  },
};
