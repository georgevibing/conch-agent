import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bot, Globe, MessageSquare, Puzzle, Search, TerminalSquare } from 'lucide-react';

import { HealedLog } from './HealedLog';

const now = Date.now();

const meta = {
  title: 'Patterns/Healed/HealedLog',
  component: HealedLog,
  parameters: {
    docs: {
      description: {
        component:
          'Settings → Health → Fixed on its own (AGENTS.md agreement 11). One line says how much Conch fixed this week; below it a short timeline, each repair a few words with a mark for its kind. The same repair again is one line with a count, and the rest wait behind Show all. Reassurance, never a warning.',
      },
    },
  },
  args: { notes: [] },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: '40rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HealedLog>;

export default meta;
type Story = StoryObj<typeof meta>;

const min = 60_000;

/**
 * Settings → Health → Fixed on its own: how much Conch fixed this week in one
 * line, then a short timeline with a mark per kind. The same repair again is
 * one line with a count; the rest wait behind Show all.
 */
export const Playground: Story = {
  args: {
    notes: [
      { at: now - 2 * min, message: 'Stopped a stuck command', icon: <TerminalSquare /> },
      { at: now - 40 * min, message: 'Stopped a stuck command', icon: <TerminalSquare /> },
      { at: now - 90 * min, message: 'Picked up a chat after a restart', icon: <MessageSquare /> },
      { at: now - 3 * 60 * min, message: 'Stopped a stuck command', icon: <TerminalSquare /> },
      { at: now - 5 * 60 * min, message: 'Notion is working again', icon: <Puzzle /> },
      { at: now - 26 * 60 * min, message: 'Restarted the browser', icon: <Globe /> },
      { at: now - 50 * 60 * min, message: 'Rebuilt memory search', icon: <Search /> },
      { at: now - 70 * 60 * min, message: 'Started Ollama', icon: <Bot /> },
    ],
  },
};

export const OnAPhone: Story = {
  ...Playground,
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: '370px' }}>
        <Story />
      </div>
    ),
  ],
};

export const Empty: Story = {
  args: { notes: [] },
};
