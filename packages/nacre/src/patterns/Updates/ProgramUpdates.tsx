import { Check } from 'lucide-react';
import { Children, type ComponentProps, type ReactNode } from 'react';

import { Progress } from '../../components/Progress';
import { cx } from '../../utils/cx';
import styles from './Updates.module.css';

export type ProgramUpdateState =
  /** Nothing newer. */
  | 'current'
  /** A newer version is out; `action` updates it. */
  | 'available'
  /** Waiting for the update before it to finish. */
  | 'queued'
  /** Updating now; `progress` says how far. */
  | 'updating'
  /** Just updated. */
  | 'updated'
  /** The last update didn't work; `message` says why. */
  | 'failed';

export interface ProgramUpdatesProps extends ComponentProps<'ul'> {
  /** Names the list: "Programs Conch uses". */
  'aria-label': string;
}

/**
 * The programs Conch uses and whether a newer one is out: a quiet list, one
 * row each, with at most one button per row. Updates run one at a time.
 */
function Root({ className, children, ...props }: ProgramUpdatesProps) {
  return (
    <ul className={cx(styles.programs, className)} {...props}>
      {Children.toArray(children).map((child, i) => (
        <li key={i} className={styles.programRow}>
          {child}
        </li>
      ))}
    </ul>
  );
}

export interface ProgramUpdateItemProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** "Codex" */
  name: string;
  /** The version here: "0.159.0". */
  version: string;
  state: ProgramUpdateState;
  /** Quiet words on the right when there's no button: "Up to date", "Waiting…". */
  status?: ReactNode;
  /** The one button: "Update to 0.160.0", "Try again". */
  action?: ReactNode;
  /** While `updating`: omit `value` when the installer doesn't say how far. */
  progress?: { value?: number; label: string };
  /** One sentence under the row: why it failed, or how to get it by hand. */
  message?: ReactNode;
}

function Item({
  name,
  version,
  state,
  status,
  action,
  progress,
  message,
  className,
  ...props
}: ProgramUpdateItemProps) {
  const done = state === 'current' || state === 'updated';
  return (
    <div data-state={state} className={cx(styles.program, className)} {...props}>
      <div className={styles.programMain}>
        <div className={styles.programName}>
          <span className={styles.name}>{name}</span>
          <span className={styles.version}>{version}</span>
        </div>
        <div className={styles.programEnd}>
          {action ?? (
            <span className={styles.status}>
              {done && <Check aria-hidden className={styles.check} />}
              {status}
            </span>
          )}
        </div>
      </div>
      {state === 'updating' && progress && (
        <Progress size="sm" value={progress.value} label={progress.label} />
      )}
      {message && <p className={styles.message}>{message}</p>}
    </div>
  );
}

export const ProgramUpdates = Object.assign(Root, { Item });
