import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { MakeWithConch } from './MakeWithConch';

const meta = {
  title: 'Patterns/Settings/Make with Conch',
  component: MakeWithConch,
  args: {
    question: 'Which provider?',
    placeholder: 'Fireworks, Baseten, a model at work…',
    examples: ['Fireworks AI', 'Baseten', 'Together AI', 'Perplexity'],
    note: 'Conch reads its docs, makes it, and tests it with your key. Nothing is added until you press Add.',
    onMake: fn(),
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          '**Make one with Conch** (ADR 0122): a provider or a chat app from its name alone. Conch reads its own documentation in a chat, writes it, tests it, and offers it as a card. One line, a few names to tap, one button.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 640 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MakeWithConch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** In Settings → Providers. */
export const Provider: Story = {};

/** In Apps → Talk to me here. */
export const ChatApp: Story = {
  args: {
    question: 'Which chat app?',
    placeholder: 'Zulip, Threema, Revolt…',
    examples: ['Zulip', 'Threema', 'Revolt', 'Nextcloud Talk'],
    note: 'Conch reads its bot docs and makes it; you paste the bot’s token and say hello.',
    action: 'Connect it with Conch',
  },
};

export const Busy: Story = { args: { busy: true } };
