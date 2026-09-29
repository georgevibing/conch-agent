import type { Meta, StoryObj } from '@storybook/react-vite';
import { Keyboard, Sparkles } from 'lucide-react';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from '../Button';
import { Kbd } from '../Kbd';
import { Stack } from '../Stack';
import { Text } from '../Text';
import { Dialog, type DialogSize } from './Dialog';

const meta = {
  title: 'Components/Overlays/Dialog',
  parameters: {
    docs: {
      description: {
        component:
          'Modal dialog built on Radix. The veil drains the page of colour instead of blurring it, so the dialog is the only thing left in full colour. Content surfaces with a spring and carries a resting pearl rim.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Example({ size = 'md', defaultOpen }: { size?: DialogSize; defaultOpen?: boolean }) {
  return (
    <Dialog.Root defaultOpen={defaultOpen}>
      <Dialog.Trigger asChild>
        <Button leadingIcon={<Sparkles />}>New session</Button>
      </Dialog.Trigger>
      <Dialog.Content size={size}>
        <Dialog.Header>
          <Dialog.Title>Start a new session</Dialog.Title>
          <Dialog.Description>
            Claude Code will open in <strong>~/projects/conch</strong> on this machine. Your current
            session keeps running in the background.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
          <Dialog.Close asChild>
            <Button variant="surface">Cancel</Button>
          </Dialog.Close>
          <Dialog.Close asChild>
            <Button>Start session</Button>
          </Dialog.Close>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export const Playground: Story = {
  render: () => <Example />,
};

export const Open: Story = {
  tags: ['!autodocs'],
  render: () => <Example defaultOpen />,
};

export const Sizes: Story = {
  render: () => (
    <Stack direction="row" gap={3}>
      {(['sm', 'md', 'lg', 'xl'] as const).map((size) => (
        <Dialog.Root key={size}>
          <Dialog.Trigger asChild>
            <Button variant="surface">{size.toUpperCase()}</Button>
          </Dialog.Trigger>
          <Dialog.Content size={size}>
            <Dialog.Header>
              <Dialog.Title>Size “{size}”</Dialog.Title>
              <Dialog.Description>Dialogs cap their width to the viewport.</Dialog.Description>
            </Dialog.Header>
            <Dialog.Footer>
              <Dialog.Close asChild>
                <Button>Done</Button>
              </Dialog.Close>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      ))}
    </Stack>
  ),
};

const shortcuts: [string, string][] = [
  ['Open command palette', 'mod+k'],
  ['New session', 'mod+n'],
  ['Send message', 'enter'],
  ['New line', 'shift+enter'],
  ['Stop generating', 'esc'],
  ['Toggle sidebar', 'mod+b'],
  ['Previous session', 'mod+up'],
  ['Next session', 'mod+down'],
];

export const KeyboardShortcuts: Story = {
  render: () => (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button variant="surface" leadingIcon={<Keyboard />}>
          Shortcuts
        </Button>
      </Dialog.Trigger>
      <Dialog.Content size="sm">
        <Dialog.Header>
          <Dialog.Title>Keyboard shortcuts</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Stack as="ul" gap={1}>
            {shortcuts.map(([label, keys]) => (
              <Stack as="li" key={label} direction="row" justify="between" align="center">
                <Text size="sm" tone="muted" as="span">
                  {label}
                </Text>
                <Kbd keys={keys} />
              </Stack>
            ))}
          </Stack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  ),
};

export const FocusManagement: Story = {
  tags: ['!autodocs'],
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'New session' });
    await userEvent.click(trigger);
    const dialog = await within(document.body).findByRole('dialog');
    await expect(dialog).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect(trigger).toHaveFocus();
  },
};
