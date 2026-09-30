import { useId, type ComponentProps, type ReactNode } from 'react';

import { Callout } from '../../components/Callout';
import { Collapsible } from '../../components/Collapsible';
import { Pearl } from '../../components/Pearl';
import { Progress } from '../../components/Progress';
import { cx } from '../../utils/cx';
import { CopyButton } from '../CopyButton';
import styles from './Updates.module.css';

export type SoftwareUpdateState =
  /** Nothing waiting. */
  | 'current'
  /** An update is ready. */
  | 'available'
  /** Updating now; `progress` says how far. */
  | 'updating'
  /** Can't be checked or updated here; `detail` says why. */
  | 'unavailable';

export interface SoftwareUpdateProgress {
  /** "Installing" */
  label: string;
  /** Overall, 0–100; omit when it can't be known. */
  value?: number;
  /** "2 of 3" */
  step?: number;
  steps?: number;
}

export interface SoftwareUpdateProps extends Omit<ComponentProps<'section'>, 'title'> {
  state: SoftwareUpdateState;
  /** "Conch is up to date", "An update is ready". */
  title: ReactNode;
  /** One quiet line: "0.2.0 · Checked 2 hours ago", "12 improvements · Checked just now". */
  detail?: ReactNode;
  /** What the update brings, newest first, in plain words. */
  whatsNew?: string[];
  /** The disclosure's label. */
  whatsNewLabel?: string;
  /** Changes beyond the ones listed: "and 7 more". */
  more?: number;
  /** Open "What's new" from the start. */
  defaultOpen?: boolean;
  progress?: SoftwareUpdateProgress;
  /** The one button (Update Conch, Restart Conch). Hidden while updating. */
  action?: ReactNode;
  /** A reassuring line beside the button: "Conch restarts by itself. Your chats are safe." */
  footnote?: ReactNode;
  /** One press can't do it: why, in a sentence, and the exact command to run by hand. */
  blocked?: { reason: ReactNode; command?: string };
  /** How the last update went, in one sentence. */
  notice?: { tone: 'success' | 'warning' | 'danger'; message: ReactNode; command?: string };
}

/** A command to copy, a line per step. */
function Command({ command }: { command: string }) {
  return (
    <div className={styles.command}>
      <code>{command}</code>
      <CopyButton value={command} label="Copy command" className={styles.copy} />
    </div>
  );
}

/**
 * Conch's own update, as calm as a phone's Software Update screen: the pearl,
 * where things stand in a few words, what's new behind a disclosure, and one
 * button. While it updates, the steps it's on and how far along it is; when
 * one press can't do it, why — and what to run instead.
 */
export function SoftwareUpdate({
  state,
  title,
  detail,
  whatsNew = [],
  whatsNewLabel = 'What’s new',
  more = 0,
  defaultOpen = false,
  progress,
  action,
  footnote,
  blocked,
  notice,
  className,
  ...props
}: SoftwareUpdateProps) {
  const titleId = useId();
  const updating = state === 'updating';
  const stepText =
    progress?.step && progress.steps ? ` · ${progress.step} of ${progress.steps}` : '';
  return (
    <section
      data-state={state}
      aria-labelledby={titleId}
      className={cx(styles.software, className)}
      {...props}
    >
      <div className={styles.head}>
        <span className={styles.icon}>
          <Pearl size="lg" state={updating ? 'thinking' : 'idle'} label={null} />
        </span>
        <div className={styles.heading}>
          <p id={titleId} className={styles.title}>
            {title}
          </p>
          {detail && <p className={styles.detail}>{detail}</p>}
        </div>
        {action && !updating && <div className={styles.action}>{action}</div>}
      </div>

      {updating && progress && (
        <Progress
          size="sm"
          value={progress.value}
          label={`${progress.label}${stepText}`}
          className={styles.progress}
        />
      )}

      {notice && (
        <Callout tone={notice.tone} live="polite" className={styles.notice}>
          <p>{notice.message}</p>
          {notice.command && <Command command={notice.command} />}
        </Callout>
      )}

      {blocked && !updating && (
        <div className={styles.blocked}>
          <p>{blocked.reason}</p>
          {blocked.command && <Command command={blocked.command} />}
        </div>
      )}

      {whatsNew.length > 0 && (
        <Collapsible defaultOpen={defaultOpen} className={styles.whatsNew}>
          <Collapsible.Trigger>{whatsNewLabel}</Collapsible.Trigger>
          <Collapsible.Content>
            <ul className={styles.changes}>
              {whatsNew.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {more > 0 && <li className={styles.more}>and {more} more</li>}
            </ul>
          </Collapsible.Content>
        </Collapsible>
      )}

      {footnote && !updating && <p className={styles.footnote}>{footnote}</p>}
    </section>
  );
}
