import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Button } from '../../components/Button';
import { blocked, clean, notes, update, worrying } from './fixtures';
import { MarketSkillPreview } from './MarketSkillPreview';

const meta = {
  title: 'Patterns/Discover/Skill',
  component: MarketSkillPreview,
  args: { listing: notes, preview: clean, onAdd: fn(), onModeChange: fn() },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'One skill from Discover, read before it’s added (ADR 0074): what it does, what it will be able to do in plain words, what Conch found reading every file, who published it and where, the exact version it’s pinned to and its licence. One button adds it. A worrying one needs a tick first; one its licence or its registry rules out has no button. An update shows what’s different file by file, and says first when it asks for more.',
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
} satisfies Meta<typeof MarketSkillPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {
  render: function Render(args) {
    const [mode, setMode] = useState<'auto' | 'manual'>('auto');
    return <MarketSkillPreview {...args} mode={mode} onModeChange={setMode} />;
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: 'Only when I ask' }));
    await expect(canvas.getByRole('radio', { name: 'Only when I ask' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Add skill' }));
    await expect(args.onAdd).toHaveBeenCalled();
  },
};

/** While Conch downloads and reads every file. */
export const Reading: Story = { args: { preview: undefined } };

export const CouldNotRead: Story = {
  args: {
    preview: undefined,
    error: 'Conch couldn’t reach ClawHub. Check your internet connection.',
    onRetry: fn(),
  },
};

/** The ClawHavoc trick: the button waits for a tick. */
export const Worrying: Story = {
  args: { listing: worrying.listing, preview: worrying },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const add = canvas.getByRole('button', { name: 'Add anyway' });
    await expect(add).toBeDisabled();
    await userEvent.click(
      canvas.getByRole('checkbox', { name: 'I’ve read what Conch found, and I still want it' }),
    );
    await expect(add).toBeEnabled();
    await userEvent.click(add);
    await expect(args.onAdd).toHaveBeenCalled();
  },
};

/** Its licence rules it out: no button at all. */
export const Blocked: Story = { args: { listing: blocked.listing, preview: blocked } };

/** An update: what's different first, and that it asks for more. */
export const Update: Story = { args: { preview: update, addLabel: 'Update' } };

export const Added: Story = {
  args: {
    done: (
      <>
        <Button>Try it in a chat</Button>
        <Button variant="surface">Open it</Button>
      </>
    ),
  },
};

/** On a phone. */
export const Narrow: Story = {
  decorators: [(Story) => <div style={{ maxInlineSize: 360 }}>{Story()}</div>],
};
