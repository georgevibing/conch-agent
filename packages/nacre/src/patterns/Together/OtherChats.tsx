import { Layers, MessageSquareText } from 'lucide-react';
import type { ComponentProps } from 'react';

import { META_SEP } from '../../components/MetaList';
import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import { ToolCall } from '../ToolCall';
import styles from './Together.module.css';

/** Where one of your other chats is: working, needs you, done for now, or didn't finish. */
export type OtherChatState = 'working' | 'needs-you' | 'idle' | 'stopped';

export interface OtherChatView {
  id: string;
  title: string;
  state: OtherChatState;
  /** What it's doing, in a few words, while working: “Editing files”. */
  words: string;
  /** It works in the same folder as the chat that looked. */
  sameFolder?: boolean;
  /** The last few files it changed there, newest last: the one fact that matters most. */
  changing?: readonly string[];
  /** Where it came from, when not a chat you started: “a task”, “Telegram”. */
  from?: string;
}

/** What a screen reader hears for each state, after the chat's title. */
const STATE_WORDS: Record<OtherChatState, string> = {
  working: 'working',
  'needs-you': 'needs you',
  idle: 'done for now',
  stopped: 'didn’t finish',
};

/** A chat's state as a small mark: the working pearl, an amber call, a ring, a quiet dot. */
export function OtherChatMark({ state }: { state: OtherChatState }) {
  return (
    <span aria-hidden className={styles.mark} data-state={state}>
      {state === 'working' && <Pearl size="xs" state="thinking" label={null} />}
    </span>
  );
}

export interface OtherChatsListProps extends Omit<ComponentProps<'ul'>, 'children'> {
  chats: OtherChatView[];
  onOpen?: (chat: OtherChatView) => void;
}

/** Your other chats, busiest first: each opens where it is. */
export function OtherChatsList({ chats, onOpen, className, ...props }: OtherChatsListProps) {
  return (
    <ul aria-label="Your other chats" className={cx(styles.list, className)} {...props}>
      {chats.map((chat) => {
        const meta = [
          chat.changing?.length ? changingWords(chat.changing) : chat.words,
          chat.sameFolder ? 'Same folder' : undefined,
          chat.from,
        ].filter(Boolean);
        return (
          <li key={chat.id}>
            <button type="button" className={styles.row} onClick={() => onOpen?.(chat)}>
              <OtherChatMark state={chat.state} />
              <span className={styles.title}>
                {chat.title}
                {/* The words after it say the rest; only “working” needs saying first. */}
                {chat.state === 'working' && (
                  <span className="nc-visually-hidden">, {STATE_WORDS.working}</span>
                )}
              </span>
              <span className={styles.meta}>{meta.join(META_SEP)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** “Changing auth.ts”, “Changing auth.ts +2”: the newest file, and how many more. */
export function changingWords(files: readonly string[]): string {
  const last = files.at(-1) ?? '';
  const name = last.split('/').at(-1) || last;
  return files.length > 1 ? `Changing ${name} +${files.length - 1}` : `Changing ${name}`;
}

export interface OtherChatsLookProps extends Omit<ComponentProps<'div'>, 'children'> {
  chats: OtherChatView[];
  /** How many were working, all told, when that's more than the list shows. */
  working?: number;
  onOpen?: (chat: OtherChatView) => void;
  defaultOpen?: boolean;
}

/** “2 working · 1 needs you”, or “Nothing else going on”. */
export function otherChatsSummary(
  chats: readonly Pick<OtherChatView, 'state'>[],
  allWorking?: number,
): string {
  const count = (state: OtherChatState) => chats.filter((c) => c.state === state).length;
  const working = Math.max(count('working'), allWorking ?? 0);
  if (!chats.length && !working) return 'Nothing else going on';
  const needs = count('needs-you');
  const parts = [
    working ? `${working} working` : undefined,
    needs ? `${needs} ${needs === 1 ? 'needs' : 'need'} you` : undefined,
  ].filter(Boolean);
  return parts.length
    ? parts.join(META_SEP)
    : `${chats.length} ${chats.length === 1 ? 'chat' : 'chats'}, none busy`;
}

/**
 * Your assistant checked on your other chats (ADR 0134): one quiet line that
 * says how many are busy. Opened, each chat is a row with its state, and
 * pressing it opens that chat.
 */
export function OtherChatsLook({
  chats,
  working,
  onOpen,
  defaultOpen,
  ...props
}: OtherChatsLookProps) {
  if (!chats.length && !working) return null;
  return (
    <ToolCall
      name="Checked on your other chats"
      icon={chats.some((c) => c.state === 'working') ? Layers : MessageSquareText}
      summary={otherChatsSummary(chats, working)}
      status="success"
      defaultOpen={defaultOpen}
      {...props}
    >
      {chats.length > 0 ? <OtherChatsList chats={chats} onOpen={onOpen} /> : undefined}
    </ToolCall>
  );
}
