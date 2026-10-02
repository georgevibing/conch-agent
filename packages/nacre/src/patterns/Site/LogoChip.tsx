import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './LogoChip.module.css';

export interface LogoChipProps extends ComponentProps<'span'> {
  /** The mark, usually an `IntegrationLogo` at `xs`, marked decorative. */
  logo?: ReactNode;
  /** It isn't here yet: said in words, and drawn quieter. */
  soon?: boolean;
}

/** A name with its mark, as a small porcelain pill: one of many in a row. */
export function LogoChip({ logo, soon, className, children, ...props }: LogoChipProps) {
  return (
    <span data-soon={soon || undefined} className={cx(styles.chip, className)} {...props}>
      {logo != null && (
        <span className={styles.logo} aria-hidden>
          {logo}
        </span>
      )}
      <span>{children}</span>
      {soon && <span className={styles.soon}>soon</span>}
    </span>
  );
}
