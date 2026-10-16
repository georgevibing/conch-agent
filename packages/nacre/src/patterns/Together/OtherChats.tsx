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
        const meta = [chat.words, chat.sameFolder ? 'Same folder' : undefined, chat.from].filter(
          Boolean,
        );
        return (
          <li key={chat.id}>
            <button type="button" className={styles.row} onClick={() => onOpen?.(chat)}>
              <OtherChatMark state={chat.state} />
              <span className={styles.title}>
                {chat.title}
                <span className="nc-visually-hidden">, {STATE_WORDS[chat.state]}</span>
              </span>
              <span className={styles.meta}>{meta.join(META_SEP)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export interface OtherChatsLookProps extends Omit<ComponentProps<'div'>, 'children'> {
  chats: OtherChatView[];
  onOpen?: (chat: OtherChatView) => void;
  defaultOpen?: boolean;
}

/** “2 working · 1 needs you”, or “Nothing else going on”. */
export function otherChatsSummary(chats: readonly Pick<OtherChatView, 'state'>[]): string {
  if (!chats.length) return 'Nothing else going on';
  const count = (state: OtherChatState) => chats.filter((c) => c.state === state).length;
  const working = count('working');
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
export function OtherChatsLook({ chats, onOpen, defaultOpen, ...props }: OtherChatsLookProps) {
  return (
    <ToolCall
      name="Checked on your other chats"
      icon={chats.some((c) => c.state === 'working') ? Layers : MessageSquareText}
      summary={otherChatsSummary(chats)}
      status="success"
      defaultOpen={defaultOpen}
      {...props}
    >
      {chats.length > 0 ? <OtherChatsList chats={chats} onOpen={onOpen} /> : undefined}
    </ToolCall>
  );
}
