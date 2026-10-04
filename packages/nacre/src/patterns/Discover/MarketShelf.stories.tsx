import type { Meta, StoryObj } from '@storybook/react-vite';
import { PenLine } from 'lucide-react';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Button } from '../../components/Button';
import { categories, ideas, listings } from './fixtures';
import { MarketCategories, MarketIdeas, MarketShelf, MarketSkillCard } from './MarketShelf';

const meta = {
  title: 'Patterns/Discover/Shelf',
  component: MarketShelf,
  args: { listings, onOpen: fn(), title: 'Popular' },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          '**Discover** on the Skills page (ADR 0072): skills people publish, from Anthropic’s repository, ClawHub and skills.sh. Each card says what it does in a line, what its place says about it (Official, Verified publisher, Community, Flagged), who published it and how many use it. Nothing is added from a card: it opens the skill, read first. Calm when a place can’t be reached: a quiet line says what’s shown is from before.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 960 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MarketShelf>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Popular: Story = {};

export const Loading: Story = { args: { listings: [], loading: true } };

/** A place didn't answer: these are from before. */
export const FromBefore: Story = { args: { offline: true, listings: listings.slice(0, 2) } };

export const OfflineNothingYet: Story = { args: { offline: true, listings: [] } };

export const Limited: Story = { args: { limited: true, listings: listings.slice(0, 3) } };

/** Nothing for that search: write it instead. */
export const Empty: Story = {
  args: {
    listings: [],
    query: 'pool hours',
    title: undefined,
    emptyAction: (
      <Button size="sm" variant="soft" leadingIcon={<PenLine />}>
        Write it yourself
      </Button>
    ),
  },
};

/** On a phone. */
export const Narrow: Story = {
  decorators: [(Story) => <div style={{ maxInlineSize: 360 }}>{Story()}</div>],
};

export const OpenOne: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Meeting notes, from ClawHub. Look at it' }),
    );
    await expect(args.onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'clawhub:ada/meeting-notes' }),
    );
  },
};

/** One card, each kind of trust, and one you have. */
export const Cards: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, maxInlineSize: 420 }}>
      {listings.map((l) => (
        <MarketSkillCard key={l.id} listing={l} onOpen={fn()} />
      ))}
    </div>
  ),
};

/** Ideas and kinds, above the shelf. The arrow keys move between kinds. */
export const IdeasAndKinds: Story = {
  render: function Render(args) {
    const [kind, setKind] = useState<string>();
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <MarketIdeas ideas={ideas} onPick={fn()} />
        <MarketCategories categories={categories} value={kind} onChange={setKind} />
        <MarketShelf
          {...args}
          listings={kind ? listings.filter((l) => l.category === kind) : listings}
        />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const all = canvas.getByRole('radio', { name: 'All' });
    all.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('radio', { name: 'Writing' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(canvas.getByRole('radio', { name: 'Writing' })).toHaveFocus();
  },
};
