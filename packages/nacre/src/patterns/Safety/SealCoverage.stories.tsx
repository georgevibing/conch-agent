import type { Meta, StoryObj } from '@storybook/react-vite';

import { SealCoverage } from './SealCoverage';

const meta = {
  title: 'Patterns/Safety/SealCoverage',
  component: SealCoverage,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'What “Seal commands” means for each provider you use, honestly: one that isn’t sealed says so, and one only partly sealed says what’s still in reach.',
      },
    },
  },
  args: {
    providers: [
      {
        id: 'claude-code',
        label: 'Claude Code',
        state: 'sealed',
        note: 'Commands run sealed: your work folder and caches only, never where keys live.',
      },
      {
        id: 'codex-cli',
        label: 'Codex',
        state: 'partly',
        note: 'Codex keeps to your work folder, but version 0.120.0 can still read where keys live. Codex 0.159.0 or newer can’t.',
      },
      {
        id: 'anthropic-api',
        label: 'Anthropic API',
        state: 'no-commands',
        note: 'Runs no commands on this computer: it uses Conch’s tools, which ask as usual.',
      },
    ],
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 560 }}>{Story()}</div>],
} satisfies Meta<typeof SealCoverage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mixed: Story = {};
export const Windows: Story = {
  args: {
    providers: [
      {
        id: 'claude-code',
        label: 'Claude Code',
        state: 'not-sealed',
        note: 'This computer can’t seal its commands yet.',
      },
    ],
  },
};
