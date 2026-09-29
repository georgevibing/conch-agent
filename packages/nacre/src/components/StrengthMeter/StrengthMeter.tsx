import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './StrengthMeter.module.css';

export interface StrengthMeterProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** 0 = unusable … 4 = strong. */
  score: 0 | 1 | 2 | 3 | 4;
  /** Short verdict shown beside the bar, e.g. "Strong". */
  label: string;
  /** One helpful sentence: why it was rejected, or how to improve it. */
  message?: string;
  /** Nothing typed yet: show an empty, quiet meter. */
  empty?: boolean;
}

/**
 * Four-segment strength meter for new passwords. The verdict is always in
 * words — colour only reinforces it — and changes are announced politely.
 */
export function StrengthMeter({
  score,
  label,
  message,
  empty,
  className,
  ...props
}: StrengthMeterProps) {
  const tone = empty ? 'empty' : score <= 1 ? 'weak' : score === 2 ? 'fair' : 'strong';
  return (
    <div className={cx(styles.root, className)} data-tone={tone} {...props}>
      <div className={styles.row}>
        <div
          role="meter"
          aria-label="Password strength"
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={empty ? 0 : score}
          aria-valuetext={empty ? 'Nothing typed yet' : label}
          className={styles.bar}
        >
          {[1, 2, 3, 4].map((n) => (
            <span
              key={n}
              className={styles.segment}
              data-on={(!empty && score >= n) || undefined}
            />
          ))}
        </div>
        {!empty && <span className={styles.label}>{label}</span>}
      </div>
      <p className={styles.message} aria-live="polite">
        {empty ? '' : message}
      </p>
    </div>
  );
}
