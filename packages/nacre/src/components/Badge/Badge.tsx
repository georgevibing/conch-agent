import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Badge.module.css';

export type BadgeTone = 'accent' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: BadgeTone;
  variant?: 'soft' | 'solid' | 'outline';
  size?: 'sm' | 'md';
  /** Leading status dot. `pulse` animates it gently for live states. */
  dot?: boolean | 'pulse';
  icon?: ReactNode;
}

/** Compact status or metadata label. Not interactive. */
export function Badge({
  tone = 'neutral',
  variant = 'soft',
  size = 'md',
  dot,
  icon,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      data-tone={tone}
      data-variant={variant}
      data-size={size}
      className={cx(styles.badge, className)}
      {...props}
    >
      {dot && <span className={styles.dot} data-pulse={dot === 'pulse' || undefined} aria-hidden />}
      {icon != null && (
        <span className={styles.icon} aria-hidden>
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
