import type { Meta, StoryObj } from '@storybook/react-vite';

import { ChatMessages } from './ChatMessages';
import { AppTool, InChat, messages, ViewSurface } from './fixtures';

const now = Date.now();

const meta = {
  title: 'Patterns/Chat/ChatMessages',
  component: ChatMessages,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Messages a tool read from a chat app, under its tool row (ADR 0055): the place, then each message with who said it, when, and what, oldest first, the way the app shows them. One person’s messages close together read as one. A long message folds to four lines with More; line breaks are kept and nothing is read as markup. The newest six show, with **Show all** for the rest.',
      },
    },
  },
  args: { messages: messages(now), place: '#design', now },
  decorators: [
    (Story) => (
      <ViewSurface>
        <Story />
      </ViewSurface>
    ),
  ],
} satisfies Meta<typeof ChatMessages>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** A search across channels has no one place. */
export const NoPlace: Story = { args: { place: undefined } };

/** A busy channel shows the newest six. */
export const Many: Story = {
  args: {
    messages: Array.from({ length: 15 }, (_, i) => ({
      author: ['Sam Rivera', 'Ada Lovelace', 'Grace Hopper'][i % 3] ?? '',
      text: `Message ${i + 1} about the launch.`,
      at: new Date(now - (15 - i) * 20 * 60_000).toISOString(),
    })),
  },
};

/** Markup stays text: nothing here is drawn as HTML. */
export const PlainText: Story = {
  args: {
    messages: [
      {
        author: 'Eve Mallory',
        text: '<img src=x onerror=alert(1)> **not bold** [a link](https://example.org)\n  indented line',
        at: new Date(now - 60_000).toISOString(),
      },
    ],
  },
};

/** Nothing said. */
export const Empty: Story = { args: { messages: [] } };

/** As it sits in a chat. */
export const InAConversation: Story = {
  decorators: [(Story) => <Story />],
  render: () => (
    <InChat
      ask="What did #design say about onboarding?"
      answer="Sam shared new onboarding screens. Ada and Grace both want the step 2 button to say “Save and continue”, and Grace offered to pair on the empty state tomorrow at 10."
    >
      <AppTool brand="slack" app="Slack" title="Catch up on a channel" summary="#design">
        <ChatMessages messages={messages(now)} place="#design" now={now} />
      </AppTool>
    </InChat>
  ),
};
