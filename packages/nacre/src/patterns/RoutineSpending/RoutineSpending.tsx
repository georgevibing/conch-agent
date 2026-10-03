import { PauseCircle } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { cx } from '../../utils/cx';
import { formatMoney, usageSeverityFor } from '../Usage/format';
import { UsageGauge } from '../Usage/UsageBar';
import styles from './RoutineSpending.module.css';

/** "November 1". */
function dayWords(at: number, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', timeZone }).format(at);
}

/** Money already spent, to the cent: "$20.40". */
function cents(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export interface RoutineSpendingGaugeProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Spent by routines this month (USD). */
  monthUsd: number;
  /** The monthly limit (USD); `null` when there is none. */
  limitUsd: number | null;
  /** What the routines that are on will spend a month, when Conch can say. */
  projectedUsd?: number;
  /** When the month starts again (the 1st). */
  resetsAt: number;
  locale?: string;
  timeZone?: string;
}

/**
 * What everything that runs while you're away has left to spend this month,
 * in the same battery words as the usage gauge: what's *left*, and when it
 * fills up again. With no limit, just what was spent.
 */
export function RoutineSpendingGauge({
  monthUsd,
  limitUsd,
  projectedUsd,
  resetsAt,
  locale = 'en-US',
  timeZone,
  className,
  ...props
}: RoutineSpendingGaugeProps) {
  const used = limitUsd ? Math.min(100, (monthUsd / limitUsd) * 100) : 0;
  const severity = limitUsd ? usageSeverityFor(used) : 'normal';
  const left = limitUsd ? Math.max(0, limitUsd - monthUsd) : undefined;
  const reading =
    limitUsd === null
      ? `${cents(monthUsd, locale)} spent`
      : `${cents(left ?? 0, locale)} left of ${formatMoney(limitUsd, 'USD', locale)}`;
  const pace =
    projectedUsd === undefined
      ? undefined
      : projectedUsd < 0.005
        ? 'Your routines cost less than a cent a month'
        : `Your routines cost about ${formatMoney(projectedUsd, 'USD', locale)} a month`;
  const over = limitUsd !== null && projectedUsd !== undefined && projectedUsd > limitUsd;
  const caption = [
    pace && (over ? `${pace}, more than the limit` : pace),
    limitUsd !== null && `Starts again ${dayWords(resetsAt, locale, timeZone)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <UsageGauge
      label="Routines this month"
      reading={reading}
      {...(limitUsd !== null && { percentLeft: Math.round(100 - used) })}
      severity={over && severity === 'normal' ? 'warning' : severity}
      caption={caption || undefined}
      valueText={`${reading}${caption ? `. ${caption}.` : ''}`}
      data-over={over || undefined}
      className={cx(styles.gauge, className)}
      {...props}
    />
  );
}

export interface RoutinesPausedProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Spent by routines this month (USD). */
  monthUsd: number;
  /** When they go again (the 1st of next month). */
  until: number;
  /** A person raises the limit (it opens where the limit is set). */
  onRaise?: () => void;
  /** “Keep paused”: the card goes away until next month. */
  onKeepPaused?: () => void;
  busy?: boolean;
  locale?: string;
  timeZone?: string;
}

/**
 * Routines that cost money reached this month's limit. One quiet card, one
 * sentence, and the two choices that matter: raise the limit, or keep them
 * paused. Never silent, never alarming.
 */
export function RoutinesPaused({
  monthUsd,
  until,
  onRaise,
  onKeepPaused,
  busy,
  locale = 'en-US',
  timeZone,
  className,
  ...props
}: RoutinesPausedProps) {
  return (
    <Callout
      tone="warning"
      icon={<PauseCircle />}
      title="Your routines are paused"
      className={cx(styles.paused, className)}
      action={
        (onRaise || onKeepPaused) && (
          <div className={styles.actions}>
            {onRaise && (
              <Button size="sm" onClick={onRaise} disabled={busy}>
                Raise the limit
              </Button>
            )}
            {onKeepPaused && (
              <Button size="sm" variant="ghost" onClick={onKeepPaused} loading={busy}>
                Keep paused
              </Button>
            )}
          </div>
        )
      }
      {...props}
    >
      Your routines have used {cents(monthUsd, locale)} this month, so the ones that cost money are
      paused until {dayWords(until, locale, timeZone)}. Routines on your plan or on this computer
      carry on.
    </Callout>
  );
}
