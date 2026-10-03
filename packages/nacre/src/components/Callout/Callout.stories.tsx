import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../Button';
import { Stack } from '../Stack';
import { Callout } from './Callout';

const meta = {
  title: 'Components/Feedback/Callout',
  component: Callout,
  args: {
    tone: 'info',
    title: 'Claude Code 2.4 is available',
    children: 'Restart the host to pick up faster tool execution and improved diffs.',
  },
  argTypes: {
    tone: {
      control: 'inline-radio',
      options: ['accent', 'neutral', 'info', 'success', 'warning', 'danger'],
    },
  },
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxInlineSize: 560 }}>{Story()}</div>],
} satisfies Meta<typeof Callout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Tones: Story = {
  render: () => (
    <Stack gap={3}>
      <Callout tone="accent" title="Plan mode">
        Claude will propose changes before editing any files.
      </Callout>
      <Callout tone="info" title="Connected to studio-mac">
        Sessions run with your local credentials and working directory.
      </Callout>
      <Callout tone="success" title="All tests passed">
        128 tests across 14 files in 3.2s.
      </Callout>
      <Callout tone="warning" title="Context window 86% full">
        Older turns will be summarised soon.
      </Callout>
      <Callout tone="danger" title="Host unreachable">
        The gateway stopped responding 20 seconds ago.
      </Callout>
      <Callout tone="neutral">Tip: press ⌘K to jump between sessions.</Callout>
    </Stack>
  ),
};

export const WithAction: Story = {
  args: {
    tone: 'warning',
    title: 'Claude wants to run `pnpm install`',
    children: 'This command modifies node_modules and the lockfile.',
    action: (
      <>
        <Button size="sm" variant="ghost">
          Deny
        </Button>
        <Button size="sm" variant="surface">
          Allow once
        </Button>
      </>
    ),
  },
};

export const Live: Story = {
  args: {
    tone: 'danger',
    live: 'assertive',
    title: 'Connection lost',
    children: 'Trying to reconnect…',
  },
};
