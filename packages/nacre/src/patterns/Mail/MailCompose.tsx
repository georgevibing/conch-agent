import { ChevronDown, CornerUpLeft, PenLine, Send, ShieldAlert, Undo2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';

import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Kbd } from '../../components/Kbd';
import { Textarea } from '../../components/Textarea';
import { cx } from '../../utils/cx';
import { FileTile } from '../FileMaking';
import styles from './Mail.module.css';
import {
  peopleWords,
  personOf,
  samePeople,
  type MailAttachment,
  type MailChange,
  type MailPerson,
} from './people';
import { RecipientField } from './Recipients';
import { Stamp } from './Stamp';

/** Past this, the words fold behind **Show all**. */
const LONG_BODY = { chars: 700, lines: 12 };

export interface MailComposeProps {
  /** What approving does: send it, or save it to Drafts (and never send). */
  intent?: 'send' | 'draft';
  /** The account it goes from. */
  from?: string;
  to: readonly (string | MailPerson)[];
  cc?: readonly (string | MailPerson)[];
  subject: string;
  body: string;
  files?: readonly MailAttachment[];
  /** A reply in a thread: it goes to the thread's people with its subject. */
  reply?: boolean;
  /** The person may change it here before it goes (the gateway checks the change again). */
  editable?: boolean;
  /** Why to look twice, one quiet line: "This chat read email from outside." */
  caution?: ReactNode;
  /** `sending`: the answer is given and it's on its way — the letter folds and flies. */
  status?: 'asking' | 'sending';
  /** The answer on its way: which button waits. */
  busy?: 'send' | 'decline' | 'draft';
  /**
   * Send it (or save it). `change` is the email as the person changed it,
   * only when they did: exactly what they approve is what goes.
   */
  onSend?: (change?: MailChange) => void;
  onDecline?: () => void;
  /** Keep it in Gmail's Drafts instead of sending: the person writes it from there. */
  onDraftInstead?: () => void;
  /** The primary button, to focus when the card arrives. */
  sendRef?: Ref<HTMLButtonElement>;
  className?: string;
}

interface Letter {
  to: MailPerson[];
  cc: MailPerson[];
  subject: string;
  body: string;
}

const same = (a: Letter, b: Letter) =>
  a.subject === b.subject &&
  a.body === b.body &&
  samePeople(
    a.to.map((p) => p.address),
    b.to.map((p) => p.address),
  ) &&
  samePeople(
    a.cc.map((p) => p.address),
    b.cc.map((p) => p.address),
  );

/** Someone to send it to, and a subject on one line. */
const validLetter = (l: Letter) => l.to.length > 0 && !/[\r\n]/.test(l.subject);

/**
 * The email before it goes (ADR 0028, ADR 0099): a letter, not a form. Who
 * it's from, who it's for (names beside their addresses), the subject as its
 * headline and the words in reading type, exactly as they'll be sent. **Edit**
 * turns the same sheet into fields in place: chips to add and remove people,
 * the subject, the words. **Done** keeps the change and marks it; **Cancel**
 * or Esc puts it back. Send leads (⌘/Ctrl+Enter); Don't send is quiet. On
 * Send the letter folds away and the stamp's plane takes off; the sent card
 * that follows says how it went, never before it did.
 */
