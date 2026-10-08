import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { ComputerUseLive } from './ComputerUse';
import { notesScreen } from './fixtures';

const meta = {
  title: 'Patterns/Computer/UsingYourApps',
  component: ComputerUseLive,
  args: {
    label: 'Typing in Notes',
    steps: 4,
    maxSteps: 60,
    shot: notesScreen,
    stopKeys: '⌘⎋',
    onStop: fn(),
  },
  parameters: {
    docs: {
      description: {
        component:
          'The assistant using the apps on your computer (ADR 0110). In the chat: the latest look at the screen inside the same slowly turning pearl edge the desktop app draws around the real screen, what it’s doing in a few words, and one big Stop (⌘⎋ from anywhere). In Settings → This computer: the two macOS switches, each one press from its System Settings page, and a moment’s glint when one turns on.',
      },
    },
  },
} satisfies Meta<typeof ComputerUseLive>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = {};

/** Before the first look: the edge turns around an empty screen. */
export const FirstLook: Story = {
  args: { shot: undefined, label: 'Looking at the screen', steps: 1 },
};

/** Stop was pressed: the edge fades and the button waits for the turn to end. */
export const Stopping: Story = { args: { stopping: true } };

/** Conch in a browser only: no ⌘⎋, the chat's Stop is the one. */
export const WithoutTheApp: Story = { args: { stopKeys: undefined, label: 'Clicking in Keynote' } };
