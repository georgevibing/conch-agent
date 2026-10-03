import { History, MessageSquareText } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Highlight, type HighlightRange } from '../../components/Highlight';
import { cx } from '../../utils/cx';
import { ToolCall } from '../ToolCall';
import styles from './PastChats.module.css';

export interface PastChatLineView {
  /** Where in its chat the line is: what opening it lands on. */
  id: string;
  /** Who said it, as a person reads it: “You”, the assistant's name, “Someone else”. */
  who: string;
  text: string;
  /** The words that matched, to mark. */
  ranges?: readonly HighlightRange[];
}

export interface PastChatView {
  id: string;
  title: string;
  /** When it was last active, as a person says it: “3 days ago”. */
  when?: string;
  archived?: boolean;
  /** Where it happened, when not in Conch itself: “Telegram”, “a routine”. */
  from?: string;
  lines: PastChatLineView[];
}

export interface PastChatsListProps extends Omit<ComponentProps<'ul'>, 'children'> {
  chats: PastChatView[];
  /** Open the chat at that line (or at its first line, from the title). */
  onOpen?: (chat: PastChatView, line?: PastChatLineView) => void;
}

/**
 * The chats it found, best first, each with the lines that matched. The
 * title opens the chat at its first match; each line opens it at that line.
 */
export function PastChatsList({ chats, onOpen, className, ...props }: PastChatsListProps) {
  return (
    <ul aria-label="Chats it found" className={cx(styles.list, className)} {...props}>
      {chats.map((chat) => {
        const meta = [chat.from, chat.archived ? 'Archived' : undefined, chat.when].filter(Boolean);
        return (
          <li key={chat.id} className={styles.chat}>
            <button
              type="button"
              className={styles.title}
              onClick={() => onOpen?.(chat, chat.lines[0])}
            >
              <MessageSquareText aria-hidden className={styles.icon} />
              <span className={styles.titleText}>{chat.title}</span>
              {meta.length > 0 && <span className={styles.meta}>{meta.join(' · ')}</span>}
            </button>
            {chat.lines.length > 0 && (
              <ul className={styles.lines} aria-label={`In ${chat.title}`}>
                {chat.lines.map((line) => (
                  <li key={line.id}>
                    <button
                      type="button"
                      className={styles.line}
                      onClick={() => onOpen?.(chat, line)}
                    >
                      <span className={styles.who}>{line.who}</span>
                      <span className={styles.text}>
                        {line.ranges?.length ? (
                          <Highlight text={line.text} ranges={line.ranges} />
                        ) : (
                          line.text
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export interface PastChatsLookProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** `search`: it looked for `query`; `read`: it read part of the one chat in `chats`. */
  action: 'search' | 'read';
  query?: string;
  /** Nothing matched exactly; these are close. */
  close?: boolean;
  chats: PastChatView[];
  onOpen?: (chat: PastChatView, line?: PastChatLineView) => void;
  defaultOpen?: boolean;
}

/**
 * Your assistant looked through your other chats (ADR 0059), said the way a
 * person would: “Looked through your chats · “venue” · 2 chats”. Opened, it
 * shows where it looked, and every line is a way back to that moment.
 */
export function PastChatsLook({
  action,
  query,
  close,
  chats,
  onOpen,
  defaultOpen,
  ...props
}: PastChatsLookProps) {
  const read = action === 'read';
  const count = chats.length;
  const summary = read
    ? (chats[0]?.title ?? 'an earlier chat')
    : `“${query ?? ''}” · ${
        count === 0
          ? 'nothing found'
          : `${count} ${count === 1 ? 'chat' : 'chats'}${close ? ', close matches' : ''}`
      }`;
  return (
    <ToolCall
      name={read ? 'Read your chat' : 'Looked through your chats'}
      icon={read ? MessageSquareText : History}
      summary={summary}
      status="success"
      defaultOpen={defaultOpen}
      {...props}
    >
      {count > 0 ? <PastChatsList chats={chats} onOpen={onOpen} /> : undefined}
    </ToolCall>
  );
}
