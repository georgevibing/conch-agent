import { Power, TriangleAlert } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { Spinner } from '../../components/Spinner';
import { Switch } from '../../components/Switch';
import { CopyButton } from '../CopyButton';
import { cx } from '../../utils/cx';
import styles from './AlwaysOn.module.css';

/** How the Conch answering now is running. */
export type AlwaysOnRunning = 'background' | 'window' | 'dev';

export interface AlwaysOnProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** Conch starts by itself when you log in. */
  on: boolean;
  /** Turning it on or off. Leave unset when it can't be changed here. */
  onOnChange?: (on: boolean) => void;
  running: AlwaysOnRunning;
  /** When this Conch started, ready to read: “9:14 AM”, “yesterday”. */
  since?: ReactNode;
  /** Turning it on or off right now. */
  busy?: boolean;
  /** What only works while Conch runs: “Your 2 routines only run while Conch is running.” */
  needed?: ReactNode;
  /** Something's wrong with it: one sentence, and a command when only a person can run it. */
  problem?: { message: ReactNode; command?: string };
  /** Why it can't be turned on here (a development server). */
  unsupported?: ReactNode;
  /** Where the computer lists it: “System Settings → General → Login Items”. */
  place?: string;
  /**
   * More about how it runs, as quiet rows of switches (ADR 0029): the menu
   * bar, after logging out, staying awake.
   */
  options?: ReactNode;
  /** Actions: Quit Conch. */
  children?: ReactNode;
}

/**
 * Always on, at a glance: whether Conch starts by itself when you log in,
 * how it's running right now, and the one switch. Off is never an alarm;
 * when something you set up only works while Conch runs, it says so once,
 * quietly, beside the switch that fixes it.
 */
export function AlwaysOn({
  on,
  onOnChange,
  running,
  since,
  busy = false,
  needed,
  problem,
  unsupported,
  place,
  options,
  children,
  className,
  ...props
}: AlwaysOnProps) {
  const titleId = useId();
  const detailId = useId();
  const state = unsupported
    ? 'unavailable'
    : busy
      ? 'busy'
      : problem
        ? 'problem'
        : on
          ? 'on'
          : 'off';

  const title = unsupported
    ? 'Not available here'
    : busy
      ? on
        ? 'Changing how Conch starts…'
        : 'Moving Conch to the background…'
      : on
        ? 'Starts when you log in'
        : running === 'background'
          ? 'Running until you quit it'
          : 'Runs while its window is open';

  const detail = unsupported
    ? unsupported
    : busy
      ? on
        ? null
        : 'This page comes back by itself in a moment.'
      : on
        ? 'Conch keeps running with no window, and starts again by itself if it ever stops.'
        : running === 'background'
          ? 'Conch won’t start by itself the next time you log in.'
          : 'Closing the Terminal window Conch runs in stops it. Turn this on to keep Conch running by itself.';

  const where =
    running === 'background'
      ? 'Running in the background'
      : running === 'window'
        ? 'Running in a Terminal window'
        : 'Running as a development server';

  return (
    <section
      aria-labelledby={titleId}
      className={cx(styles.root, className)}
      data-state={state}
      {...props}
    >
      <div className={styles.head}>
        <span className={styles.icon} data-state={state} aria-hidden>
          {busy ? <Spinner size="sm" label={null} /> : problem ? <TriangleAlert /> : <Power />}
        </span>
        <div className={styles.text}>
          <p className={styles.title} id={titleId}>
            {title}
          </p>
          {detail != null && (
            <p className={styles.detail} id={detailId} aria-live="polite">
              {detail}
            </p>
          )}
        </div>
        {onOnChange && !unsupported && (
          <Switch
            checked={on}
            disabled={busy}
            onCheckedChange={onOnChange}
            aria-label="Start Conch when I log in and keep it running"
            aria-describedby={detail != null ? detailId : undefined}
          />
        )}
      </div>

      {!unsupported && !busy && (
        <p className={styles.status} data-running={running}>
          <span className={styles.dot} data-running={running} aria-hidden />
          {where}
          {since != null && <span className={styles.since}> since {since}</span>}
          {on && place && <span className={styles.place}> · listed in {place}</span>}
        </p>
      )}

      {problem && !busy && (
        <div className={styles.problem} role="status">
          <p>{problem.message}</p>
          {problem.command && (
            <div className={styles.command}>
              <code>{problem.command}</code>
              <CopyButton value={problem.command} label="Copy command" />
            </div>
          )}
        </div>
      )}

      {needed != null && !on && !busy && !problem && !unsupported && (
        <p className={styles.needed}>{needed}</p>
      )}

      {options != null && !busy && !unsupported && <div className={styles.options}>{options}</div>}

      {children != null && !busy && <div className={styles.actions}>{children}</div>}
    </section>
  );
}
