import { Check, Minus, TriangleAlert } from 'lucide-react';
import { Children, type ComponentProps, type CSSProperties, type ReactNode } from 'react';

import { Progress } from '../../components/Progress';
import { Spinner } from '../../components/Spinner';
import { cx } from '../../utils/cx';
import styles from './SetupChecklist.module.css';

export type SetupStepState =
  /** It's here or done. */
  | 'done'
  /** The one thing to do now. */
  | 'current'
  /** Comes after the current step. */
  | 'waiting'
  /** Conch is on it (installing, checking). */
  | 'working'
  /** Tried and didn't work; the description says why. */
  | 'failed'
  /** Can't be had on this computer. */
  | 'unavailable';

const spoken: Record<SetupStepState, string> = {
  done: 'Done',
  current: 'To do',
  waiting: 'Later',
  working: 'In progress',
  failed: 'Didn’t work',
  unavailable: 'Not available',
};

export interface SetupChecklistProps extends ComponentProps<'ol'> {
  /** Names the list for assistive tech: "What 1Password needs". */
  'aria-label': string;
}

/**
 * What something needs before it can work, as a short list that fills in by
 * itself. Each step says where it stands and offers at most one button;
 * the current step is the only one that asks for attention.
 */
function Root({ className, children, ...props }: SetupChecklistProps) {
  return (
    <ol className={cx(styles.list, className)} {...props}>
      {Children.toArray(children).map((child, i) => (
        <li key={i} className={styles.row} style={{ '--sc-n': `"${i + 1}"` } as CSSProperties}>
          {child}
        </li>
      ))}
    </ol>
  );
}

export interface SetupStepProps extends Omit<ComponentProps<'div'>, 'title'> {
  state: SetupStepState;
  title: ReactNode;
  /** One or two plain sentences, or a few short numbered steps. */
  description?: ReactNode;
  /** Quiet words at the end when it's done: "Installed". */
  note?: ReactNode;
  /** While `working`: omit `value` when the installer doesn't say how far it is. */
  progress?: { value?: number; label: string };
  /** The one button for this step. */
  action?: ReactNode;
}

function Step({
  state,
  title,
  description,
  note,
  progress,
  action,
  className,
  ...props
}: SetupStepProps) {
  return (
    <div data-state={state} className={cx(styles.step, className)} {...props}>
      <span className={styles.marker} aria-hidden>
        {state === 'done' ? (
          <Check />
        ) : state === 'working' ? (
          <Spinner size="xs" label={null} />
        ) : state === 'failed' ? (
          <TriangleAlert />
        ) : state === 'unavailable' ? (
          <Minus />
        ) : null}
      </span>
      <div className={styles.body}>
        <p className={styles.title}>
          <span className="nc-visually-hidden">{spoken[state]}: </span>
          {title}
          {note && state === 'done' && <span className={styles.note}>{note}</span>}
        </p>
        {description && state !== 'done' && <div className={styles.description}>{description}</div>}
        {state === 'working' && progress && (
          <Progress
            size="sm"
            value={progress.value}
            label={progress.label}
            className={styles.progress}
          />
        )}
        {action && state !== 'done' && <div className={styles.action}>{action}</div>}
      </div>
    </div>
  );
}

export const SetupChecklist = Object.assign(Root, { Step });
