import type { ComponentProps, CSSProperties } from 'react';

import { cx } from '../../utils/cx';
import type { UsageSeverity } from './types';
import styles from './Usage.module.css';

const sizes = { sm: 14, md: 18, lg: 40 } as const;

export interface UsageRingProps extends Omit<ComponentProps<'svg'>, 'children'> {
  /** Share left, 0–100. Undefined draws a quiet full ring (no ceiling to show). */
  percentLeft?: number;
  severity?: UsageSeverity;
  /** `sm` 14, `md` 18, `lg` 40 px, or any pixel size. Default 16. */
  size?: keyof typeof sizes | number;
}

/**
 * A tiny fuel gauge: the arc is what's *left* and drains clockwise toward
 * empty. Decorative by default — pair it with text that carries the number.
 */
export function UsageRing({
  percentLeft,
  severity = 'normal',
  size = 16,
  className,
  style,
  ...props
}: UsageRingProps) {
  const px = typeof size === 'number' ? size : sizes[size];
  const stroke = px >= 32 ? px * 0.1 : Math.max(1.75, px * 0.14);
  const r = (px - stroke) / 2;
  const known = percentLeft != null;
  const left = known ? Math.min(100, Math.max(0, percentLeft)) : 100;
  return (
    <svg
      aria-hidden
      width={px}
      height={px}
      viewBox={`0 0 ${px} ${px}`}
      data-severity={known ? severity : undefined}
      data-neutral={known ? undefined : ''}
      className={cx(styles.ring, className)}
      style={{ '--ring-stroke': `${stroke}px`, ...style } as CSSProperties}
      {...props}
    >
      <circle className={styles.ringTrack} cx={px / 2} cy={px / 2} r={r} />
      <circle
        className={styles.ringFill}
        cx={px / 2}
        cy={px / 2}
        r={r}
        pathLength={100}
        strokeDasharray="100 100"
        style={{ strokeDashoffset: 100 - left }}
        data-empty={left <= 0 || undefined}
      />
    </svg>
  );
}
