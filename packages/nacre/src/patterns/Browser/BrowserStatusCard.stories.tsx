import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { BrowserStatusCard } from './BrowserStatusCard';

const meta = {
  title: 'Patterns/Browser/BrowserStatusCard',
  component: BrowserStatusCard,
  args: {
    phase: 'running',
    browserName: 'Microsoft Edge',
    version: '154.0.4258.37',
    onRepair: fn(),
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The browser’s health at a glance, for Settings. It says what runs and why. Healthy, it says nothing about repairing: Repair everything in Settings → Health looks after the browser with every other part, and lists what Conch fixed on its own. Only a real problem brings one line and one Repair button, which tries every fix in turn; only what Conch can’t do itself (a system library on Linux) is handed to you, as a single command.',
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
export const Ready: Story = { args: { phase: 'off' } };
export const Installing: Story = {
  args: {
    phase: 'installing',
    install: { percent: 64, label: 'Downloading Chromium · 64% of 170.3 MiB' },
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
/** A problem Conch can fix: one line, one button. */
export const Broken: Story = {
  args: { phase: 'problem', problem: { message: 'The browser stopped and won’t start again.' } },
};
export const Repairing: Story = {
  args: { phase: 'repairing', problem: { message: 'The browser stopped and won’t start again.' } },
};
export const TurnedOff: Story = { args: { disabled: true } };
