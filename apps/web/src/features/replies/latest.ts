import type { ConversationEvent, ReplySuggestion } from '@conch/protocol';

/** The replies to send next under the latest reply (ADR 0055), while they still belong there. */
export interface LatestReplies {
  /** The `replies` event's seq: one set of chips, once. */
  seq: number;
  at: number;
  by: 'assistant' | 'conch';
  replies: ReplySuggestion[];
}

/**
 * The chips after one more event. They belong to the latest turn, so they go
 * as soon as anything newer is in the chat: a message (from any device), a
 * new turn starting, a card. Only the chat's own bookkeeping as a turn closes
 * (going idle, a new title, the model's options, a notice) leaves them be.
 */
export function latestReplies(
  current: LatestReplies | undefined,
  event: ConversationEvent,
): LatestReplies | undefined {
  if (event.type === 'replies')
    return { seq: event.seq, at: event.at, by: event.by, replies: event.replies };
  if (!current) return undefined;
  switch (event.type) {
    case 'status':
      return event.status === 'idle' ? current : undefined;
    case 'title':
    case 'options':
    case 'notice':
      return current;
    default:
      return undefined;
  }
}
