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

/**
 * Narrow (a phone, a dialog, a side panel), the action takes a row of its own
 * under the text, so the text keeps the callout's width. It's the callout's
 * own width that decides, not the screen's: a container query.
 */
export const NarrowWithAction: Story = {
  decorators: [(Story) => <div style={{ maxInlineSize: 340 }}>{Story()}</div>],
  render: () => (
    <Stack gap={3}>
      <Callout
        tone="info"
        title="Use the same app password?"
        action={<Button size="sm">Use it for Gmail</Button>}
      >
        Your email channel already signs in as kaltsikis.software@gmail.com.
      </Callout>
      <Callout
        tone="warning"
        title="Claude wants to run `pnpm install`"
        action={
          <>
            <Button size="sm" variant="ghost">
              Deny
            </Button>
            <Button size="sm" variant="surface">
              Allow once
            </Button>
          </>
        }
      >
        This command modifies node_modules and the lockfile.
      </Callout>
      <Callout
        tone="neutral"
        icon={false}
        action={
          <Button size="sm" variant="surface">
            Turn on
          </Button>
        }
      >
        Keep Conch running when you close the window.
      </Callout>
    </Stack>
  ),
};

export const Live: Story = {
  args: {
    tone: 'danger',
    live: 'assertive',
    title: 'Connection lost',
    children: 'Trying to reconnect…',
  },
};
