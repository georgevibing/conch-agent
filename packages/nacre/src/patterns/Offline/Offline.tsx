import { ArrowLeftRight, Check, CloudOff, Laptop, WifiOff } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import styles from './Offline.module.css';

export interface OfflineNoticeProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The model on this computer that answers while you're offline, by name. */
  local?: string;
  /** One thing to offer (e.g. "Answer with Ollama" when it's ready but not switched on). */
  action?: { label: string; onClick: () => void };
}

/**
 * A slim line above the composer while the internet is gone. It never blocks
 * typing or sending: it says what will happen to what you send.
 */
export function OfflineNotice({ local, action, className, ...props }: OfflineNoticeProps) {
  return (
    <div role="status" className={cx(styles.notice, className)} {...props}>
      <span className={styles.noticeIcon} aria-hidden>
        <WifiOff />
      </span>
      <span className={styles.noticeText}>
        <strong className={styles.noticeTitle}>You’re offline.</strong>{' '}
        {local
          ? `${local} answers from this computer until you’re back.`
          : 'Messages wait here, and go by themselves when you’re back.'}
      </span>
      {action && (
        <Button size="sm" variant="ghost" className={styles.noticeAction} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export interface WaitingMessageProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** `waiting` until it goes; `sent` once it went by itself. */
  state?: 'waiting' | 'sent';
  /** How many messages are waiting together (they go as one). */
  count?: number;
  /** The model on this computer can answer now instead of waiting. */
  local?: { label: string; onAnswer: () => void; busy?: boolean };
}

/**
 * A message that's waiting for the internet, in the conversation where the
 * reply would be. Calm, not an error: nothing went wrong, and nothing is lost.
 * Once it goes, it shrinks to a quiet line saying so.
 */
export function WaitingMessage({
  state = 'waiting',
  count = 1,
  local,
  className,
  ...props
}: WaitingMessageProps) {
  if (state === 'sent') {
    return (
      <div role="note" className={cx(styles.sent, className)} {...props}>
        <Check aria-hidden />
        <span>{count > 1 ? 'Sent together' : 'Sent'} when you were back online</span>
      </div>
    );
  }
  return (
    <div role="status" className={cx(styles.waiting, className)} {...props}>
      <span className={styles.waitingIcon} aria-hidden>
        <CloudOff />
      </span>
      <div className={styles.waitingWords}>
        <p className={styles.waitingTitle}>Waiting for the internet</p>
        <p className={styles.waitingBody}>
          {count > 1 ? `Your ${count} messages go together` : 'Your message goes by itself'} the
          moment you’re back.
        </p>
      </div>
      {local && (
        <Button
          size="sm"
          variant="surface"
          className={styles.waitingAction}
          leadingIcon={<Laptop />}
          loading={local.busy}
          onClick={local.onAnswer}
        >
          Answer now with {local.label}
        </Button>
      )}
    </div>
  );
}

export interface RoutedNoteProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Why another provider answered: offline (the model on this computer) or a usage limit. */
  reason: 'offline' | 'limit';
  /** One sentence, e.g. "Claude reached its limit until 15:00, so OpenRouter answered." */
  children: ReactNode;
  /** Where to change it (e.g. the setting that chose it). */
  action?: { label: string; onClick: () => void };
}

/** A quiet line where another provider answered for this chat's own, saying why. */
export function RoutedNote({ reason, children, action, className, ...props }: RoutedNoteProps) {
  const Icon = reason === 'offline' ? Laptop : ArrowLeftRight;
  return (
    <div role="note" data-reason={reason} className={cx(styles.routed, className)} {...props}>
      <span className={styles.routedIcon} aria-hidden>
        <Icon />
      </span>
      <span>{children}</span>
      {action && (
        <button type="button" className={styles.routedLink} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
