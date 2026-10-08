import type { Meta, StoryObj } from '@storybook/react-vite';

import { Column, InChat } from './Column';
import { links, quarterly, tidekit, tram } from './fixtures';
import { LinkCards } from './LinkCards';

const meta = {
  title: 'Patterns/Chat/LinkCards',
  component: LinkCards,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Previews of the pages in a reply (`link_preview`), as each page describes itself: its card tags and JSON-LD. One link is a large card: the picture, the site’s own icon and name, what kind of page it is when that matters (a video, a repository, a product), the date, the title and a few lines of what it says. Several are compact rows in one card, each with a small picture on the end. Hover lifts a card into the light and eases its picture closer; pressing anywhere opens the page in a new tab. A link that isn’t a secure web address is shown, and says it doesn’t open.',
      },
    },
  },
  args: { links: links.slice(0, 1) },
  decorators: [
    (Story) => (
      <Column width={560}>
        <Story />
      </Column>
    ),
  ],
} satisfies Meta<typeof LinkCards>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** One article: the large card. */
export const One: Story = {};

/** A video: the play mark sits on the picture, and the kind is said in words. */
export const Video: Story = { args: { links: [tram] } };

/** A page with no picture of its own. */
export const NoPicture: Story = { args: { links: [tidekit] } };

/** Several: compact rows in one card. */
export const Several: Story = { args: { links } };

/** Not a secure link: shown, never opened. */
export const NotSecure: Story = {
  args: { links: [{ ...quarterly, url: 'http://quarterly.example/plain' }] },
};

export const Phone: Story = {
  args: { links },
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
      ask="Send me that piece about Lisbon’s flood plan"
      card={<LinkCards {...args} />}
      reply="Here it is. The second half is about Alfama, where the shore plan is most contested."
    />
  ),
};
