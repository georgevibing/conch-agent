import { checkPassword } from '@conch/protocol';
import { BackupOptions, Button, Callout, Dialog, formatBytes, Stack, toast } from '@conch/nacre';
import { Download } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { ApiError } from '../../api/client';
import { backupApi, downloadBackup } from './backups';

/**
 * Back up now: one file to download. Chats go in unless you say otherwise;
 * keys and sign-ins only ever locked with a passphrase you type twice, and
 * only after a recent sign-in (`guard`).
 */
export function BackUpDialog({
  open,
  onOpenChange,
  chats,
  guard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the chats take now, for “Include chats”. */
  chats?: { count: number; bytes: number };
  guard: (task: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [withChats, setWithChats] = useState(true);
  const [secrets, setSecrets] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const check = checkPassword(passphrase);
  const ready = !secrets || (check.ok && confirm === passphrase);

  const reset = () => {
    setSecrets(false);
    setPassphrase('');
    setConfirm('');
    setError(undefined);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      let made: Awaited<ReturnType<typeof backupApi.create>> | undefined;
      const done = await guard(async () => {
        made = await backupApi.create({
          chats: withChats,
          ...(secrets && { passphrase }),
        });
      });
      if (!done || !made) return;
      downloadBackup(made.id);
      toast.success('Backup downloaded', {
        description: `${made.name} · ${formatBytes(made.size)}. Keep it somewhere private.`,
      });
      reset();
      onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const chatsDetail = chats
    ? chats.count === 0
      ? 'No chats yet.'
      : `${new Intl.NumberFormat().format(chats.count)} ${chats.count === 1 ? 'chat' : 'chats'} and the files sent in them · ${formatBytes(chats.bytes)}`
    : undefined;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Content size="sm">
        <form onSubmit={(e) => void submit(e)}>
          <Dialog.Header>
            <Dialog.Title>Back up your Conch</Dialog.Title>
            <Dialog.Description>
              One file with your settings, memories, routines, skills and integrations
              {withChats ? ', and your chats' : ''}. Keep it somewhere private.
            </Dialog.Description>
          </Dialog.Header>
          <Dialog.Body>
            <Stack gap={4}>
              <BackupOptions
                chats={withChats}
                onChatsChange={setWithChats}
                chatsDetail={chatsDetail}
                secrets={secrets}
                onSecretsChange={setSecrets}
                passphrase={passphrase}
                onPassphraseChange={setPassphrase}
                confirm={confirm}
                onConfirmChange={setConfirm}
                strength={{
                  ...check,
                  // The checks are the password ones; here it's a passphrase.
                  message: check.message.replace(/\bpassword\b/g, 'passphrase'),
                }}
              />
              {error && (
                <Callout tone="danger" live="assertive">
                  {error}
                </Callout>
              )}
            </Stack>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.Close>
            <Button type="submit" leadingIcon={<Download />} loading={busy} disabled={!ready}>
              {busy ? 'Backing up…' : 'Download backup'}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
