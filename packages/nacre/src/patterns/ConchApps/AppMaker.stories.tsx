import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Dialog } from '../../components/Dialog';
import { Tabs } from '../../components/Tabs';
import { AppMaker } from './AppMaker';

const meta = {
  title: 'Patterns/Conch apps/Maker',
  component: AppMaker,
  args: { onBuild: fn() },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          '**Describe it**, the first tab of **Add your own** (ADR 0061). One big, friendly box — “What should it do?” — whose hint takes turns through things people really want, a few chips that fill it, and **Build it** (⌘/Ctrl+Enter). Conch builds the app in a chat, shows it, and adds it only when the person says so. With reduced motion the hint stays put.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 560 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AppMaker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

/** A chip pressed, or words typed: Build it wakes up. */
export const Written: Story = { args: { defaultValue: 'Remember when I water my plants' } };

/** The chat is being started. */
export const Busy: Story = {
  args: { defaultValue: 'Track what I spend on coffee', busy: true },
};

/** Where it lives: the first tab of Add your own. */
export const InAddYourOwn: Story = {
  render: (args) => (
    <Dialog.Root open>
      <Dialog.Content size="md">
        <Dialog.Header>
          <Dialog.Title>Add your own</Dialog.Title>
          <Dialog.Description>
            Make an app with Conch, or add one someone shared.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <Tabs defaultValue="describe">
            <Tabs.List aria-label="Ways to add an app">
              <Tabs.Trigger value="describe">Describe it</Tabs.Trigger>
              <Tabs.Trigger value="link">From a link</Tabs.Trigger>
              <Tabs.Trigger value="server">A server</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="describe">
              <AppMaker {...args} />
            </Tabs.Content>
          </Tabs>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  ),
  // The dialog is in a portal: this holds the story's room.
  decorators: [(Story) => <div style={{ minBlockSize: 640 }}>{Story()}</div>],
};
