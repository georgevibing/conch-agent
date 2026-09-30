import { CalendarClock, Download, Undo2 } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import styles from './Backups.module.css';

export interface BackupListItem {
  id: string;
  /** When it was made, as a person says it: “Today at 3:12 AM”. */
  title: string;
  /** `before-restore`: the copy kept just before a restore, which undoes it. */
  kind: 'automatic' | 'before-restore';
  /** What's in it: “12 memories · 3 routines · 240 chats · 48 MB”. */
  summary: string;
}

export interface BackupListProps extends Omit<ComponentProps<'ul'>, 'children'> {
  backups: BackupListItem[];
  onRestore?: (backup: BackupListItem) => void;
  /** Offered for automatic backups (an Undo copy never leaves this computer). */
  onDownload?: (backup: BackupListItem) => void;
  /**
   * Shown when there are none yet. Short: the overview above already says
   * when the first one is made.
   */
  empty?: ReactNode;
}

/**
 * The backups kept on this computer, newest first, each with **Restore…**.
 * An Undo copy says what it is; nothing else asks for attention.
 */
export function BackupList({
  backups,
  onRestore,
  onDownload,
  empty = 'None yet.',
  className,
  ...props
}: BackupListProps) {
  if (!backups.length) return <p className={styles.listEmpty}>{empty}</p>;
  return (
    <ul aria-label="Backups on this computer" className={cx(styles.list, className)} {...props}>
      {backups.map((backup) => (
        <li key={backup.id} className={styles.row} data-kind={backup.kind}>
          <span className={styles.rowIcon} aria-hidden>
            {backup.kind === 'before-restore' ? <Undo2 /> : <CalendarClock />}
          </span>
          <div className={styles.rowBody}>
            <p className={styles.rowTitle}>
              {backup.title}
              {backup.kind === 'before-restore' && (
                <Badge size="sm" variant="soft">
                  Before a restore
                </Badge>
              )}
            </p>
            <p className={styles.rowSummary}>{backup.summary}</p>
          </div>
          <div className={styles.rowActions}>
            {onDownload && backup.kind === 'automatic' && (
              <IconButton
                size="sm"
                label={`Download the backup from ${backup.title}`}
                tooltip="Download"
                onClick={() => onDownload(backup)}
              >
                <Download />
              </IconButton>
            )}
            {onRestore && (
              <Button
                size="sm"
                variant="surface"
                onClick={() => onRestore(backup)}
                aria-label={`Restore the backup from ${backup.title}`}
              >
                Restore…
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
