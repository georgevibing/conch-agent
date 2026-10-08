import {
  ArrowUpRight,
  ChevronDown,
  CornerUpLeft,
  Paperclip,
  PenLine,
  RotateCcw,
  Send,
} from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { FileTile } from '../FileMaking';
import { webLink, outside } from '../ToolViews/shared';
import { fullWhen, shortWhen, type WhenOptions } from '../ToolViews/time';
import { useNow } from '../Usage/useNow';
import styles from './Mail.module.css';
import { peopleWords, personOf, type MailAttachment, type MailPerson } from './people';
import { RecipientField } from './Recipients';
import { Stamp } from './Stamp';

/**
 * How it went: `sending` (on its way), `sent` (Gmail took it), `draft`
 * (waiting in Drafts, not sent), `uncertain` (Gmail may have it: look before
 * sending again), `failed` (nothing went).
 */
export type MailSentState = 'sending' | 'sent' | 'draft' | 'uncertain' | 'failed';

export interface MailSentProps extends WhenOptions {
  state: MailSentState;
  /** The account it went from. */
  from?: string;
  to: readonly (string | MailPerson)[];
  cc?: readonly (string | MailPerson)[];
  subject: string;
  /** What it said (or the start of it, with `clipped`). */
  body?: string;
  clipped?: boolean;
  /** When it went (ISO). */
  at?: string;
  /** Where Gmail keeps it: the sent email, the draft, or (uncertain) the Sent folder. */
  url?: string;
  reply?: boolean;
  /** The person changed it before it went. */
  edited?: boolean;
  files?: readonly MailAttachment[];
  /** Why it didn't go, in a sentence (failed). */
  reason?: string;
  /** It happened just now, in front of the person: the postmark lands. History is still. */
  arriving?: boolean;
  /** **Follow up**: words for the composer, never an email. */
  onFollowUp?: () => void;
  /** **Send it now**, for a draft: words for the composer. */
  onSendDraft?: () => void;
  /** **Try again**, after one that didn't go: words for the composer. */
  onRetry?: () => void;
  className?: string;
}

/**
 * An email that went, as a letter that went (ADR 0060), never as a row in an
 * inbox: a stamp, postmarked; "Sent to Maya Kim" with the time; the subject;
 * the first lines of what it said, opening to all of it and to everyone it
 * went to, addresses in full; and the next step — **Open in Gmail**,
 * **Follow up**. A draft is the same letter kept, not posted. One that may
 * have gone says so and points at Sent; there's never an undo that Gmail
 * doesn't have, nor a "sent" it didn't confirm.
 */
