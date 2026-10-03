import { Paperclip, Reply } from 'lucide-react';

import { cx } from '../../utils/cx';
import { useNow } from '../Usage/useNow';
import {
  count,
  outside,
  ShowAll,
  useShowAll,
  ViewFrame,
  webLink,
  type ViewFrameProps,
} from './shared';
import { fullWhen, shortWhen, type WhenOptions } from './time';
import styles from './ToolViews.module.css';

/** One email, as a mail tool found it. Mirrors `MailItem` in `@conch/protocol`. */
export interface MailMessage {
  from: string;
  subject: string;
  snippet?: string;
  /** ISO date-time it arrived. */
  date: string;
  unread?: boolean;
  attachments?: boolean;
  url?: string;
}

export interface MailListProps extends Omit<ViewFrameProps, 'label' | 'heading'>, WhenOptions {
  messages: MailMessage[];
  /**
   * Shows a quiet **Reply** on each row. It never sends: the app puts words
   * for the assistant in the composer.
   */
  onReply?: (message: MailMessage) => void;
  /** "Emails": what it's called for screen readers. */
  label?: string;
}

/**
 * Emails a search found (ADR 0055): who, what about, a line of what it says,
 * and when, with a dot for unread and a clip for attachments. A row opens the
 * email in a new tab. Everything is plain text.
 */
export function MailList({
  messages,
  onReply,
  label = 'Emails',
  now: nowProp,
  locale,
  timeZone,
  className,
  ...props
}: MailListProps) {
  const now = useNow(60_000, nowProp);
  const options: WhenOptions = { now, locale, timeZone };
  const { folded, showAll, limit } = useShowAll(messages.length);
  const shown = folded ? messages.slice(0, limit) : messages;
  return (
    <ViewFrame
      label={`${label}, ${count(messages.length, 'email')}`}
      className={cx(styles.mail, className)}
      data-replies={onReply ? '' : undefined}
      {...props}
    >
      {messages.length === 0 ? (
        <p className={styles.empty}>No emails found.</p>
      ) : (
        <ul className={styles.rows}>
          {shown.map((m, i) => {
            const url = webLink(m.url);
            const inner = (
              <>
                <span className={styles.mailTop}>
                  <span className={styles.unread} data-unread={m.unread || undefined} aria-hidden />
                  {m.unread && <span className="nc-visually-hidden">Unread, </span>}
                  <span className={styles.sender}>{m.from}</span>
                  {m.attachments && (
                    <Paperclip className={styles.clip} role="img" aria-label="Has attachments" />
                  )}
                  <time className={styles.date} dateTime={m.date} title={fullWhen(m.date, options)}>
                    {shortWhen(m.date, options)}
                  </time>
                </span>
                <span className={styles.mailLine}>
                  <span className={styles.subject}>{m.subject}</span>
                  {m.snippet && (
                    <>
                      <span aria-hidden> – </span>
                      <span className={styles.snippet}>{m.snippet}</span>
                    </>
                  )}
                </span>
              </>
            );
            return (
              <li
                key={`${m.date}${i}`}
                className={styles.mailRow}
                data-unread={m.unread || undefined}
              >
                {url ? (
                  <a className={styles.rowLink} href={url} {...outside} data-lustre="">
                    {inner}
                  </a>
                ) : (
                  <span className={styles.rowLink}>{inner}</span>
                )}
                {onReply && (
                  <button
                    type="button"
                    className={styles.reply}
                    onClick={() => onReply(m)}
                    aria-label={`Reply to ${m.from}`}
                  >
                    <Reply aria-hidden />
                    <span aria-hidden>Reply</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {folded && <ShowAll onClick={showAll}>Show all {count(messages.length, 'email')}</ShowAll>}
    </ViewFrame>
  );
}

/** The words **Reply** puts in the composer: a request to the assistant, never a sent email. */
export function replyRequest(message: Pick<MailMessage, 'from' | 'subject'>): string {
  return `Draft a reply to ${message.from} about “${message.subject}”`;
}
