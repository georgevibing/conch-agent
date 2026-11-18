import { ChevronRight, X } from 'lucide-react';
import type { ComponentProps } from 'react';

import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import { Button } from '../../components/Button';
import {
  blockedFor,
  formatLeft,
  formatMoney,
  formatResetAt,
  formatResetIn,
  formatResetInShort,
  headline,
  isModelScoped,
  otherModelsWindow,
  windowPhrase,
} from './format';
import type { UsageModel, UsageValue } from './types';
import styles from './Usage.module.css';
import { UsageRing } from './UsageRing';
import { useNow } from './useNow';

export interface UsageNoticeProps extends Omit<ComponentProps<'div'>, 'children'> {
  value: UsageValue;
  /**
   * The model the chat is on. A window for one model ("Fable") speaks only
   * when the chat is on it; otherwise the limits every model shares do.
   */
  model?: UsageModel;
  now?: number;
  /**
   * When the chat's model is near its own limit and other models have more
   * room, offers "Switch model".
   */
  onSwitchModel?: () => void;
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
  model?: UsageModel,
): string | undefined {
  if (value.kind === 'unknown') return undefined;
  const head = headline(value, model);

  if (value.kind === 'plan') {
    const blocked = blockedFor(value, model);
    if (head.severity === 'normal' && !blocked) return undefined;
    const w = head.window;
    const others = otherModelsWindow(value, model);
    const hint = others ? ` · other models have ${formatLeft(others.usedPercent)}` : '';
    const phrase = w ? windowPhrase(w, { limit: true }) : 'limit';
    if (blocked || head.severity === 'exhausted') {
      const until = (blocked ? value.blocked?.until : undefined) ?? w?.resetsAt;
      const tail =
        until != null
          ? ` · resets ${formatResetIn(until, now)} (${formatResetAt(until, now, locale, timeZone)})`
          : '';
      return `You've reached your ${phrase}${tail}${hint}`;
    }
    if (!w) return undefined;
    const left = formatLeft(w.usedPercent).replace(' left', '');
    const tail = w.resetsAt != null ? ` · resets ${formatResetIn(w.resetsAt, now)}` : '';
    return `${left} of your ${windowPhrase(w)} left${tail}${hint}`;
  }
  if (head.severity === 'normal' && !value.blocked) return undefined;

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
 * The same in a few words, for a narrow line (a phone): "4% left · resets in 23 h",
 * or "Fable: 1% left · resets in 7 h" for one model's own limit. Which limit
 * it is, and when exactly, are in the details.
 */
export function usageNoticeShortText(
  value: UsageValue,
  now: number,
  carryOn?: string,
  model?: UsageModel,
): string | undefined {
  if (value.kind === 'unknown') return undefined;
  const head = headline(value, model);

  if (value.kind === 'plan') {
    const blocked = blockedFor(value, model);
    if (head.severity === 'normal' && !blocked) return undefined;
    const w = head.window;
    // One model's own limit says whose: "Fable: 1% left", "Fable limit reached".
    const scope = w && isModelScoped(w) ? w.scope?.trim() : undefined;
    if (blocked || head.severity === 'exhausted') {
      const reached = scope ? `${scope} limit reached` : 'Limit reached';
      if (carryOn) return `${reached} · ${carryOn} answers`;
      const until = (blocked ? value.blocked?.until : undefined) ?? w?.resetsAt;
      return `${reached}${until != null ? ` · resets ${formatResetInShort(until, now)}` : ''}`;
    }
    if (!w) return undefined;
    const tail = w.resetsAt != null ? ` · resets ${formatResetInShort(w.resetsAt, now)}` : '';
    return `${scope ? `${scope}: ` : ''}${formatLeft(w.usedPercent)}${tail}`;
  }
  if (head.severity === 'normal' && !value.blocked) return undefined;

  const { budget, month } = value.spend;
  if (value.blocked) {
    const until = value.blocked.until;
    return `Paused${until != null ? ` · try again ${formatResetInShort(until, now)}` : ''}`;
  }
  if (!budget) return undefined;
  const left = budget - month;
  return left < 0
    ? `${formatMoney(-left)} over budget`
    : `${formatMoney(left)} of ${formatMoney(budget)} left`;
}

/**
 * A slim, quiet line above the composer that appears only when a limit is
 * close. Always one line: on a narrow composer it says it in a few words and
 * Details becomes its chevron. Announced politely; opens the details when
 * `onOpen` is given. When to show it again is the app's call.
 */
export function UsageNotice({
  value,
  model,
  now,
  onSwitchModel,
  onOpen,
  onDismiss,
  carryOn,
  locale,
  timeZone,
  className,
  ...props
}: UsageNoticeProps) {
  const current = useNow(30_000, now);
  const said = usageNoticeText(value, current, locale, timeZone, model);
  if (!said) return null;
  const head = headline(value, model);
  const blocked = value.kind === 'plan' ? blockedFor(value, model) : Boolean(value.blocked);
  const severity = blocked ? 'exhausted' : head.severity;
  // Only this model is short: another of the provider's models is the way on.
  const switchable = Boolean(onSwitchModel && otherModelsWindow(value, model));
  // At the limit with someone to carry on, the question is answered anyway: say by whom.
  const text =
    carryOn && severity === 'exhausted' ? `${said} · ${carryOn} answers until then` : said;
  const short = usageNoticeShortText(value, current, carryOn, model) ?? text;

  // Both are drawn; the line's own width picks one (a container query), so it
  // always fits on one line. The hidden one is out of the accessibility tree too.
  const content = (
    <>
      <UsageRing percentLeft={head.percentLeft} severity={severity} size={14} />
      <span className={styles.noticeText} data-length="long">
        {text}
      </span>
      <span className={styles.noticeText} data-length="short">
        {short}
      </span>
    </>
  );

  return (
    <div
      role="status"
      data-severity={severity}
      data-switchable={switchable || undefined}
      className={cx(styles.notice, className)}
      {...props}
    >
      {onOpen ? (
        <button type="button" className={styles.noticeMain} onClick={onOpen}>
          {content}
          <span className={styles.noticeMore}>
            <span className={styles.noticeMoreLabel}>Details</span>
            <ChevronRight aria-hidden />
          </span>
        </button>
      ) : (
        <span className={styles.noticeMain}>{content}</span>
      )}
      {switchable && (
        <Button size="sm" variant="ghost" className={styles.noticeAction} onClick={onSwitchModel}>
          Switch model
        </Button>
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
