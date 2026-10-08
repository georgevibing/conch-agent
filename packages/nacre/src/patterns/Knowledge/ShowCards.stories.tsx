import type { Meta, StoryObj } from '@storybook/react-vite';

import { Column, InChat } from './Column';
import { lowtide, nightFerry, NOW, shows } from './fixtures';
import { ShowCards } from './ShowCards';

const meta = {
  title: 'Patterns/Chat/ShowCards',
  component: ShowCards,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Shows found (`show_search`, TVmaze), as posters in a row that snaps as it scrolls. Each has its rating on the corner (a star and the number, said “out of 10”), its year and where it’s on, its genres, and an accent chip when the next episode is near: “Next episode in 3 days”. Hover lifts a poster on a spring; pressing opens its page in a new tab. One tab stop for the row; arrow keys move along it. A show without a poster gets one drawn from its title. A single show is shown in full, its poster beside what it’s about.',
      },
    },
  },
  args: { shows, now: NOW },
  decorators: [
    (Story) => (
      <Column width={640}>
        <Story />
      </Column>
    ),
  ],
} satisfies Meta<typeof ShowCards>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** A row of five: two with an episode coming, one drawn from its title. */
export const Row: Story = {};

/** One show, in full. */
export const One: Story = { args: { shows: [lowtide] } };

/** A film: no episodes, said as a film. */
export const Film: Story = {
  args: {
    shows: [
      {
        ...nightFerry,
        kind: 'movie',
        network: undefined,
        status: undefined,
        summary: 'A ferry crossing, a missing passenger, and eleven hours until landfall.',
      },
    ],
  },
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
      ask="What’s on like Lowtide?"
      card={<ShowCards {...args} />}
      reply="Lowtide’s next episode lands on Sunday. The Night Ferry is the closest in tone, and it’s finished, so you can watch it all."
    />
  ),
};
