import { RotateCw } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import {
  formatMoney,
  formatResetAt,
  formatResetIn,
  formatUpdated,
  headlineWindow,
  percentLeft,
  usageSeverityFor,
} from './format';
import type { UsageValue } from './types';
import { UsageBar, UsageGauge } from './UsageBar';
import styles from './Usage.module.css';
import { useNow } from './useNow';

export interface UsagePanelProps extends Omit<ComponentProps<'div'>, 'children'> {
  value: UsageValue;
  now?: number;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Metered only: shows "Set a monthly budget" / "Change budget". */
  onSetBudget?: () => void;
  /** Extra content in the footer row, e.g. a link to settings. */
  footer?: ReactNode;
  locale?: string;
  timeZone?: string;
}

/**
 * The details behind the header gauge. Plans list each rolling window with
 * what's left and when it refills; pay-as-you-go shows spend and, if set,
 * the budget that's left. Embeds in a popover or a settings page.
 */
export function UsagePanel({
  value,
  now,
  onRefresh,
  refreshing = false,
  onSetBudget,
  footer,
  locale,
  timeZone,
  className,
  ...props
}: UsagePanelProps) {
  const current = useNow(30_000, now);
  const lead = headlineWindow(value);
  const until = value.blocked ? (value.blocked.until ?? lead?.resetsAt) : undefined;
  const subtitle =
    value.kind === 'plan'
      ? "Your plan's limits"
      : value.kind === 'metered'
        ? 'Pay as you go'
        : 'Usage appears once Claude Code is ready.';

  return (
    <div
      data-kind={value.kind}
      aria-busy={refreshing || undefined}
      className={cx(styles.panel, className)}
      {...props}
    >
      <div className={styles.panelHeader}>
        <p className={styles.panelTitle}>{value.source || 'Usage'}</p>
        <p className={styles.panelSubtitle}>{subtitle}</p>
        {value.message && value.kind !== 'metered' && (
          <p className={styles.panelMessage}>{value.message}</p>
        )}
      </div>

      {value.blocked && (
        <Callout tone="danger" className={styles.blocked}>
          You&rsquo;ve reached your limit.{' '}
          {until != null
            ? `Sending works again ${formatResetIn(until, current)} (${formatResetAt(until, current, locale, timeZone)}).`
            : 'Sending works again when it resets.'}
        </Callout>
      )}

      {value.kind === 'plan' && (value.windows.length > 0 || value.extra?.enabled) && (
        <div className={styles.panelBody}>
          {value.windows.map((w) => (
            <UsageBar
              key={w.id}
              window={w}
              now={current}
              emphasis={w === lead}
              locale={locale}
              timeZone={timeZone}
            />
          ))}
          {value.extra?.enabled && <ExtraRow extra={value.extra} />}
        </div>
      )}

      {value.kind === 'metered' && (
        <div className={styles.panelBody}>
          <div className={styles.spend}>
            <p className={styles.spendToday}>
              <span className={styles.spendAmount}>{formatMoney(value.spend.today)}</span>
              <span className={styles.spendUnit}>today</span>
            </p>
            <p className={styles.spendMonth}>{formatMoney(value.spend.month)} this month</p>
          </div>
          {value.spend.budget ? (
            <BudgetRow month={value.spend.month} budget={value.spend.budget} />
          ) : null}
          {onSetBudget && (
            <Button
              size="sm"
              variant="ghost"
              tone="accent"
              className={styles.budgetButton}
              onClick={onSetBudget}
            >
              {value.spend.budget ? 'Change budget' : 'Set a monthly budget'}
            </Button>
          )}
          {/* For pay-as-you-go the note is a footnote about the numbers, not a headline. */}
          {value.message && <p className={styles.hint}>{value.message}</p>}
        </div>
      )}

      <div className={styles.panelFooter}>
        <span className={styles.updated}>
          {refreshing ? 'Updating…' : `Updated ${formatUpdated(value.updatedAt, current)}`}
        </span>
        {footer}
        {onRefresh && (
          <IconButton
            label="Refresh usage"
            size="sm"
            className={styles.refresh}
            data-refreshing={refreshing || undefined}
            aria-busy={refreshing || undefined}
            onClick={() => {
              if (!refreshing) onRefresh();
            }}
          >
            <RotateCw />
          </IconButton>
        )}
      </div>
    </div>
  );
}

function BudgetRow({ month, budget }: { month: number; budget: number }) {
  const spent = (month / budget) * 100;
  const left = budget - month;
  const over = left < 0;
  const severity = over ? 'exhausted' : usageSeverityFor(spent);
  const reading = over ? `${formatMoney(-left)} over` : `${formatMoney(left)} left`;
  return (
    <UsageGauge
      label="Monthly budget"
      reading={reading}
      percentLeft={percentLeft(spent)}
      severity={severity}
      caption={
        over
          ? `${formatMoney(month)} of ${formatMoney(budget)} · Conch won't stop you`
          : `${formatMoney(month)} of ${formatMoney(budget)} spent this month`
      }
      valueText={`${reading} of ${formatMoney(budget)}`}
    />
  );
}

function ExtraRow({ extra }: { extra: NonNullable<UsageValue['extra']> }) {
  const money = (n: number) => formatMoney(n, extra.currency);
  if (extra.used == null) {
    return (
      <UsageGauge
        label="Extra usage"
        reading="On"
        severity="normal"
        caption="Kicks in if a limit runs out"
        valueText="On"
      />
    );
  }
  if (!extra.limit) {
    return (
      <UsageGauge
        label="Extra usage"
        reading={`${money(extra.used)} this month`}
        severity="normal"
        caption="No monthly cap"
        valueText={`${money(extra.used)} this month`}
      />
    );
  }
  const spent = (extra.used / extra.limit) * 100;
  const left = Math.max(0, extra.limit - extra.used);
  return (
    <UsageGauge
      label="Extra usage"
      reading={`${money(left)} left`}
      percentLeft={percentLeft(spent)}
      severity={usageSeverityFor(spent)}
      caption={`${money(extra.used)} of ${money(extra.limit)} this month`}
      valueText={`${money(left)} left of ${money(extra.limit)}`}
    />
  );
}