export function MailSent({
  state,
  from,
  to,
  cc = [],
  subject,
  body,
  clipped,
  at,
  url,
  reply,
  edited,
  files = [],
  reason,
  arriving,
  onFollowUp,
  onSendDraft,
  onRetry,
  now: nowProp,
  locale,
  timeZone,
  className,
}: MailSentProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const now = useNow(60_000, nowProp);
  const people = to.map(personOf);
  const copied = cc.map(personOf);
  const link = webLink(url);
  const who = peopleWords(people);
  const preview = body?.replace(/\s+/g, ' ').trim();

  const title =
    state === 'sending'
      ? `Sending to ${who}…`
      : state === 'sent'
        ? `${reply ? 'Replied to' : 'Sent to'} ${who}`
        : state === 'draft'
          ? `Draft saved for ${who}`
          : state === 'uncertain'
            ? 'Gmail may have sent this'
            : `Didn’t send to ${who}`;
  const line =
    state === 'uncertain'
      ? 'Look in Sent before sending it again.'
      : state === 'failed'
        ? (reason ?? 'Nothing was sent.')
        : state === 'draft'
          ? 'In your Drafts · not sent'
          : undefined;
  // Every address, once the title names anyone or counts them; one bare address is the title.
  const addresses =
    people.length > 1 || people.some((p) => p.name) ? people.map((p) => p.address) : [];

  return (
    <section
      aria-label={`${title}: ${subject || 'no subject'}`}
      aria-busy={state === 'sending' || undefined}
      className={cx(styles.card, styles.sent, className)}
      data-state={state}
      data-arriving={arriving || undefined}
      data-lustre=""
    >
      <header className={styles.head}>
        <Stamp state={state} arriving={arriving} />
        <div className={styles.headText}>
          <p className={styles.title}>
            <span>{title}</span>
            {at && state !== 'sending' && (
              <>
                <span className={styles.dot} aria-hidden>
                  ·
                </span>
                <time
                  className={styles.when}
                  dateTime={at}
                  title={fullWhen(at, { locale, timeZone })}
                >
                  {shortWhen(at, { now, locale, timeZone })}
                </time>
              </>
            )}
          </p>
          {line && <p className={styles.line}>{line}</p>}
          {state !== 'sending' && (
            <p className={cx(styles.meta, styles.sentMeta)}>
              {addresses.length > 0 && (
                <span className={styles.sentTo}>{addresses.join(', ')}</span>
              )}
              {from && (
                <span className={styles.from}>
                  <span className={styles.metaLabel}>from</span>
                  <span className={styles.fromAddress}>{from}</span>
                </span>
              )}
              {reply && (
                <span className={styles.badge}>
                  <CornerUpLeft aria-hidden />
                  In the thread
                </span>
              )}
              {edited && (
                <span className={styles.badge} data-tone="accent">
                  <PenLine aria-hidden />
                  Edited by you
                </span>
              )}
              {files.length > 0 && (
                <span className={styles.badge}>
                  <Paperclip aria-hidden />
                  {files.length === 1 ? '1 file' : `${files.length} files`}
                </span>
              )}
            </p>
          )}
          <p className={styles.subjectLine}>{subject || 'No subject'}</p>
          {state === 'sending' && <span className={styles.trail} aria-hidden />}
          {preview && state !== 'sending' && (
            <p className={styles.preview} data-hidden={open || undefined}>
              {preview}
            </p>
          )}
        </div>
      </header>

      {state !== 'sending' && (
        <>
          <div className={styles.more} id={`${id}-letter`} hidden={!open}>
            <div className={styles.moreInner}>
              <div className={styles.sheet}>
                <RecipientField label="To" people={people} />
                {copied.length > 0 && <RecipientField label="Cc" people={copied} />}
                <div className={styles.rule} aria-hidden />
                <div className={styles.body}>{body}</div>
                {clipped && <p className={styles.note}>The rest is in Gmail.</p>}
                {files.length > 0 && (
                  <ul className={styles.files} aria-label="Files">
                    {files.map((file) => (
                      <li key={file.name}>
                        <FileTile
                          name={file.name}
                          {...(file.mime && { mimeType: file.mime })}
                          {...(file.size !== undefined && { size: file.size })}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <footer className={styles.foot}>
            {body !== undefined && (
              <Button
                size="sm"
                variant="ghost"
                tone="neutral"
                className={styles.toggle}
                aria-expanded={open}
                aria-controls={`${id}-letter`}
                trailingIcon={<ChevronDown aria-hidden data-open={open || undefined} />}
                onClick={() => setOpen(!open)}
              >
                {open ? 'Hide the email' : 'Show the email'}
              </Button>
            )}
            <div className={styles.sentActions}>
              {link && (
                <Button
                  asChild
                  size="sm"
                  variant="ghost"
                  tone="neutral"
                  trailingIcon={<ArrowUpRight aria-hidden />}
                >
                  <a href={link} {...outside}>
                    {state === 'draft'
                      ? 'Open the draft in Gmail'
                      : state === 'uncertain'
                        ? 'Look in Sent'
                        : 'Open in Gmail'}
                  </a>
                </Button>
              )}
              {state === 'sent' && onFollowUp && (
                <Button
                  size="sm"
                  variant="surface"
                  leadingIcon={<CornerUpLeft aria-hidden />}
                  onClick={onFollowUp}
                >
                  Follow up
                </Button>
              )}
              {state === 'draft' && onSendDraft && (
                <Button
                  size="sm"
                  variant="surface"
                  leadingIcon={<Send aria-hidden />}
                  onClick={onSendDraft}
                >
                  Send it now
                </Button>
              )}
              {state === 'failed' && onRetry && (
                <Button
                  size="sm"
                  variant="surface"
                  leadingIcon={<RotateCcw aria-hidden />}
                  onClick={onRetry}
                >
                  Try again
                </Button>
              )}
            </div>
          </footer>
        </>
      )}
    </section>
  );
}
