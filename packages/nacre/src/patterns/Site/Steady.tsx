import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Steady.module.css';

export interface SteadyProps extends ComponentProps<'div'> {
  /**
   * The moments that take the most room, drawn unseen to hold the space: the
   * end of the script, usually, and any other state that could be taller.
   */
  holds: ReactNode[];
  /** Where what's showing sits in the space held for it. */
  align?: 'start' | 'center' | 'end';
}

/**
 * Keeps a picture that plays the same size from its first moment to its last,
 * at every width, so nothing around it is pushed about as it moves. It lays
 * the tallest moments under the one showing, unseen and out of reach, and
 * takes the size of the largest.
 */
export function Steady({ holds, align = 'start', className, children, ...props }: SteadyProps) {
  return (
    <div className={cx(styles.steady, className)} data-align={align} {...props}>
      {holds.map((hold, index) => (
        <div key={index} className={styles.hold} inert aria-hidden>
          {hold}
        </div>
      ))}
      <div className={styles.now}>{children}</div>
    </div>
  );
}
