import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Steps.module.css';

export type StepsProps = ComponentProps<'ol'>;

/**
 * Instructions to follow in order, all in view at once: numbered markers on a
 * thread. For reading and doing; `GuideSteps` is the one that walks someone
 * through a setup a step at a time.
 */
function StepsRoot({ className, ...props }: StepsProps) {
  return <ol className={cx(styles.steps, className)} {...props} />;
}

export interface StepProps extends Omit<ComponentProps<'li'>, 'title'> {
  /** A short heading for the step, when it needs one. */
  title?: ReactNode;
}

function Step({ title, className, children, ...props }: StepProps) {
  return (
    <li className={cx(styles.step, className)} {...props}>
      <div className={styles.body}>
        {title != null && <p className={styles.title}>{title}</p>}
        {children}
      </div>
    </li>
  );
}

export const Steps = Object.assign(StepsRoot, { Step });
