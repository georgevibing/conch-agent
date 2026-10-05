import type { LearnedEntry, LearnedItem } from '@conch/protocol';
import type { LearnedStateName, LearnedThing, LearnedWhyInfo } from '@conch/nacre';

import { relativeTime } from '../../lib/time';

/** Why? — from the record: the chat, your words, what Conch noticed, the model. */
export function whyOf(entry: LearnedEntry, openChat?: (id: string) => void): LearnedWhyInfo {
  const { from } = entry;
  const chat = from.conversationId;
  return {
    ...(from.chatTitle && { chat: from.chatTitle }),
    when: relativeTime(entry.at),
    quotes: from.quotes,
    signals: from.signals,
    ...(from.model && { model: from.model.model ?? from.model.engine }),
    ...(entry.waits && { waits: entry.waits }),
    ...(chat && openChat && { onOpenChat: () => openChat(chat) }),
  };
}

/** One thing from the record, as the Memory page shows it. */
export function thingOf(entry: LearnedEntry, openChat?: (id: string) => void): LearnedThing {
  return {
    id: entry.id,
    text: entry.after.content,
    ...(entry.before && { was: entry.before.content }),
    state: entry.state,
    ...(entry.waits && { waits: entry.waits }),
    why: whyOf(entry, openChat),
  };
}

/**
 * One line of a chat's "Learned 2 things": what the chat's log says, what
 * you answered since, and Why? when the record still has it.
 */
export function thingFromChat(
  item: LearnedItem,
  known: {
    /** What you just pressed here. */
    pressed?: LearnedStateName;
    /** What the chat's log says you answered. */
    decided?: LearnedStateName;
    entry?: LearnedEntry;
  },
): LearnedThing {
  const { pressed, decided, entry } = known;
  // What you just pressed; then the record (an answer from the Memory page); then the chat's log.
  const state: LearnedStateName = pressed ?? entry?.state ?? decided ?? item.state;
  return {
    id: item.entryId,
    text: entry?.after.content ?? item.text,
    ...(item.was && { was: item.was }),
    state,
    ...(item.waits && { waits: item.waits }),
    ...(entry && { why: whyOf(entry) }),
  };
}
