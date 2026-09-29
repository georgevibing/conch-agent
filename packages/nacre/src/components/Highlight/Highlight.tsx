import { Fragment, type ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './Highlight.module.css';

/** `[start, end)` offsets into `text`. */
export type HighlightRange = readonly [number, number];

export interface HighlightProps extends Omit<ComponentProps<'span'>, 'children'> {
  text: string;
  /** Sorted, non-overlapping ranges to mark. Out-of-bounds ranges are clipped. */
  ranges: readonly HighlightRange[];
  /** `soft` for dense lists (search results), `strong` for a single focused match. */
  tone?: 'soft' | 'strong';
}

/**
 * Text with matched spans marked — search results, fuzzy-matched titles,
 * previews. Marks are semantic `<mark>`s, so screen readers can announce them
 * and colour isn't the only signal (they're also slightly heavier).
 */
export function Highlight({ text, ranges, tone = 'soft', className, ...props }: HighlightProps) {
  const parts: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [rawStart, rawEnd] of ranges) {
    const start = Math.max(at, Math.min(rawStart, text.length));
    const end = Math.max(start, Math.min(rawEnd, text.length));
    if (end === start) continue;
    if (start > at) parts.push({ text: text.slice(at, start), hit: false });
    parts.push({ text: text.slice(start, end), hit: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return (
    <span data-tone={tone} className={cx(styles.root, className)} {...props}>
      {parts.map((part, i) =>
        part.hit ? (
          <mark key={i} className={styles.mark}>
            {part.text}
          </mark>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </span>
  );
}
