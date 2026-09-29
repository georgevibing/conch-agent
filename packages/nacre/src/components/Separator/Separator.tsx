import { Separator as SeparatorPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Separator.module.css';

export interface SeparatorProps extends ComponentProps<typeof SeparatorPrimitive.Root> {
  /** Optional centred label, e.g. a date divider in a transcript. Horizontal only. */
  label?: ReactNode;
  /** Inset from the container edges on the main axis. */
  inset?: boolean;
}

/** A hairline that fades out at its ends instead of stopping abruptly. */
export function Separator({
  orientation = 'horizontal',
  decorative = true,
  label,
  inset,
  className,
  ...props
}: SeparatorProps) {
  if (label != null && orientation === 'horizontal') {
    return (
      <div
        role={decorative ? 'none' : 'separator'}
        aria-orientation={decorative ? undefined : 'horizontal'}
        data-inset={inset || undefined}
        className={cx(styles.labelled, className)}
      >
        <span className={styles.line} aria-hidden />
        <span className={styles.label}>{label}</span>
        <span className={styles.line} aria-hidden />
      </div>
    );
  }
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      decorative={decorative}
      data-inset={inset || undefined}
      className={cx(styles.separator, className)}
      {...props}
    />
  );
}
