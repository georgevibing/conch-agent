import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { Reveal } from './Reveal';
import styles from './Statement.module.css';

export interface StatementProps extends Omit<ComponentProps<'figure'>, 'title'> {
  /** A mark above the words: the pearl, usually. */
  mark?: ReactNode;
  /** Who says it, or where it's from. */
  from?: ReactNode;
  /** `quote` sets the words as a quotation; `plain` as the page's own voice. */
  variant?: 'quote' | 'plain';
  size?: 'md' | 'lg';
}

/**
 * A few sentences given the whole width and the display serif: the one thing
 * a page wants remembered, or a note in someone's own voice. Rare by design.
 */
export function Statement({
  mark,
  from,
  variant = 'plain',
  size = 'lg',
  className,
  children,
  ...props
}: StatementProps) {
  const Words = variant === 'quote' ? 'blockquote' : 'div';
  return (
    <Reveal asChild>
      <figure data-size={size} className={cx(styles.statement, className)} {...props}>
        {mark != null && (
          <span className={styles.mark} aria-hidden>
            {mark}
          </span>
        )}
        <Words className={styles.words}>{children}</Words>
        {from != null && <figcaption className={styles.from}>{from}</figcaption>}
      </figure>
    </Reveal>
  );
}
