import { formatBackupDate, toast } from '@conch/nacre';
import { useEffect } from 'react';

import { useUi } from '../../app/ui';
import { backupApi } from './backups';
import { RESTORING_KEY } from './RestoreDialog';

/**
 * After Conch starts again to finish a restore, the page reloads onto a
 * different Conch. This says so once, quietly, with Undo right there.
 */
export function RestoredNotice() {
  useEffect(() => {
    let marked: { at: number } | undefined;
    try {
      const raw = sessionStorage.getItem(RESTORING_KEY);
      sessionStorage.removeItem(RESTORING_KEY);
      marked = raw ? (JSON.parse(raw) as { at: number }) : undefined;
    } catch {
      marked = undefined;
    }
    if (!marked || typeof marked.at !== 'number') return;
    const since = marked.at - 60_000;
    void backupApi.status().then(
      (status) => {
        const restored = status.restored;
        if (!restored || restored.at < since) return;
        const undo = restored.undoId;
        toast.success(
          restored.from.kind === 'before-restore' ? 'Restore undone' : 'Your Conch is restored',
          {
            description:
              restored.from.kind === 'before-restore'
                ? 'It’s back to how it was before the restore.'
                : `From ${formatBackupDate(restored.from.createdAt)}.`,
            duration: 12_000,
            ...(undo &&
              restored.from.kind !== 'before-restore' && {
                action: {
                  label: 'Undo',
                  onClick: () => useUi.getState().openSettings('health', 'undo-restore'),
                },
              }),
          },
        );
      },
      () => undefined,
    );
  }, []);
  return null;
}
