import { useId, type ComponentProps, type ReactNode } from 'react';

import { Odometer } from '../../patterns/ThinkingIndicator/Odometer';
import { cx } from '../../utils/cx';
import { Sparkline, type SparklineProps } from '../LiveChart/Sparkline';
import { Progress } from '../Progress';
import styles from './StatTile.module.css';

export interface StatTileProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Sentence case, no colon: "Memory". */
  label: string;
  /** Already worded: "56%", "1.2 GB". Its digits turn like an odometer as it changes. */
  value: string;
  /** A quiet line under the value: "20 of 36 GB". */
  detail?: ReactNode;
  /** A small glyph before the label. */
  icon?: ReactNode;
  /** The last few minutes, as a sparkline under the value. */
  trend?: Pick<SparklineProps, 'values' | 'max' | 'latest' | 'intervalMs' | 'color'>;
  /** A share filled, 0–100, as a slim bar (for a disk, a battery). */
  meter?: number;
  /** `warning` and `critical` tint the meter and carry a word in `detail`. */
  tone?: 'normal' | 'warning' | 'critical';
}

/**
 * One number at a glance: a label, the value large in the sans (proportional
 * figures, never the display serif), a quiet detail, and either a sparkline
 * of the last few minutes or a meter. The value is read once as text; its
 * turning digits are decoration.
 */
export function StatTile({
  label,
  value,
  detail,
  icon,
  trend,
  meter,
  tone = 'normal',
  className,
  ...props
}: StatTileProps) {
  const labelId = useId();
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={cx(styles.tile, className)}
      data-tone={tone}
      {...props}
    >
      <span id={labelId} className={styles.label}>
        {icon != null && (
          <span className={styles.icon} aria-hidden>
            {icon}
          </span>
        )}
        {label}
      </span>
      <span className={styles.value}>
        <Odometer value={value} aria-hidden />
        <span className="nc-visually-hidden">{value}</span>
      </span>
      {detail != null && <span className={styles.detail}>{detail}</span>}
      <span className={styles.foot}>
        {trend ? (
          <Sparkline {...trend} height={26} />
        ) : meter !== undefined ? (
          <Progress
            value={meter}
            size="sm"
            tone={tone === 'critical' ? 'danger' : 'accent'}
            aria-label={`${label}, ${Math.round(meter)}%`}
            className={styles.meter}
          />
        ) : null}
      </span>
    </div>
  );
}
