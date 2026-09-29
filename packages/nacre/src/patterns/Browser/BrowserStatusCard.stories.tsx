import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { BrowserStatusCard } from './BrowserStatusCard';

const minutes = (n: number) => Date.now() - n * 60_000;

const meta = {
  title: 'Patterns/Browser/BrowserStatusCard',
  component: BrowserStatusCard,
  args: {
    phase: 'running',
    browserName: 'Microsoft Edge',
    version: '154.0.4258.37',
    onRepair: fn(),
    healed: [
      { at: minutes(3), message: 'A page crashed, so Conch reloaded it.' },
      {
        at: minutes(52),
        message:
          'A browser left over from an earlier session was holding things up; Conch closed it.',
      },
    ],
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The browser’s health at a glance, for Settings. It says what runs and why, and lists what Conch already fixed on its own, as reassurance rather than alarm. One Repair button tries every fix; only what Conch can’t do itself (a system library on Linux) is handed to you, as a single command.',
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
} satisfies Meta<typeof BrowserStatusCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};
export const Ready: Story = { args: { phase: 'off', healed: [] } };
export const Installing: Story = {
  args: {
    phase: 'installing',
    install: { percent: 64, label: 'Downloading Chromium · 64% of 170.3 MiB' },
    healed: [],
  },
};
export const NeedsAHand: Story = {
  args: {
    phase: 'problem',
    problem: {
      message: 'The browser needs a few system libraries that aren’t installed.',
      command: 'sudo npx playwright install-deps chromium',
    },
  },
};
export const TurnedOff: Story = { args: { disabled: true } };
