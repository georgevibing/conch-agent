import { ChevronRight, X } from 'lucide-react';
import type { ComponentProps } from 'react';

import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import {
  formatLeft,
  formatMoney,
  formatResetAt,
  formatResetIn,
  headline,
  windowPhrase,
} from './format';
import type { UsageValue } from './types';
import styles from './Usage.module.css';
import { UsageRing } from './UsageRing';
import { useNow } from './useNow';

export interface UsageNoticeProps extends Omit<ComponentProps<'div'>, 'children'> {
  value: UsageValue;
  now?: number;
  /** Makes the notice a button that opens the usage details. */
  onOpen?: () => void;
  onDismiss?: () => void;
  /**
   * Who answers while this one is at its limit (Settings: "At a usage limit"),
   * by name. Said only once the limit is reached.
   */
  carryOn?: string;
  locale?: string;
  timeZone?: string;
}

/** Sentence for the notice, or `undefined` when there's nothing worth saying. */
export function usageNoticeText(
  value: UsageValue,
  now: number,
  locale?: string,
  timeZone?: string,
): string | undefined {
  if (value.kind === 'unknown') return undefined;
  const head = headline(value);
  if (head.severity === 'normal' && !value.blocked) return undefined;
  const w = head.window;

  if (value.kind === 'plan') {
    const phrase = w ? windowPhrase(w, { limit: true }) : 'limit';
    if (value.blocked || head.severity === 'exhausted') {
      const until = value.blocked?.until ?? w?.resetsAt;
      const tail =
        until != null
          ? ` · resets ${formatResetIn(until, now)} (${formatResetAt(until, now, locale, timeZone)})`
          : '';
      return `You've reached your ${phrase}${tail}`;
    }
    if (!w) return undefined;
    const left = formatLeft(w.usedPercent).replace(' left', '');
    const tail = w.resetsAt != null ? ` · resets ${formatResetIn(w.resetsAt, now)}` : '';
    return `${left} of your ${windowPhrase(w)} left${tail}`;
  }

  const { budget, month } = value.spend;
  if (value.blocked) {
    const until = value.blocked.until;
    return `${value.source} is refusing requests for now${
      until != null ? ` · try again ${formatResetIn(until, now)}` : ''
    }`;
  }
  if (!budget) return undefined;
  const left = budget - month;
  return left < 0
    ? `You're ${formatMoney(-left)} over your ${formatMoney(budget)} monthly budget`
    : `${formatMoney(left)} left of your ${formatMoney(budget)} monthly budget`;
}

/**
 * A slim line above the composer that appears only when a limit is close.
 * Announced politely; opens the details when `onOpen` is given.
 */
export function UsageNotice({
  value,
  now,
  onOpen,
  onDismiss,
  carryOn,
  locale,
  timeZone,
  className,
  ...props
}: UsageNoticeProps) {
  const current = useNow(30_000, now);
  const said = usageNoticeText(value, current, locale, timeZone);
  if (!said) return null;
  const head = headline(value);
  const severity = value.blocked ? 'exhausted' : head.severity;
  // At the limit with someone to carry on, the question is answered anyway: say by whom.
  const text =
    carryOn && severity === 'exhausted' ? `${said} · ${carryOn} answers until then` : said;

  const content = (
    <>
      <UsageRing percentLeft={head.percentLeft} severity={severity} size={14} />
      <span className={styles.noticeText}>{text}</span>
    </>
  );

  return (
    <div role="status" data-severity={severity} className={cx(styles.notice, className)} {...props}>
      {onOpen ? (
        <button type="button" className={styles.noticeMain} onClick={onOpen}>
          {content}
          <span className={styles.noticeMore}>
            Details
            <ChevronRight aria-hidden />
          </span>
        </button>
      ) : (
        <span className={styles.noticeMain}>{content}</span>
      )}
      {onDismiss && (
        <IconButton
          label="Dismiss"
          size="sm"
          tooltip={false}
          className={styles.noticeDismiss}
          onClick={onDismiss}
        >
          <X />
        </IconButton>
      )}
    </div>
  );
}
