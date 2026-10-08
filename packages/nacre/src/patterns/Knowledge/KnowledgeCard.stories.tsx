import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { Column, InChat } from './Column';
import { ada, landscape, lisbon } from './fixtures';
import { KnowledgeCard } from './KnowledgeCard';

const meta = {
  title: 'Patterns/Chat/KnowledgeCard',
  component: KnowledgeCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A card about a person, place, thing or event, from Wikipedia (`knowledge_card`). What it is comes first, quietly, as a kicker; the name is set in the editorial serif; the opening shows four lines and opens the rest with **Read more**, its height following the words on a soft spring. Key facts sit in a tight definition list, two to a row when there is room. The picture follows its shape: a wide one leads the card, a tall one stands beside the name and the opening. Either drifts very slowly (ken burns), and holds still when motion is reduced. The source chip opens the article in a new tab. Everything is plain text from outside; the picture is the chat’s own copy, never a remote image.',
      },
    },
  },
  args: ada,
  decorators: [
    (Story) => (
      <Column width={560}>
        <Story />
      </Column>
    ),
  ],
} satisfies Meta<typeof KnowledgeCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** A tall portrait stands beside the words. */
export const Person: Story = {};

/** A wide picture leads the card; six facts, two to a row. */
export const Place: Story = { args: lisbon };

/** No picture: the words alone, still set like a page. */
export const NoPicture: Story = {
  args: { ...ada, picture: undefined, related: undefined },
};

/** Short opening: nothing to read more of, so no button. */
export const Short: Story = {
  args: {
    ...lisbon,
    extract: 'Lisbon is the capital and largest city of Portugal.',
    facts: undefined,
  },
};

/** Read more opens the rest, and closes it again. */
export const ReadMore: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const more = await canvas.findByRole('button', { name: 'Read more' });
    await userEvent.click(more);
    await expect(canvas.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  },
};

/** A picture that never loads gives way to a quiet veil. */
export const BrokenPicture: Story = {
  args: { ...lisbon, picture: { ...landscape, src: '/missing.png' } },
};

/** On a phone: a smaller picture beside the name, the opening under it. */
export const Phone: Story = {
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 360 }}>
        <Story />
      </div>
    ),
  ],
};

export const InAChat: Story = {
  decorators: [],
  render: (args) => (
    <InChat
      ask="Who was Ada Lovelace?"
      card={<KnowledgeCard {...args} />}
      reply="She’s often called the first programmer: her notes on Babbage’s engine include an algorithm for it."
    />
  ),
};
