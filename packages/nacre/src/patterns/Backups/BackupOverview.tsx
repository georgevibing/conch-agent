import { History, TriangleAlert } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { Spinner } from '../../components/Spinner';
import { Switch } from '../../components/Switch';
import { cx } from '../../utils/cx';
import styles from './Backups.module.css';

/**
 * - `ok`: backing up every day, and lately did.
 * - `running`: a backup or a restore is under way.
 * - `problem`: the last one didn't happen; `detail` says why.
 * - `off`: automatic backups are turned off.
 */
export type BackupOverviewState = 'ok' | 'running' | 'problem' | 'off';

export interface BackupOverviewProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** Conch backs itself up every day. */
  automatic: boolean;
  onAutomaticChange?: (automatic: boolean) => void;
  /** Defaults to `ok`, or `off` when automatic backups are off. */
  state?: BackupOverviewState;
  /** One line under the title: “Last backup today at 3:12 AM · 9 kept, 48 MB”. */
  detail?: ReactNode;
  /** The actions: Back up now, Restore from a file… */
  children?: ReactNode;
}

/**
 * Where backups stand, at a glance, with the one switch that matters: a quiet
 * card, like a phone's “Backed up · Last backup today at 3:12”. Never an alarm:
 * a missed backup says why in one sentence and Conch tries again by itself.
 */
export function BackupOverview({
  automatic,
  onAutomaticChange,
  state,
  detail,
  children,
  className,
  ...props
}: BackupOverviewProps) {
  const titleId = useId();
  const shown = state ?? (automatic ? 'ok' : 'off');
  const title = !automatic
    ? 'Automatic backups are off'
    : shown === 'problem'
      ? 'The last backup didn’t happen'
      : 'Backed up automatically';
  return (
    <section
      aria-labelledby={titleId}
      className={cx(styles.overview, className)}
      data-state={shown}
      {...props}
    >
      <div className={styles.overviewHead}>
        <span className={styles.overviewIcon} data-state={shown} aria-hidden>
          {shown === 'running' ? (
            <Spinner size="sm" label={null} />
          ) : shown === 'problem' ? (
            <TriangleAlert />
          ) : (
            <History />
          )}
        </span>
        <div className={styles.overviewText}>
          <p className={styles.overviewTitle} id={titleId}>
            {title}
          </p>
          {detail != null && (
            <p className={styles.overviewDetail} aria-live="polite">
              {detail}
            </p>
          )}
        </div>
        {onAutomaticChange && (
          <Switch
            checked={automatic}
            onCheckedChange={onAutomaticChange}
            aria-label="Back up automatically every day"
          />
        )}
      </div>
      {children != null && <div className={styles.overviewActions}>{children}</div>}
    </section>
  );
}