export function MailCompose({
  intent = 'send',
  from,
  to,
  cc = [],
  subject,
  body,
  files = [],
  reply,
  editable,
  caution,
  status = 'asking',
  busy,
  onSend,
  onDecline,
  onDraftInstead,
  sendRef,
  className,
}: MailComposeProps) {
  const original: Letter = { to: to.map(personOf), cc: cc.map(personOf), subject, body };
  const [kept, setKept] = useState<Letter>();
  const [working, setWorking] = useState<Letter>();
  const [open, setOpen] = useState(false);
  const [showCc, setShowCc] = useState(false);
  /** The letter being edited as of this moment: a field's change lands here before ⌘↵ reads it. */
  const latest = useRef<Letter | undefined>(undefined);
  const editButton = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLElement>(null);
  /** This render's key handler and send, for the listener on the card. */
  const keys = useRef<{
    onKeyDown: (event: globalThis.KeyboardEvent) => void;
    sendNow: () => void;
  }>({
    onKeyDown: () => undefined,
    sendNow: () => undefined,
  });
  const id = useId();

  const letter = working ?? kept ?? original;
  const editing = working !== undefined;
  const sending = status === 'sending';
  const answering = busy !== undefined || sending;
  const changed = kept !== undefined && !same(kept, original);
  const valid = validLetter(letter);
  const canEdit = Boolean(editable && onSend) && intent === 'send';
  const long =
    letter.body.length > LONG_BODY.chars || letter.body.split('\n').length > LONG_BODY.lines;

  const change = (next: Partial<Letter>) => {
    const now = { ...(latest.current ?? letter), ...next };
    latest.current = now;
    setWorking(now);
  };
  const startEditing = () => {
    const now = kept ?? original;
    latest.current = now;
    setWorking(now);
    setShowCc(now.cc.length > 0);
  };
  const cancel = () => {
    latest.current = undefined;
    setWorking(undefined);
    requestAnimationFrame(() => editButton.current?.focus());
  };
  const done = () => {
    const now = latest.current;
    if (!now || !validLetter(now)) return false;
    setKept(same(now, original) ? undefined : { ...now, subject: now.subject.trim() });
    latest.current = undefined;
    setWorking(undefined);
    return true;
  };
  const send = (final: Letter) => {
    if (answering || !validLetter(final)) return;
    const differs = !same(final, original);
    onSend?.(
      differs
        ? {
            to: final.to.map((p) => p.address),
            ...(final.cc.length && { cc: final.cc.map((p) => p.address) }),
            subject: final.subject.trim(),
            body: final.body,
          }
        : undefined,
    );
  };

  const sendNow = () => {
    const final = latest.current ?? kept ?? original;
    if (!validLetter(final)) return;
    if (latest.current) done();
    send(final);
  };
  const onKeyDown = (event: globalThis.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && onSend && !answering) {
      event.preventDefault();
      // A field adds what's typed in it first, in its own handler: send once that's done.
      setTimeout(() => keys.current.sendNow(), 0);
    } else if (event.key === 'Escape' && editing) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };
  // ⌘/Ctrl+Enter and Esc anywhere in the card: a shortcut for its buttons, never the only way.
  useEffect(() => {
    keys.current = { onKeyDown, sendNow };
  });
  useEffect(() => {
    const card = root.current;
    if (!card) return;
    const listen = (event: globalThis.KeyboardEvent) => keys.current.onKeyDown(event);
    card.addEventListener('keydown', listen);
    return () => card.removeEventListener('keydown', listen);
  }, []);

  const verb =
    intent === 'draft' ? 'Save this draft' : reply ? 'Send this reply' : 'Send this email';
  const title = sending
    ? `${intent === 'draft' ? 'Saving a draft for' : 'Sending to'} ${peopleWords(letter.to)}…`
    : editing
      ? `Editing the email`
      : `${verb}?`;
  const sendLabel = intent === 'draft' ? 'Save draft' : 'Send';

  return (
    <section
      role="group"
      aria-label={`${intent === 'draft' ? 'Draft' : 'Email'} to ${peopleWords(letter.to)}: ${letter.subject || 'no subject'}`}
      aria-busy={sending || undefined}
      className={cx(styles.card, styles.compose, className)}
      data-status={status}
      data-editing={editing || undefined}
      data-lustre=""
      ref={root}
    >
      <header className={styles.head}>
        <Stamp state={sending ? 'sending' : intent === 'draft' ? 'draft' : 'writing'} />
        <div className={styles.headText}>
          <p className={styles.title} aria-live="polite">
            {title}
          </p>
          {sending ? (
            <>
              <p className={styles.subjectLine}>{letter.subject || 'No subject'}</p>
              <span className={styles.trail} aria-hidden />
            </>
          ) : (
            <p className={styles.meta}>
              {from && (
                <span className={styles.from}>
                  <span className={styles.metaLabel}>From</span>
                  <Avatar name={from} size="xs" className={styles.fromFace} aria-hidden />
                  <span className={styles.fromAddress}>{from}</span>
                  <span className={styles.via}>Gmail</span>
                </span>
              )}
              {reply && (
                <span className={styles.badge}>
                  <CornerUpLeft aria-hidden />
                  In the thread
                </span>
              )}
              {changed && !editing && (
                <span className={styles.badge} data-tone="accent">
                  <PenLine aria-hidden />
                  Edited by you
                </span>
              )}
            </p>
          )}
        </div>
        {canEdit && !editing && !sending && (
          <Button
            ref={editButton}
            size="sm"
            variant="ghost"
            tone="neutral"
            className={styles.editButton}
            leadingIcon={<PenLine aria-hidden />}
            onClick={startEditing}
            disabled={answering}
          >
            Edit
          </Button>
        )}
      </header>

      <div className={styles.fold} data-folded={sending || undefined}>
        <div className={styles.foldInner}>
          <div className={styles.sheet} data-changed={changed || undefined}>
            <RecipientField
              label="To"
              people={letter.to}
              required
              {...(editing && { onChange: (people: MailPerson[]) => change({ to: people }) })}
              {...(reply && { locked: 'A reply goes to the people in the thread.' })}
            />
            {(letter.cc.length > 0 || (editing && showCc)) && (
              <RecipientField
                label="Cc"
                people={letter.cc}
                {...(editing && { onChange: (people: MailPerson[]) => change({ cc: people }) })}
              />
            )}
            {editing && !showCc && letter.cc.length === 0 && (
              <Button
                size="sm"
                variant="ghost"
                tone="neutral"
                className={styles.addCc}
                onClick={() => setShowCc(true)}
              >
                Add Cc
              </Button>
            )}
            <div className={styles.rule} aria-hidden />
            {editing ? (
              <div className={styles.editSubject}>
                <Input
                  aria-label="Subject"
                  value={letter.subject}
                  readOnly={reply}
                  onChange={(e) => change({ subject: e.target.value.replace(/[\r\n]+/g, ' ') })}
                  placeholder="Subject"
                  maxLength={500}
                  rootClassName={styles.subjectWell}
                />
              </div>
            ) : (
              <h3 className={styles.subject} id={`${id}-subject`}>
                {letter.subject || <span className={styles.none}>No subject</span>}
              </h3>
            )}
            {editing ? (
              <Textarea
                aria-label="Message"
                value={letter.body}
                onChange={(e) => change({ body: e.target.value })}
                minRows={6}
                maxRows={18}
                maxLength={100_000}
                rootClassName={styles.bodyWell}
                className={styles.bodyInput}
              />
            ) : (
              <>
                <div
                  className={styles.body}
                  id={`${id}-body`}
                  data-clamped={long && !open ? '' : undefined}
                >
                  {letter.body || <span className={styles.none}>No message</span>}
                </div>
                {long && (
                  <Button
                    size="sm"
                    variant="ghost"
                    tone="neutral"
                    className={styles.showAll}
                    aria-expanded={open}
                    aria-controls={`${id}-body`}
                    trailingIcon={<ChevronDown aria-hidden data-open={open || undefined} />}
                    onClick={() => setOpen(!open)}
                  >
                    {open ? 'Show less' : 'Show all of it'}
                  </Button>
                )}
              </>
            )}
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

          {intent === 'draft' && (
            <p className={styles.note}>
              Saved in Drafts only. Nothing is sent; you can change it there.
            </p>
          )}
          {caution && (
            <p className={styles.caution}>
              <ShieldAlert aria-hidden />
              <span>{caution}</span>
            </p>
          )}

          {editing ? (
            <div className={styles.actions}>
              <span className={styles.hint}>
                <Kbd keys={['Escape']} size="sm" /> to cancel
              </span>
              <Button size="sm" variant="ghost" tone="neutral" onClick={cancel}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="surface"
                disabled={!valid}
                onClick={() => {
                  if (done()) requestAnimationFrame(() => editButton.current?.focus());
                }}
              >
                Done
              </Button>
            </div>
          ) : (
            <div className={styles.actions}>
              {onDraftInstead && intent === 'send' && !changed && (
                <Button
                  size="sm"
                  variant="ghost"
                  tone="neutral"
                  className={styles.instead}
                  disabled={answering}
                  loading={busy === 'draft'}
                  onClick={onDraftInstead}
                >
                  Save as a draft instead
                </Button>
              )}
              {changed && (
                <Button
                  size="sm"
                  variant="ghost"
                  tone="neutral"
                  className={styles.instead}
                  leadingIcon={<Undo2 aria-hidden />}
                  disabled={answering}
                  onClick={() => setKept(undefined)}
                >
                  Undo my changes
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className={styles.decline}
                disabled={answering}
                loading={busy === 'decline'}
                onClick={onDecline}
              >
                {intent === 'draft' ? 'Don’t save' : 'Don’t send'}
              </Button>
              <Button
                ref={sendRef}
                size="sm"
                disabled={answering || !valid}
                loading={busy === 'send' && !sending}
                leadingIcon={intent === 'send' ? <Send aria-hidden /> : undefined}
                trailing={<Kbd keys="mod+enter" size="sm" inverse />}
                onClick={() => send(letter)}
                aria-keyshortcuts="Meta+Enter Control+Enter"
              >
                {sendLabel}
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
