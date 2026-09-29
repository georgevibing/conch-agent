import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './Spinner.module.css';

export interface SpinnerProps extends ComponentProps<'span'> {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Accessible label. Pass `null` when a parent already announces busy state. */
  label?: string | null;
}

/** A crisp comet-tail ring. Inherits `currentColor`. */
export function Spinner({ size = 'sm', label = 'Loading', className, ...props }: SpinnerProps) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      data-size={size}
      className={cx(styles.spinner, className)}
      {...props}
    />
  );
}
