import { Progress as ProgressPrimitive } from 'radix-ui';
import { useId, type ComponentProps, type CSSProperties, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Progress.module.css';

export interface ProgressProps extends Omit<
  ComponentProps<typeof ProgressPrimitive.Root>,
  'value' | 'max'
> {
  /** Current value. `null`/`undefined` renders the indeterminate state. */
  value?: number | null;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'accent' | 'neutral' | 'success' | 'danger';
  /** Visible label above the track; also becomes the accessible name. */
  label?: ReactNode;
  /** Show the percentage (or a custom formatter's output) beside the label. */
  showValue?: boolean | ((value: number, max: number) => ReactNode);
}

/** Linear progress with a slow pearl sheen travelling across the fill. */
export function Progress({
  value,
  max = 100,
  size = 'md',
  tone = 'accent',
  label,
  showValue,
  className,
  style,
  ...props
}: ProgressProps) {
  const labelId = useId();
  const indeterminate = value == null;
  const clamped = indeterminate ? 0 : Math.min(max, Math.max(0, value));
  const pct = max > 0 ? (clamped / max) * 100 : 0;
  const valueText =
    !indeterminate && showValue
      ? typeof showValue === 'function'
        ? showValue(clamped, max)
        : `${Math.round(pct)}%`
      : null;

  return (
    <div className={cx(styles.wrapper, className)} style={style}>
      {(label != null || valueText != null) && (
        <div className={styles.header}>
          {label != null && (
            <span id={labelId} className={styles.label}>
              {label}
            </span>
          )}
          {valueText != null && (
            <span className={styles.value} aria-hidden>
              {valueText}
            </span>
          )}
        </div>
      )}
      <ProgressPrimitive.Root
        value={indeterminate ? null : clamped}
        max={max}
        data-size={size}
        data-tone={tone}
        aria-labelledby={label != null ? labelId : undefined}
        className={styles.track}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={styles.indicator}
          style={{ '--progress': `${pct}%` } as CSSProperties}
        />
      </ProgressPrimitive.Root>
    </div>
  );
}
