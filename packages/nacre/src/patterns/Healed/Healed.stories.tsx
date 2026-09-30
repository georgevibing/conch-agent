import type { Meta, StoryObj } from '@storybook/react-vite';

import { HealedNotes } from './HealedNotes';

const now = Date.now();

const meta = {
  title: 'Patterns/Healed/HealedNotes',
  component: HealedNotes,
  parameters: {
    docs: {
      description: {
        component:
          'What Conch repaired by itself (AGENTS.md agreement 11). Reassurance, not an alert: a sparkle, the sentence, and when. It renders nothing when there’s nothing to say.',
      },
    },
  },
  args: {
    notes: [
      { at: now - 40_000, message: 'The search index couldn’t be read, so Conch rebuilt it.' },
      { at: now - 25 * 60_000, message: 'Notion wasn’t answering; it’s working again.' },
      {
        at: now - 5 * 3_600_000,
        message: 'Settings couldn’t be read, so Conch kept a copy and started from the defaults.',
      },
    ],
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: '34rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HealedNotes>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Bare: Story = { args: { bare: true } };
