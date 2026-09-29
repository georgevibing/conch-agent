import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { CopyButton } from './CopyButton';

const meta = {
  title: 'Patterns/Chat/CopyButton',
  component: CopyButton,
  args: { value: 'pnpm dev', label: 'Copy command', onCopied: fn() },
  parameters: {
    docs: {
      description: {
        component:
          'Copies text and confirms with a springy check that crossfades in from a blur. The confirmation is announced to screen readers.',
      },
    },
  },
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
export const Surface: Story = { args: { variant: 'surface', size: 'md' } };
