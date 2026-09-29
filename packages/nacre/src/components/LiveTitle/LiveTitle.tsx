import { useState, type ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './LiveTitle.module.css';

export interface LiveTitleProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** The title as it stands — a placeholder while `pending`, the real one after. */
  children: string;
  /** A better title is being written: the placeholder shimmers until it lands. */
  pending?: boolean;
}

/**
 * A title that may still be being written — a new chat named by a model after
 * it starts. While `pending`, the placeholder carries a slow pearl shimmer;
 * when the real title arrives it is revealed with a soft left-to-right
 * sweep. Truncates with an ellipsis, like any single-line label.
 */
export function LiveTitle({ children, pending = false, className, ...props }: LiveTitleProps) {
  // Reveal only when a pending title resolves into a different one, not on every change.
  const [seen, setSeen] = useState({ text: children, pending, reveals: 0 });
  if (seen.text !== children || seen.pending !== pending) {
    const resolved = seen.pending && !pending && seen.text !== children;
    setSeen({ text: children, pending, reveals: seen.reveals + (resolved ? 1 : 0) });
  }
  return (
    <span
      key={seen.reveals}
      data-pending={pending || undefined}
      data-revealed={seen.reveals > 0 || undefined}
      aria-busy={pending || undefined}
      className={cx(styles.root, className)}
      {...props}
    >
      {children}
    </span>
  );
}
