import type { BackupStatus, BackupSummary, RestoredFrom } from '@conch/protocol';
import {
  BackupList,
  BackupOverview,
  Button,
  Callout,
  describeBackup,
  formatBackupDate,
  formatBytes,
  formatWhen,
  formatWhenInline,
  Stack,
  Text,
  toast,
  type BackupOverviewState,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { useUi } from '../../app/ui';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { Section } from '../settings/Section';
import { backupApi, backupKeys, downloadBackup, useBackups, useRestartable } from './backups';
import { restartConch } from './restart';
import { BackUpDialog } from './BackUpDialog';
import { markRestoring, RestoreDialog, type RestoreSource } from './RestoreDialog';
import styles from './Backups.module.css';

/** “Restored the backup from Sunday 27 Sept, 03:12”. */
function restoredTitle(from: RestoredFrom): string {
  const when = formatBackupDate(from.createdAt);
  return from.kind === 'automatic'
    ? `Restored the backup from ${when}`
    : `Restored a backup from ${when}`;
}

function overview(status: BackupStatus): {
  state: BackupOverviewState;
  detail: string;
} {
  if (status.running)
    return {
      state: 'running',
      detail: status.running === 'restoring' ? 'Getting a restore ready…' : 'Backing up now…',
    };
  if (!status.automatic)
    return {
      state: 'off',
      detail: 'Turn it on to keep a copy of your Conch every day, on this computer.',
    };
  if (status.problem) return { state: 'problem', detail: status.problem };
  const automatic = status.backups.filter((b) => b.kind === 'automatic');
  if (!status.lastAutomaticAt)
    return { state: 'ok', detail: 'The first backup is made soon, while Conch isn’t busy.' };
  const total = automatic.reduce((sum, b) => sum + b.size, 0);
  return {
    state: 'ok',
    detail: `Last backup ${formatWhenInline(status.lastAutomaticAt)} · ${automatic.length} kept · ${formatBytes(total)}`,
  };
}

/**
 * Settings → Health → Backups (ADR 0020): backed up automatically every day,
 * Back up now to a file, and restoring either — always previewed first, and
 * always undoable.
 */
export function BackupSection() {
  const { data: status } = useBackups();
  const { data: restartable } = useRestartable();
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [backingUp, setBackingUp] = useState(false);
  const [restore, setRestore] = useState<RestoreSource>();
  const fileInput = useRef<HTMLInputElement>(null);
  const section = useRef<HTMLElement>(null);
  const kept = useRef<HTMLDivElement>(null);
  // ⌘K and Repair everything open things here by name (`openSettings('health', …)`).
  const focus = useUi((s) => s.settingsFocus);
  const clearFocus = () => useUi.setState({ settingsFocus: undefined });

  const restored = status?.restored;
  const undoCopy = restored?.undoId
    ? status?.backups.find((b) => b.id === restored.undoId)
    : undefined;

  useEffect(() => {
    if (focus !== 'restore' && focus !== 'backups') return;
    useUi.setState({ settingsFocus: undefined });
    section.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (focus === 'restore')
      (
        kept.current?.querySelector<HTMLButtonElement>('button[aria-label^="Restore"]') ??
        section.current?.querySelector<HTMLButtonElement>('[data-restore-file]')
      )?.focus({ preventScroll: true });
  }, [focus]);

  useEffect(() => {
    // Asked to undo a restore that can't be undone any more: nothing to open.
    if (focus === 'undo-restore' && status && !undoCopy)
      useUi.setState({ settingsFocus: undefined });
  }, [focus, status, undoCopy]);

  const backUpOpen = backingUp || focus === 'backup';
  const source: RestoreSource | undefined =
    restore ??
    (focus === 'undo-restore' && undoCopy ? { id: 'undo', backup: undoCopy } : undefined);

  const setAutomatic = async (automatic: boolean) => {
    const previous = status;
    if (previous) client.setQueryData(backupKeys.status, { ...previous, automatic });
    try {
      client.setQueryData(backupKeys.status, await backupApi.setAutomatic(automatic));
    } catch (failure) {
      if (previous) client.setQueryData(backupKeys.status, previous);
      toast.error(failure instanceof ApiError ? failure.message : 'That didn’t save. Try again.');
    }
  };

  // Restarting cuts everyone off, so it asks that it's you if it's been a while.
  const finishPending = async () => {
    try {
      let message: string | undefined;
      const done = await guard(async () => {
        message = await restartConch('Restoring your Conch…');
      });
      if (!done) return;
      if (message) toast(message);
      else markRestoring();
    } catch (failure) {
      toast(
        failure instanceof ApiError
          ? failure.message
          : 'Conch couldn’t restart just now. Try again in a moment.',
      );
    }
  };

  const cancelPending = async () => {
    await backupApi.cancelPending().catch(() => undefined);
    void client.invalidateQueries({ queryKey: backupKeys.status });
  };

  const { state, detail } = status ? overview(status) : { state: 'ok' as const, detail: '' };
  const byId = new Map<string, BackupSummary>(status?.backups.map((b) => [b.id, b]) ?? []);

  return (
    <Section
      ref={section}
      title="Backups"
      description="Your Conch, kept safe every day on this computer. Restore a backup to go back in time, or to move to a new computer."
    >
      <Stack gap={4}>
        {status?.pending && (
          <Callout
            tone="info"
            title="Restart Conch to finish restoring"
            action={
              <Stack direction="row" gap={1}>
                <Button size="sm" variant="ghost" onClick={() => void cancelPending()}>
                  Cancel restore
                </Button>
                {restartable && (
                  <Button size="sm" variant="surface" onClick={() => void finishPending()}>
                    Restart now
                  </Button>
                )}
              </Stack>
            }
          >
            {`Your backup from ${formatBackupDate(status.pending.createdAt)} is ready.`}
            {restartable ? '' : ' Stop Conch (Ctrl+C) and run pnpm start again.'}
          </Callout>
        )}
        {restored &&
          (restored.from.kind === 'before-restore' ? (
            <Callout tone="success" title="Restore undone">
              Your Conch is back to how it was before the restore.
            </Callout>
          ) : (
            <Callout
              tone="success"
              title={restoredTitle(restored.from)}
              action={
                undoCopy && (
                  <Button
                    size="sm"
                    variant="surface"
                    onClick={() => setRestore({ id: `undo-${Date.now()}`, backup: undoCopy })}
                  >
                    Undo restore
                  </Button>
                )
              }
            >
              What was here before is kept, so you can undo this.
            </Callout>
          ))}
        {status && (
          <BackupOverview
            automatic={status?.automatic ?? true}
            onAutomaticChange={(on) => void setAutomatic(on)}
            state={state}
            detail={detail}
          >
            <Button size="sm" leadingIcon={<Download />} onClick={() => setBackingUp(true)}>
              Back up now
            </Button>
            <Button
              size="sm"
              variant="surface"
              leadingIcon={<Upload />}
              data-restore-file=""
              onClick={() => fileInput.current?.click()}
            >
              Restore from a file…
            </Button>
          </BackupOverview>
        )}
        {status && (
          <div className={styles.kept} ref={kept}>
            <Text size="sm" tone="muted">
              Kept on this computer: one a day for a week, then one a week for a month.
            </Text>
            <BackupList
              backups={(status?.backups ?? []).map((b) => ({
                id: b.id,
                kind: b.kind === 'before-restore' ? 'before-restore' : 'automatic',
                title: formatWhen(b.createdAt),
                summary: describeBackup(b.contents, b.size),
              }))}
              onRestore={(item) => {
                const backup = byId.get(item.id);
                if (backup) setRestore({ id: `${backup.id}-${Date.now()}`, backup });
              }}
              onDownload={(item) => downloadBackup(item.id)}
              empty={
                status?.automatic === false
                  ? 'No backups on this computer.'
                  : 'No backups yet. The first one is made soon, while Conch isn’t busy.'
              }
            />
          </div>
        )}
      </Stack>
      <input
        ref={fileInput}
        type="file"
        accept=".conchbackup"
        className={styles.file}
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) setRestore({ id: `file-${Date.now()}`, file });
        }}
      />
      <BackUpDialog
        open={backUpOpen}
        onOpenChange={(open) => {
          setBackingUp(open);
          if (!open) clearFocus();
        }}
        chats={status?.chats}
        guard={guard}
      />
      <RestoreDialog
        source={source}
        onClose={() => {
          setRestore(undefined);
          clearFocus();
          void client.invalidateQueries({ queryKey: backupKeys.status });
        }}
        onPickAnother={() => fileInput.current?.click()}
        guard={guard}
      />
      {dialog}
    </Section>
  );
}
