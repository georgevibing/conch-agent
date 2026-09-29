import { useId, type ComponentProps, type ReactNode } from 'react';

import { Progress } from '../../components/Progress';
import { cx } from '../../utils/cx';
import { formatLeft, formatResetAt, formatResetIn, percentLeft } from './format';
import type { UsageSeverity, UsageWindowValue } from './types';
import styles from './Usage.module.css';
import { useNow } from './useNow';

export interface UsageGaugeProps extends Omit<ComponentProps<'div'>, 'title'> {
  label: ReactNode;
  /** Muted qualifier after the label ("Opus"). */
  scope?: ReactNode;
  /** Right-aligned reading, e.g. "62% left". */
  reading: ReactNode;
  /** Share left, 0–100. Omit for rows with nothing to fill (no cap). */
  percentLeft?: number;
  severity: UsageSeverity;
  caption?: ReactNode;
  /** Spoken value of the bar, e.g. "62% left, resets in 2 h 14 min". */
  valueText: string;
  /** Leads the list: larger type and a thicker bar. */
  emphasis?: boolean;
}

/** Shared row layout: label + reading, a draining bar, a muted caption. */
export function UsageGauge({
  label,
  scope,
  reading,
  percentLeft: left,
  severity,
  caption,
  valueText,
  emphasis = false,
  className,
  ...props
}: UsageGaugeProps) {
  const labelId = useId();
  return (
    <div
      data-severity={severity}
      data-emphasis={emphasis || undefined}
      className={cx(styles.gauge, className)}
      {...props}
    >
      <div className={styles.gaugeHead}>
        <span id={labelId} className={styles.gaugeLabel}>
          {label}
          {scope != null && <span className={styles.gaugeScope}> · {scope}</span>}
        </span>
        <span className={styles.gaugeReading} aria-hidden={left != null || undefined}>
          {reading}
        </span>
      </div>
      {left != null && (
        <Progress
          value={left}
          size={emphasis ? 'md' : 'sm'}
          tone={severity === 'critical' || severity === 'exhausted' ? 'danger' : 'accent'}
          aria-labelledby={labelId}
          getValueLabel={() => valueText}
          className={styles.gaugeBar}
        />
      )}
      {caption != null && (
        <span className={styles.gaugeCaption} aria-hidden={left != null || undefined}>
          {caption}
        </span>
      )}
    </div>
  );
}

export interface UsageBarProps extends Omit<ComponentProps<'div'>, 'title'> {
  window: UsageWindowValue;
  now?: number;
  emphasis?: boolean;
  locale?: string;
  timeZone?: string;
}

/** One plan window: how much is left and when it refills. */
export function UsageBar({ window: w, now, emphasis, locale, timeZone, ...props }: UsageBarProps) {
  const current = useNow(30_000, now);
  const exhausted = w.severity === 'exhausted';
  const resetIn = w.resetsAt != null ? formatResetIn(w.resetsAt, current) : undefined;
  const caption =
    w.resetsAt != null
      ? `Resets ${resetIn} · ${formatResetAt(w.resetsAt, current, locale, timeZone)}`
      : undefined;
  const reading = exhausted ? 'Used up' : formatLeft(w.usedPercent);
  return (
    <UsageGauge
      label={w.label}
      scope={w.scope}
      reading={reading}
      percentLeft={exhausted ? 0 : percentLeft(w.usedPercent)}
      severity={w.severity}
      caption={caption}
      valueText={`${exhausted ? 'Used up' : reading}${resetIn ? `, resets ${resetIn}` : ''}`}
      emphasis={emphasis}
      {...props}
    />
  );
}
