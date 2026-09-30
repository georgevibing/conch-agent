import type { Meta, StoryObj } from '@storybook/react-vite';
import { Download, Upload } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Dialog } from '../../components/Dialog';
import { Progress } from '../../components/Progress';
import { Stack } from '../../components/Stack';
import { BackupList } from './BackupList';
import { BackupOptions } from './BackupOptions';
import { BackupOverview } from './BackupOverview';
import { RestorePreview } from './RestorePreview';
import { backups, daily, everything, onePower, powers } from './fixtures';

const meta = {
  title: 'Patterns/Backups/Dialogs',
  component: RestorePreview,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Backing up and restoring, as Settings → Health shows them. **Back up now** is a small dialog: chats in or out, and keys and sign-ins only ever locked with a passphrase. **Restore** always previews first, in plain words, with one clear button; what’s there now is kept, so it can be undone.',
      },
    },
  },
  args: { contents: everything },
} satisfies Meta<typeof RestorePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

function Shell({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <>
      {/* What the dialog opens over: Settings → Health → Backups. */}
      <div style={{ padding: 24, maxInlineSize: 640 }}>
        <BackupOverview automatic detail="Last backup today at 3:12 AM · 5 kept · 225 MB" />
      </div>
      <Dialog.Root open>
        <Dialog.Content size="sm">
          <Dialog.Header>
            <Dialog.Title>{title}</Dialog.Title>
            {description && <Dialog.Description>{description}</Dialog.Description>}
          </Dialog.Header>
          <Dialog.Body>{children}</Dialog.Body>
          <Dialog.Footer>
            <Button variant="ghost">Cancel</Button>
            {action}
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}

/** A file you chose, with keys locked in it: the passphrase opens them. */
export const Restore: Story = {
  render: (args) => {
    const [passphrase, setPassphrase] = useState('');
    const [skip, setSkip] = useState(false);
    return (
      <Shell
        title="Restore this backup?"
        description="From Tuesday 30 Sept, 14:02"
        action={<Button disabled={!skip && !passphrase}>Restore</Button>}
      >
        <RestorePreview
          {...args}
          passphrase={passphrase}
          onPassphraseChange={setPassphrase}
          skipSecrets={skip}
          onSkipSecretsChange={setSkip}
        />
      </Shell>
    );
  },
};

/**
 * A file from somewhere else that can act for you: said plainly, before the
 * button, in one calm list. Restore it only if you set these up yourself.
 */
export const RestoreThatActsForYou: Story = {
  render: () => (
    <Shell
      title="Restore this backup?"
      description="From Tuesday 1 Sept, 10:00"
      action={<Button>Restore</Button>}
    >
      <RestorePreview contents={daily} powers={powers} morePowers={3} />
    </Shell>
  ),
};

/**
 * Your own backup on a Conch that has sign-in set up: its other keys and
 * sign-ins come back, and the password and keys you use now stay.
 */
export const RestoreKeepsSignIn: Story = {
  render: () => {
    const [passphrase, setPassphrase] = useState('');
    return (
      <Shell
        title="Restore this backup?"
        description="From Tuesday 30 Sept, 14:02"
        action={<Button disabled={!passphrase}>Restore</Button>}
      >
        <RestorePreview
          contents={everything}
          powers={onePower}
          signInStays
          passphrase={passphrase}
          onPassphraseChange={setPassphrase}
        />
      </Shell>
    );
  },
};

export const WrongPassphrase: Story = {
  render: (args) => (
    <Shell
      title="Restore this backup?"
      description="From Tuesday 30 Sept, 14:02"
      action={<Button>Restore</Button>}
    >
      <RestorePreview
        {...args}
        passphrase="seven lemons"
        passphraseError="That passphrase doesn’t open this backup."
      />
    </Shell>
  ),
};

/** A daily backup: no passphrase to ask for. */
export const RestoreDaily: Story = {
  render: () => (
    <Shell
      title="Restore this backup?"
      description="From today at 3:12 AM"
      action={<Button>Restore</Button>}
    >
      <RestorePreview contents={daily} />
    </Shell>
  ),
};

export const Undo: Story = {
  render: () => (
    <Shell
      title="Undo the restore?"
      description="Your Conch goes back to how it was on Tuesday 30 Sept, 14:02, just before the restore."
      action={<Button>Undo restore</Button>}
    >
      <RestorePreview
        contents={{ ...everything, secrets: 'local' }}
        note="What’s in your Conch now is kept too, so you can change your mind."
      />
    </Shell>
  ),
};

export const CheckingAFile: Story = {
  render: () => (
    <Shell title="Restore from a file" action={<Button disabled>Restore</Button>}>
      <Progress value={64} label="Checking Conch backup 2026-09-30.conchbackup…" showValue />
    </Shell>
  ),
};

/** Reading a backup through before the preview (every file, no passphrase needed). */
export const CheckingABackup: Story = {
  render: () => (
    <Shell
      title="Restore this backup?"
      description="From today at 3:12 AM"
      action={<Button disabled>Restore</Button>}
    >
      <Progress label="Checking what’s in it…" />
    </Shell>
  ),
};

/** No room for the file: it says so, in its own words. */
export const NoRoom: Story = {
  render: () => (
    <Shell
      title="Restore from a file"
      action={
        <Button variant="surface" leadingIcon={<Upload />}>
          Choose another file
        </Button>
      }
    >
      <Callout
        tone="danger"
        title="There isn’t enough free space on this computer to restore that backup. Free up some space, then try again."
      />
    </Shell>
  ),
};

export const NotABackup: Story = {
  render: () => (
    <Shell
      title="Restore from a file"
      action={
        <Button variant="surface" leadingIcon={<Upload />}>
          Choose another file
        </Button>
      }
    >
      <Callout tone="danger" title="That file isn’t a Conch backup.">
        Choose a file that ends in .conchbackup.
      </Callout>
    </Shell>
  ),
};

/** Where a person restarts Conch by hand (it isn't running under `pnpm start`). */
export const RestartToFinish: Story = {
  render: () => (
    <Shell title="Almost done" action={<Button>Done</Button>}>
      <Callout tone="info" title="Restart Conch to finish">
        Your backup is ready to restore. Stop Conch (Ctrl+C) and run pnpm start again.
      </Callout>
    </Shell>
  ),
};

const strengthOf = (value: string) =>
  value.length < 15
    ? {
        score: 0 as const,
        label: 'Too short',
        message: 'Use at least 15 characters — a short sentence works well.',
      }
    : value.length < 24
      ? { score: 3 as const, label: 'Good', message: 'Good password.' }
      : { score: 4 as const, label: 'Strong', message: 'Strong password.' };

function BackUpNow({
  secrets: initial = false,
  typed = '',
}: {
  secrets?: boolean;
  typed?: string;
}) {
  const [chats, setChats] = useState(true);
  const [secrets, setSecrets] = useState(initial);
  const [passphrase, setPassphrase] = useState(typed);
  const [confirm, setConfirm] = useState(typed);
  const ready = !secrets || (passphrase.length >= 15 && confirm === passphrase);
  return (
    <Shell
      title="Back up your Conch"
      description="One file with your settings, memories, routines, skills and integrations. Keep it somewhere private."
      action={
        <Button leadingIcon={<Download />} disabled={!ready}>
          Download backup
        </Button>
      }
    >
      <BackupOptions
        chats={chats}
        onChatsChange={setChats}
        chatsDetail="240 chats and the files sent in them · 48 MB"
        secrets={secrets}
        onSecretsChange={setSecrets}
        passphrase={passphrase}
        onPassphraseChange={setPassphrase}
        confirm={confirm}
        onConfirmChange={setConfirm}
        strength={strengthOf(passphrase)}
      />
    </Shell>
  );
}

export const BackUp: Story = { render: () => <BackUpNow /> };

export const BackUpWithKeys: Story = {
  render: () => <BackUpNow secrets typed="seven lemons sail past the harbour" />,
};

/** Settings → Health → Backups, put together. */
export const Section: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div style={{ maxInlineSize: 640 }}>
      <Stack gap={4}>
        <Callout
          tone="success"
          title="Restored from Tuesday 30 Sept, 14:02"
          action={
            <Button size="sm" variant="surface">
              Undo restore
            </Button>
          }
        >
          What was here before is kept, so you can undo this.
        </Callout>
        <BackupOverview
          automatic
          onAutomaticChange={() => undefined}
          detail="Last backup today at 3:12 AM · 5 kept · 225 MB"
        >
          <Button size="sm" leadingIcon={<Download />}>
            Back up now
          </Button>
          <Button size="sm" variant="surface" leadingIcon={<Upload />}>
            Restore from a file…
          </Button>
        </BackupOverview>
        <BackupList backups={backups} onRestore={() => undefined} onDownload={() => undefined} />
      </Stack>
    </div>
  ),
};
