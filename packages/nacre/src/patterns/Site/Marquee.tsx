import type { ComponentProps, CSSProperties, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Marquee.module.css';

export interface MarqueeProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** What the row is, read out once with its items ("Apps it connects to"). */
  label: string;
  /** The things in the row. Each should say what it is in words. */
  items: ReactNode[];
  /** Seconds for one full pass. Slow is the point. */
  seconds?: number;
  /** Drift the other way: two rows that pass each other read as depth. */
  reverse?: boolean;
}

/**
 * A row that drifts sideways for ever, for showing many of a kind (logos,
 * names) without making a wall of them. It stops under the pointer, and with
 * reduced motion it's a plain wrapped row, all of it in view.
 */
export function Marquee({
  label,
  items,
  seconds = 48,
  reverse,
  className,
  style,
  ...props
}: MarqueeProps) {
  const row = (hidden: boolean) => (
    <ul
      className={styles.row}
      aria-label={hidden ? undefined : label}
      aria-hidden={hidden || undefined}
    >
      {items.map((item, i) => (
        <li key={i} className={styles.item}>
          {item}
        </li>
      ))}
    </ul>
  );
  return (
    <div
      className={cx(styles.marquee, className)}
      data-reverse={reverse || undefined}
      style={{ '--mq-seconds': `${seconds}s`, ...style } as CSSProperties}
      {...props}
    >
      <div className={styles.track}>
        {row(false)}
        {/* A second copy follows the first, so the row has no end. Not read twice. */}
        {row(true)}
      </div>
    </div>
  );
}
