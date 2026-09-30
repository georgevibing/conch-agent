import type { Meta, StoryObj } from '@storybook/react-vite';

import { RestartScreen } from './RestartScreen';

const meta = {
  title: 'Patterns/Restart/RestartScreen',
  component: RestartScreen,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'While Conch starts itself again after an update or a restore: the pearl breathes, one reassuring line, and the page comes back by itself. There is nothing to press.',
      },
    },
  },
  args: {
    title: 'Updating Conch',
    detail: 'This takes a few seconds. Your chats are safe.',
  },
} satisfies Meta<typeof RestartScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Updating: Story = {};
export const Restarting: Story = { args: { title: 'Restarting Conch' } };
export const TakingLong: Story = {
  args: {
    title: 'Restarting Conch',
    slow: 'This is taking longer than usual. If it doesn’t come back, run pnpm start in Conch’s folder.',
  },
};
