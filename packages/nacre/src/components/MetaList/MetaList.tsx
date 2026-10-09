import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './MetaList.module.css';

/**
 * The dot between two facts in a line of words, bound to the fact before it
 * by a no-break space: "15 GB memory · Up 29 days" can break after the dot,
 * never before it, so a wrapped line never starts with "·".
 */
export const META_SEP = '\u00a0\u00b7 ';

/**
 * A quiet line of facts as one string — "PDF · 3 pages · 242 KB" — leaving
 * out the empty ones. The dots stay with the fact before them (`META_SEP`),
 * so a narrow screen wraps between facts, never in front of a dot. For a line
 * of nodes (a link, a time), use `MetaList`.
 */
export function joinMeta(parts: readonly (string | number | false | null | undefined)[]): string {
  return parts.filter((p) => p !== false && p != null && p !== '').join(META_SEP);
}

export interface MetaListProps extends Omit<ComponentProps<'ul'>, 'children'> {
  /** The facts, in order: "macOS 26.1", "12 cores", "Up 3 days". Empty ones are left out. */
  items: readonly ReactNode[];
}

/**
 * A line of short facts with a quiet dot between them. When the line is too
 * long it wraps between facts, and the dot in front of whichever fact starts
 * the new line is tucked out of sight: a line never starts (or ends) with a
 * dot. A list, so a screen reader counts the facts and doesn't read the dots.
 */
export function MetaList({ items, className, ...props }: MetaListProps) {
  const shown = items.filter((item) => item != null && item !== false && item !== '');
  if (shown.length === 0) return null;
  return (
    <ul className={cx(styles.list, className)} {...props}>
      {shown.map((item, i) => (
        <li key={i} className={styles.item}>
          {item}
        </li>
      ))}
    </ul>
  );
}
