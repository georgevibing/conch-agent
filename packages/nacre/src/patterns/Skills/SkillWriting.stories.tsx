import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { SkillWriting } from './SkillWriting';

const meta = {
  title: 'Patterns/Skills/SkillWriting',
  component: SkillWriting,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Write it for me. Under a new skill’s steps, while the assistant writes them from your idea or rough notes, then once it has. The steps are never called finished: they’re yours to read and change, Write it again asks once more, and Back to my words puts back what you typed.',
      },
    },
  },
  args: { state: 'written', by: 'Conch', onAgain: fn(), onUndo: fn() },
  decorators: [(Story) => <div style={{ maxInlineSize: 736 }}>{Story()}</div>],
} satisfies Meta<typeof SkillWriting>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Written: Story = {};

/** While the steps are on their way: the pearl thinks, nothing to press yet. */
export const Writing: Story = { args: { state: 'writing' } };

/** On a phone, the two buttons go under the words. */
export const Narrow: Story = {
  decorators: [(Story) => <div style={{ maxInlineSize: 340 }}>{Story()}</div>],
};

export const Again: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Write it again' }));
    await expect(args.onAgain).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByRole('button', { name: 'Back to my words' }));
    await expect(args.onUndo).toHaveBeenCalledOnce();
  },
};
