import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { BookShelf } from './BookShelf';
import { Column, InChat } from './Column';
import { books, leftHand } from './fixtures';

const meta = {
  title: 'Patterns/Chat/BookShelf',
  component: BookShelf,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Books found (`book_search`, Open Library), standing on a shelf: each cover at its own shape on a plank with a lit top face and a soft contact shadow. Hover or focus pulls a book forward on a bouncy spring and names it under the shelf; pressing it opens its details in a popover: who wrote it, when, how long, what readers thought, what it’s about, and a link to its page. One tab stop for the shelf; arrow keys move along it. A book without a cover gets one drawn from its title, in a colour of its own. A single book is shown open beside its details.',
      },
    },
  },
  args: { books },
  decorators: [
    (Story) => (
      <Column width={560}>
        <Story />
      </Column>
    ),
  ],
} satisfies Meta<typeof BookShelf>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** A shelf of six, one drawn from its title. */
export const Shelf: Story = {};

/** Press a book: its details, over the shelf. */
export const Details: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /^A Wizard of Earthsea/ }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText(/183 pages/)).toBeInTheDocument();
  },
  decorators: [
    (Story) => (
      <div style={{ paddingBlockStart: 300 }}>
        <Story />
      </div>
    ),
  ],
};

/** One book: shown open, beside its details. */
export const One: Story = { args: { books: [leftHand] } };

/** Nothing has a cover: every one drawn. */
export const NoCovers: Story = {
  args: { books: books.slice(0, 4).map((b) => ({ ...b, cover: undefined })) },
};

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
      ask="Books by Ursula K. Le Guin?"
      card={<BookShelf {...args} />}
      reply="Start with A Wizard of Earthsea if you like fantasy, The Dispossessed if you’d rather have ideas."
    />
  ),
};
