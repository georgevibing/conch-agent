import { Check } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './GuideSteps.module.css';

export type GuideStepState = 'done' | 'current' | 'upcoming';

export interface GuideStepsProps extends ComponentProps<'ol'> {
  /** What the steps are for, read out with the list ("Connect Telegram"). */
  label: string;
}

/**
 * A short, numbered path through setting something up. One step is open at a
 * time; finished ones fold to a line that says what was done, and the ones
 * ahead wait, quietly, so the whole path is always in view.
 */
function GuideStepsRoot({ label, className, children, ...props }: GuideStepsProps) {
  return (
    <ol aria-label={label} className={cx(styles.steps, className)} {...props}>
      {children}
    </ol>
  );
}

export interface GuideStepProps extends Omit<ComponentProps<'li'>, 'title'> {
  number: number;
  title: ReactNode;
  state: GuideStepState;
  /** When done: one line on what was done ("Found @my_conch_bot"). */
  summary?: ReactNode;
  /** When done: a quiet way back to change it. */
  onEdit?: () => void;
  editLabel?: string;
}

function GuideStep({
  number,
  title,
  state,
  summary,
  onEdit,
  editLabel = 'Change',
  className,
  children,
  ...props
}: GuideStepProps) {
  return (
    <li
      data-state={state}
      aria-current={state === 'current' ? 'step' : undefined}
      className={cx(styles.step, className)}
      {...props}
    >
      <span className={styles.marker} aria-hidden>
        {state === 'done' ? <Check size={14} strokeWidth={2.75} /> : number}
      </span>
      <div className={styles.body}>
        <div className={styles.head}>
          <h3 className={styles.title}>
            <span className="nc-visually-hidden">
              Step {number}
              {state === 'done' ? ', done' : state === 'upcoming' ? ', next' : ''}:{' '}
            </span>
            {title}
          </h3>
          {state === 'done' && onEdit && (
            <button type="button" className={styles.edit} onClick={onEdit}>
              {editLabel}
            </button>
          )}
        </div>
        {state === 'done' && summary && <p className={styles.summary}>{summary}</p>}
        {state === 'current' && <div className={styles.content}>{children}</div>}
      </div>
    </li>
  );
}

export const GuideSteps = Object.assign(GuideStepsRoot, { Root: GuideStepsRoot, Step: GuideStep });
