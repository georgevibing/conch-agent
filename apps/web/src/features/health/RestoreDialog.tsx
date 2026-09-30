import type { BackupSummary } from '@conch/protocol';
import {
  Button,
  Callout,
  Dialog,
  formatBackupDate,
  Progress,
  RestorePreview,
  Stack,
} from '@conch/nacre';
import { Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { useUi } from '../../app/ui';
import { backupApi, uploadBackup } from './backups';
import { bootId } from './restart';

/**
 * What to restore: a file just chosen, or a backup already on this computer.
 * `id` tells one choice from the next (the same file can be chosen twice).
 */
export type RestoreSource = { id: string } & ({ file: File } | { backup: BackupSummary });

/** Set just before Conch restarts to restore, so the page can say how it went once it's back. */
export const RESTORING_KEY = 'conch.restoring';

/** Remember that a restore is finishing, for `RestoredNotice` once the page is back. */
export function markRestoring(): void {
  try {
    sessionStorage.setItem(RESTORING_KEY, JSON.stringify({ at: Date.now() }));
  } catch {
    // Only a nicety: Settings says it's restored either way.
  }
}

type Step =
  | { kind: 'checking'; name: string; progress: number }
  | { kind: 'failed'; message: string }
  | { kind: 'preview'; backup: BackupSummary }
  | { kind: 'restart'; message: string };

type Guard = (task: () => Promise<unknown>) => Promise<boolean>;

/**
 * Restore, in one dialog with one clear button: a file is checked first
 * (with progress), then what comes back is shown in plain words, with the
 * passphrase when the backup's keys are locked. Restoring needs a recent
 * sign-in (`guard`); then Conch starts again and the page waits for it.
 */
export function RestoreDialog({
  source,
  onClose,
  onPickAnother,
  guard,
}: {
  source: RestoreSource | undefined;
  onClose: () => void;
  onPickAnother: () => void;
  guard: Guard;
}) {
  return (
    <Dialog.Root open={Boolean(source)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content size="sm">
        {source && (
          <RestoreFlow
            key={source.id}
            source={source}
            onClose={onClose}
            onPickAnother={onPickAnother}
            guard={guard}
          />
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

function RestoreFlow({
  source,
  onClose,
  onPickAnother,
  guard,
}: {
  source: RestoreSource;
  onClose: () => void;
  onPickAnother: () => void;
  guard: Guard;
}) {
  const [step, setStep] = useState<Step>(() =>
    'backup' in source
      ? { kind: 'preview', backup: source.backup }
      : { kind: 'checking', name: source.file.name, progress: 0 },
  );
  const [passphrase, setPassphrase] = useState('');
  const [skipSecrets, setSkipSecrets] = useState(false);
  const [passphraseError, setPassphraseError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const uploaded = useRef<string>(undefined);
  const restored = useRef(false);
  const setRestarting = useUi((s) => s.setRestarting);

  useEffect(() => {
    if (!('file' in source)) return;
    const controller = new AbortController();
    uploadBackup(source.file, {
      signal: controller.signal,
      onProgress: (progress) => setStep((s) => (s.kind === 'checking' ? { ...s, progress } : s)),
    }).then(
      (backup) => {
        uploaded.current = backup.id;
        setStep({ kind: 'preview', backup });
      },
      (failure: unknown) => {
        if (controller.signal.aborted) return;
        setStep({
          kind: 'failed',
          message: failure instanceof ApiError ? failure.message : 'Couldn’t read that file.',
        });
      },
    );
    return () => {
      controller.abort();
      // An upload that wasn't restored from isn't kept.
      if (uploaded.current && !restored.current)
        void backupApi.discard(uploaded.current).catch(() => undefined);
    };
  }, [source]);

  const backup = step.kind === 'preview' ? step.backup : undefined;
  const locked = backup?.contents.secrets === 'passphrase';
  const undo = backup?.kind === 'before-restore';
  const when = backup ? formatBackupDate(backup.createdAt) : '';

  const restore = async (target: BackupSummary) => {
    setBusy(true);
    setError(undefined);
    setPassphraseError(undefined);
    try {
      const from = await bootId();
      let result: Awaited<ReturnType<typeof backupApi.restore>> | undefined;
      const done = await guard(async () => {
        result = await backupApi.restore(target.id, {
          ...(locked && !skipSecrets && { passphrase }),
          skipSecrets,
        });
      });
      if (!done || !result) return;
      restored.current = true;
      if (result.restarting) {
        markRestoring();
        setRestarting({ title: 'Restoring your Conch…', from });
        onClose();
      } else {
        setStep({ kind: 'restart', message: result.message ?? 'Restart Conch to finish.' });
      }
    } catch (failure) {
      if (failure instanceof ApiError && /passphrase/.test(failure.code))
        setPassphraseError(failure.message);
      else setError(failure instanceof ApiError ? failure.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (backup) void restore(backup);
      }}
    >
      <Dialog.Header>
        <Dialog.Title>
          {step.kind === 'restart'
            ? 'Almost done'
            : !backup
              ? 'Restore from a file'
              : undo
                ? 'Undo the restore?'
                : 'Restore this backup?'}
        </Dialog.Title>
        {backup && (
          <Dialog.Description>
            {undo
              ? `Your Conch goes back to how it was on ${when}, just before the restore.`
              : `From ${when}`}
          </Dialog.Description>
        )}
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap={4}>
          {step.kind === 'checking' && (
            <Progress
              value={Math.round(step.progress * 100)}
              label={`Checking ${step.name}…`}
              showValue
            />
          )}
          {step.kind === 'failed' && (
            <Callout tone="danger" title={step.message} live="assertive">
              Choose a Conch backup: a file that ends in .conchbackup.
            </Callout>
          )}
          {step.kind === 'restart' && (
            <Callout tone="info" title="Restart Conch to finish">
              {step.message}
            </Callout>
          )}
          {backup && (
            <RestorePreview
              contents={backup.contents}
              passphrase={passphrase}
              onPassphraseChange={(value) => {
                setPassphrase(value);
                setPassphraseError(undefined);
              }}
              skipSecrets={skipSecrets}
              onSkipSecretsChange={setSkipSecrets}
              passphraseError={passphraseError}
              note={
                undo
                  ? 'What’s in your Conch now is kept too, so you can change your mind.'
                  : undefined
              }
            />
          )}
          {error && (
            <Callout tone="danger" live="assertive">
              {error}
            </Callout>
          )}
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        {step.kind === 'restart' ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Dialog.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.Close>
            {step.kind === 'failed' ? (
              <Button variant="surface" leadingIcon={<Upload />} onClick={onPickAnother}>
                Choose another file
              </Button>
            ) : (
              <Button
                type="submit"
                loading={busy}
                disabled={!backup || (locked && !skipSecrets && !passphrase)}
              >
                {undo ? 'Undo restore' : 'Restore'}
              </Button>
            )}
          </>
        )}
      </Dialog.Footer>
    </form>
  );
}
