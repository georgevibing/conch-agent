import type { Meta, StoryObj } from '@storybook/react-vite';
import { LogOut, ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../Button';
import { AlertDialog } from './AlertDialog';

const meta = {
  title: 'Components/Overlays/AlertDialog',
  parameters: {
    docs: {
      description: {
        component:
          'Confirmation for consequential actions. Focus starts on Cancel, the veil does not dismiss, and the action can stay open while async work completes.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function DeleteSession({ defaultOpen }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [deleting, setDeleting] = useState(false);
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !deleting && setOpen(next)}>
      <AlertDialog.Trigger asChild>
        <Button variant="soft" tone="danger" leadingIcon={<Trash2 />}>
          Delete session
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Content icon={<Trash2 />}>
        <AlertDialog.Header>
          <AlertDialog.Title>Delete “Refactor auth flow”?</AlertDialog.Title>
          <AlertDialog.Description>
            The transcript and its 14 tool results will be removed from this machine. Files Claude
            changed on disk are not affected.
          </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
          <AlertDialog.Cancel disabled={deleting} />
          <AlertDialog.Action
            loading={deleting}
            onClick={(event) => {
              event.preventDefault();
              setDeleting(true);
              setTimeout(() => {
                setDeleting(false);
                setOpen(false);
              }, 1400);
            }}
          >
            {deleting ? 'Deleting…' : 'Delete session'}
          </AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

export const DestructiveAsync: Story = {
  render: () => <DeleteSession />,
};

export const Open: Story = {
  tags: ['!autodocs'],
  render: () => <DeleteSession defaultOpen />,
};

export const Tones: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12 }}>
      <AlertDialog.Root>
        <AlertDialog.Trigger asChild>
          <Button variant="surface" leadingIcon={<ShieldAlert />}>
            Allow tool
          </Button>
        </AlertDialog.Trigger>
        <AlertDialog.Content tone="accent" icon={<ShieldAlert />}>
          <AlertDialog.Header>
            <AlertDialog.Title>Allow Claude to run shell commands?</AlertDialog.Title>
            <AlertDialog.Description>
              Claude will be able to run <code>npm test</code> without asking again in this session.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Not now</AlertDialog.Cancel>
            <AlertDialog.Action tone="accent">Allow for session</AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
      <AlertDialog.Root>
        <AlertDialog.Trigger asChild>
          <Button variant="surface" leadingIcon={<LogOut />}>
            Disconnect
          </Button>
        </AlertDialog.Trigger>
        <AlertDialog.Content tone="neutral" icon={<LogOut />}>
          <AlertDialog.Header>
            <AlertDialog.Title>Disconnect from host?</AlertDialog.Title>
            <AlertDialog.Description>
              Running sessions keep going; you can reconnect at any time.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel />
            <AlertDialog.Action tone="neutral">Disconnect</AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  ),
};
