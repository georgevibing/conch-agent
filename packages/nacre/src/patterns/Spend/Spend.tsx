import { ArrowLeftRight, Check, Coins, OctagonPause, TrendingUp, Wallet } from 'lucide-react';
import { useState, type ComponentProps, type FormEvent, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Input } from '../../components/Input';
import { Popover } from '../../components/Popover';
import { cx } from '../../utils/cx';
import { ComposerChip } from '../Composer';
import { formatMoney } from '../Usage/format';
import {
  chatShort,
  costDetail,
  costSentence,
  costShort,
  type ChatSpendValue,
  type TurnCostValue,
  type TurnTokens,
} from './format';
import styles from './Spend.module.css';

const usd = (amount: number, locale: string) => formatMoney(amount, 'USD', locale);

// ── One reply ────────────────────────────────────────────────────────────

export interface TurnCostTagProps extends Omit<ComponentProps<'button'>, 'children'> {
  cost: TurnCostValue;
  tokens?: TurnTokens;
  locale?: string;
}

/**
 * What one reply cost, among its actions: a quiet "$0.04" (or "Plan"), and the
 * detail a tap away — the cache's saving, the tokens, the plan's window.
 * Nothing at all for a reply on this computer, or one Conch can't price.
 */
export function TurnCostTag({
  cost,
  tokens,
  locale = 'en-US',
  className,
  ...props
}: TurnCostTagProps) {
  const short = costShort(cost, locale);
  if (!short) return null;
  const sentence = costSentence(cost, locale);
  const detail = costDetail(cost, tokens, locale);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={sentence}
          data-billing={cost.billing}
          className={cx(styles.tag, className)}
          {...props}
        >
          {short}
        </button>
      </Popover.Trigger>
      <Popover.Content side="top" align="start" padding="sm" className={styles.detail}>
        <p className={styles.detailLead}>{sentence}</p>
        {detail.length > 0 && (
          <ul className={styles.detailList}>
            {detail.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}

// ── The chat ─────────────────────────────────────────────────────────────

/** `null` = no limit; `undefined` = not an amount (yet). */
function parseAmount(text: string): number | null | undefined {
  if (text.trim() === '') return null;
  const amount = Number(text.replace(/[$,\s]/g, ''));
  return Number.isFinite(amount) && amount > 0 && amount <= 100_000 ? amount : undefined;
}

export interface ChatSpendChipProps {
  spend: ChatSpendValue;
  /** A person sets this chat's own limit (`null`: none). Absent: it can't be changed here. */
  onSetLimit?: (capUsd: number | null) => void | Promise<void>;
  busy?: boolean;
  /** Controlled open state (⌘K opens it). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  locale?: string;
}

/**
 * What this chat has spent, beside the model picker: a quiet chip ("$0.31",
 * "$0.31 of $2") that opens the detail — its tasks, the cache's saving — and
 * the one setting a chat has for money, a limit of its own.
 */
export function ChatSpendChip({
  spend,
  onSetLimit,
  busy,
  open,
  onOpenChange,
  locale = 'en-US',
}: ChatSpendChipProps) {
  const short = chatShort(spend, locale);
  const near = spend.capUsd !== undefined && spend.usd >= spend.capUsd * 0.8;
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <ComposerChip
          icon={<Coins />}
          data-near={near || undefined}
          className={styles.chip}
          aria-label={`This chat has spent ${usd(spend.usd, locale)}${
            spend.capUsd ? ` of its ${usd(spend.capUsd, locale)} limit` : ''
          }. Details and limit`}
        >
          {short}
        </ComposerChip>
      </Popover.Trigger>
      <Popover.Content
        side="top"
        align="start"
        className={styles.panel}
        aria-label="What this chat spent"
      >
        <ChatSpendPanel spend={spend} onSetLimit={onSetLimit} busy={busy} locale={locale} />
      </Popover.Content>
    </Popover.Root>
  );
}

export interface ChatSpendPanelProps extends Omit<ComponentProps<'div'>, 'children'> {
  spend: ChatSpendValue;
  onSetLimit?: (capUsd: number | null) => void | Promise<void>;
  busy?: boolean;
  locale?: string;
}

/** The chip's detail: what was spent, by what, and the chat's own limit. */
export function ChatSpendPanel({
  spend,
  onSetLimit,
  busy,
  locale = 'en-US',
  className,
  ...props
}: ChatSpendPanelProps) {
  const [text, setText] = useState(spend.capUsd ? String(spend.capUsd) : '');
  const amount = parseAmount(text);
  const changed = amount !== undefined && amount !== (spend.capUsd ?? null);
  const lines: string[] = [];
  if (spend.tasksUsd && spend.tasksUsd >= 0.005)
    lines.push(`${usd(spend.tasksUsd, locale)} of it by tasks started from here`);
  if (spend.savedUsd && spend.savedUsd >= 0.005)
    lines.push(`Reading from the cache saved about ${usd(spend.savedUsd, locale)}`);
  if (spend.planTurns)
    lines.push(
      `${spend.planTurns} ${spend.planTurns === 1 ? 'reply' : 'replies'} on your plan, with nothing to pay`,
    );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (changed && amount !== undefined) void onSetLimit?.(amount);
  };
  return (
    <div className={cx(styles.panelBody, className)} {...props}>
      <div>
        <p className={styles.panelTitle}>This chat has spent {usd(spend.usd, locale)}</p>
        {lines.length > 0 && (
          <ul className={styles.detailList}>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>
      {onSetLimit && (
        <form className={styles.limit} onSubmit={submit}>
          <Field invalid={amount === undefined}>
            <Field.Label>Limit for this chat</Field.Label>
            <Input
              size="sm"
              inputMode="decimal"
              leading="$"
              placeholder="No limit"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            {amount === undefined ? (
              <Field.Error>Enter an amount above zero, like 2.</Field.Error>
            ) : (
              <Field.Description>
                At the limit, the chat asks before spending more.
              </Field.Description>
            )}
          </Field>
          <Button size="sm" type="submit" disabled={!changed} loading={busy}>
            {amount === null && spend.capUsd ? 'Remove limit' : 'Set limit'}
          </Button>
        </form>
      )}
    </div>
  );
}

// ── At a limit ───────────────────────────────────────────────────────────

/** A model to carry on with: on this computer, on a plan, or cheaper (with a little more room). */
export interface SpendSwitch {
  label: string;
  provider?: string;
  why: 'local' | 'plan' | 'cheaper';
  allowUsd?: number;
}

export interface SpendLimitCardProps extends Omit<ComponentProps<'div'>, 'children' | 'title'> {
  /** The chat's own limit, or the monthly budget every chat shares. */
  limit: 'chat' | 'month';
  spentUsd: number;
  limitUsd: number;
  /** What "Raise" sets it to. */
  raiseTo: number;
  switchTo?: SpendSwitch;
  /** A reply stopped part way (it carries on), rather than a message that waits. */
  during?: boolean;
  /** `offer` while it waits; then how it went on. */
  state?: 'offer' | 'raised' | 'switched' | 'stopped';
  onRaise?: () => void;
  onSwitch?: () => void;
  onStop?: () => void;
  busy?: boolean;
  locale?: string;
}

/** "Use Gemma 3 on this computer", "Use Opus on Claude Code", "Use Haiku 4.5, up to $0.50 more". */
export function switchWords(to: SpendSwitch, locale = 'en-US'): string {
  if (to.why === 'local') return `Use ${to.label} on this computer`;
  if (to.why === 'plan') return `Use ${to.label}${to.provider ? ` on ${to.provider}` : ''}`;
  return `Use ${to.label}${to.allowUsd ? `, up to ${usd(to.allowUsd, locale)} more` : ''}`;
}

/**
 * A message (or a reply part way) met a spending limit (ADR 0079). One plain
 * sentence and the three choices that matter: raise it, carry on with a
 * model that costs less, or stop. Never a dead end, never an alarm; once
 * chosen, it folds to a quiet line.
 */
export function SpendLimitCard({
  limit,
  spentUsd,
  limitUsd,
  raiseTo,
  switchTo,
  during,
  state = 'offer',
  onRaise,
  onSwitch,
  onStop,
  busy,
  locale = 'en-US',
  className,
  ...props
}: SpendLimitCardProps) {
  if (state !== 'offer') {
    const Icon = state === 'switched' ? ArrowLeftRight : state === 'raised' ? Check : OctagonPause;
    const words =
      state === 'switched' && switchTo
        ? `Carried on with ${switchTo.label}`
        : state === 'raised'
          ? limit === 'chat'
            ? 'Raised this chat’s limit'
            : 'Raised the monthly budget'
          : limit === 'chat'
            ? 'Stopped at this chat’s limit'
            : 'Stopped at this month’s budget';
    return (
      <div role="note" data-state={state} className={cx(styles.settled, className)} {...props}>
        <Icon aria-hidden />
        <span>{words}</span>
      </div>
    );
  }
  const title =
    limit === 'chat'
      ? `This chat has reached its ${usd(limitUsd, locale)} limit`
      : `You’ve reached this month’s ${usd(limitUsd, locale)} budget`;
  const spent = usd(spentUsd, locale);
  const body = [
    limit === 'chat' ? `It has spent ${spent}.` : `Chats have spent ${spent} this month.`,
    during
      ? 'The reply stopped part way, and carries on when you choose.'
      : 'Your message is waiting.',
  ].join(' ');
  return (
    <div role="group" aria-label={title} className={cx(styles.card, className)} {...props}>
      <span className={styles.mark} aria-hidden>
        {limit === 'chat' ? <Wallet /> : <TrendingUp />}
      </span>
      <div className={styles.words}>
        <p className={styles.title}>{title}</p>
        <p className={styles.body}>{body}</p>
        <div className={styles.actions}>
          {onRaise && (
            <Button size="sm" onClick={onRaise} loading={busy}>
              Raise to {usd(raiseTo, locale)}
            </Button>
          )}
          {switchTo && onSwitch && (
            <Button
              size="sm"
              variant="surface"
              leadingIcon={<ArrowLeftRight />}
              disabled={busy}
              onClick={onSwitch}
            >
              {switchWords(switchTo, locale)}
            </Button>
          )}
          {onStop && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onStop}>
              Stop here
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── A word about money ───────────────────────────────────────────────────

export interface SpendNoteProps extends ComponentProps<'div'> {
  children: ReactNode;
}

/** A quiet line about money, said once when it matters: nearly at the budget, a pricier model. */
export function SpendNote({ children, className, ...props }: SpendNoteProps) {
  return (
    <div role="note" className={cx(styles.note, className)} {...props}>
      <span className={styles.noteIcon} aria-hidden>
        <Coins />
      </span>
      <span>{children}</span>
    </div>
  );
}
