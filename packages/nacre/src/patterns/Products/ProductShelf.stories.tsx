import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Message, MessageList } from '../Message';
import { Prose } from '../Prose';
import { KETTLES, MIXED, PICTURES } from './fixtures';
import { ProductShelf } from './ProductShelf';

const meta = {
  title: 'Patterns/Chat/ProductShelf',
  component: ProductShelf,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Products the assistant found while you shop (`product_details`), drawn as cards in the chat. One product is a wide hero card with its highlights; two or three stand side by side; more sit on a shelf that scrolls sideways and snaps card by card, fading where there’s more, with round buttons at its edges on hover where there’s a pointer. Each card stands its photo on a porcelain stage (light in both themes, so a shop’s white backdrop melts into it), and the photo leans a little toward the pointer. Below: the brand and shop, the name in two lines, stars to the half with the number (read aloud as words), the price large in the currency’s own format, the price before struck through with a tilted −23% tag, and availability as a calm dot and a word. The photo opens its gallery (← →, a swipe, thumbnails). The heart keeps it on a shortlist for the session with a springy pop. **Compare** lets you pick two or three for a table, each row’s best marked in words (“Lowest”, “Top rated”). **Ask about this** puts words in the composer and never sends them. Cards rise in one after another as a reply arrives. Arrow keys, Home and End move between cards. Pictures are always the chat’s own attachments, never a remote address.',
      },
    },
  },
  args: { products: KETTLES, onAsk: fn(), locale: 'en-US' },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 720, marginInline: 'auto' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProductShelf>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** One product: a wide card with its highlights, the price large, and Open in the shop. */
export const Hero: Story = { args: { products: KETTLES.slice(0, 1) } };

/** Two or three stand side by side, filling the column. */
export const Few: Story = { args: { products: KETTLES } };

/** Many scroll sideways, snapping card by card, with fades and edge buttons. */
export const Shelf: Story = { args: { products: MIXED } };

/** Opened to compare: the first three are picked, the best of each row marked. */
export const Compare: Story = {
  args: { products: KETTLES, compare: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('table')).toBeInTheDocument();
    await expect(canvas.getByText('Lowest')).toBeInTheDocument();
  },
};

/** Hearted ones are counted over the shelf, and remembered for the session. */
export const Shortlisted: Story = {
  args: { products: MIXED.slice(3, 7) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [first] = canvas.getAllByRole('button', { name: /^Shortlist/ });
    if (first && first.getAttribute('aria-pressed') !== 'true') await userEvent.click(first);
    await expect(canvas.getByText(/shortlisted/)).toBeInTheDocument();
  },
};

/** What a page didn't say stays unsaid: no photo, no price, no rating. */
export const Sparse: Story = {
  args: {
    products: [
      { title: 'Linen throw', store: 'throws.example' },
      {
        title: 'Brass reading lamp',
        pictures: [PICTURES.lamp],
        price: { amount: 2980, currency: 'JPY' },
      },
    ],
  },
};

/** History is drawn still: nothing rises in. */
export const Still: Story = { args: { products: MIXED, arriving: false } };

/** As it sits in a chat, under the assistant's judgement. */
export const InChat: Story = {
  args: { products: KETTLES },
  render: (args) => (
    <MessageList>
      <Message from="user">Find me a nice kettle for pour-over coffee, under $200</Message>
      <Message from="assistant">
        <ProductShelf {...args} />
        <Prose>
          {
            'Get the **Stagg EKG** if pour-over is the point: it holds a temperature and it’s 23% off right now. The Smeg boils more at once and is cheaper, but its spout won’t pour slowly. Skip the retro one, it’s out of stock.'
          }
        </Prose>
      </Message>
    </MessageList>
  ),
};

/** A phone's width: a card and a peek of the next, swiped. */
export const Phone: Story = {
  args: { products: MIXED },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 360 }}>
        <Story />
      </div>
    ),
  ],
};
