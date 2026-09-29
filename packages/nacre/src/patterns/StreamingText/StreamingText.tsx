import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './StreamingText.module.css';
import { useSmoothText } from './useSmoothText';

export interface StreamingTextProps extends Omit<ComponentProps<'span'>, 'children' | 'ref'> {
  /** The full text received so far. Append to it as chunks arrive. */
  text: string;
  /** Show the pearl caret at the end while more text is expected. */
  streaming?: boolean;
  as?: 'span' | 'p' | 'div';
}

/**
 * Renders text that arrives incrementally. However bursty the stream, words
 * flow out at an even pace and each one settles in (a soft de-blur that dries
 * from the accent to the text colour). Reduced motion shows text instantly.
 */
export function StreamingText({
  text,
  streaming = false,
  as: Comp = 'span',
  className,
  ...props
}: StreamingTextProps) {
  const smooth = useSmoothText(text, { streaming });
  const shown = smooth.text;
  const freshFrom = smooth.freshFrom ?? shown.length;
  const fresh = [...shown.slice(freshFrom).matchAll(/\s+|\S+\s*/g)];
  const typing = streaming || shown.length < text.length;

  return (
    <Comp data-streaming={typing || undefined} className={cx(styles.root, className)} {...props}>
      {shown.slice(0, freshFrom)}
      {fresh.map((m) => (
        <span key={freshFrom + m.index} data-nc-fresh="">
          {m[0]}
        </span>
      ))}
      {typing && <span className={styles.caret} aria-hidden />}
    </Comp>
  );
}
