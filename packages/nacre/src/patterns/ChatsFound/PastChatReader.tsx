import { History } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { Message } from '../Message/Message';
import type { ProviderId } from '../ModelPicker/ProviderLogo';
import { ChatSourceMark } from './ChatsFound';
import styles from './ChatsFound.module.css';

export interface PastChatReaderMessage {
  id: string;
  from: 'user' | 'assistant';
  /** Its words, drawn (the app passes its Markdown). */
  children: ReactNode;
  at?: Date | string;
}

export interface PastChatReaderProps extends Omit<ComponentProps<'article'>, 'title'> {
  title: ReactNode;
  /** The app it's from: “Claude Code”. */
  source: string;
  logo?: ProviderId;
  /** The quiet line under the title: “shop · 3 March 2026 · 24 messages”. */
  meta?: ReactNode;
  messages: PastChatReaderMessage[];
  /** Above the first message: “Show earlier messages”. */
  earlier?: ReactNode;
  /** What to do with it: Carry on here. */
  action?: ReactNode;
  /** Beside the action, a sentence: who carries it on. */
  note?: ReactNode;
}

/**
 * A past chat from another app, to read (ADR 0111): its mark and title, a
 * quiet line saying it's read-only and where it's from, the conversation as
 * Conch draws any chat, and one press to carry it on here.
 */
export function PastChatReader({
  title,
  source,
  logo,
  meta,
  messages,
  earlier,
  action,
  note,
  className,
  ...props
}: PastChatReaderProps) {
  return (
    <article className={cx(styles.past, className)} {...props}>
      <header className={styles.pastHead}>
        <ChatSourceMark label={source} {...(logo && { logo })} />
        <div className={styles.pastTitles}>
          <h2 className={styles.pastTitle}>{title}</h2>
          {meta && <p className={styles.pastMeta}>{meta}</p>}
        </div>
      </header>
      <p className={styles.readOnly}>
        <History aria-hidden />A past chat from {source}, kept to read and search. It can’t change
        anything.
      </p>
      <div className={styles.pastLog} role="log" aria-label={`Past chat from ${source}`}>
        {earlier}
        {messages.map((m, i) => (
          <Message
            key={m.id}
            from={m.from}
            speaker={m.from === 'assistant' ? { name: source } : undefined}
            continued={messages[i - 1]?.from === m.from}
            {...(m.at && { timestamp: m.at })}
            entrance={false}
          >
            {m.children}
          </Message>
        ))}
      </div>
      {(action || note) && (
        <footer className={styles.pastFoot}>
          {note && <p className={styles.pastNote}>{note}</p>}
          {action}
        </footer>
      )}
    </article>
  );
}
