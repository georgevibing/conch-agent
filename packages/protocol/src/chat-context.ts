/**
 * What a chat's model is told to keep in mind, besides the conversation:
 * where its memory of the chat starts (`/clear`, and Undo), and the chat's
 * goal (`/goal`). Both are read from the chat's own log, so the gateway, a
 * reload and every device agree, whichever provider answers.
 */
import { z } from 'zod';

import type { ConversationEvent } from './index';

/** A goal is a sentence or two, not a document: it's in every turn's context. */
export const MAX_GOAL_LENGTH = 500;

/** What the chat is for, in the person's words. */
export const ChatGoal = z.string().trim().min(1).max(MAX_GOAL_LENGTH);
export type ChatGoal = z.infer<typeof ChatGoal>;

/** `/goal <text>` sets it; `/goal clear` (`null`) takes it away. */
export const SetGoalBody = z.object({ goal: ChatGoal.nullable() }).strict();
export type SetGoalBody = z.infer<typeof SetGoalBody>;

/** `/clear`, and its Undo: what happened, in one sentence to show. */
export const ClearResult = z.object({
  /** Whether the model's memory of the chat now starts somewhere else. */
  changed: z.boolean(),
  message: z.string(),
});
export type ClearResult = z.infer<typeof ClearResult>;

/** The clears still in force, oldest first: each Undo takes back the newest. */
function clears(events: readonly ConversationEvent[], beforeSeq: number): number[] {
  const stack: number[] = [];
  for (const event of events) {
    if (event.seq >= beforeSeq) break;
    if (event.type === 'context.cleared') stack.push(event.seq);
    else if (event.type === 'context.restored' && stack.at(-1) === event.clearedSeq) stack.pop();
  }
  return stack;
}

/**
 * Where the model's memory of the chat starts: the `context.cleared` that
 * counts (its seq), or -1 when nothing was cleared. Everything before it is
 * still in the chat for the person; no provider is handed it again.
 */
export function contextStart(
  events: readonly ConversationEvent[],
  beforeSeq = Number.POSITIVE_INFINITY,
): number {
  return clears(events, beforeSeq).at(-1) ?? -1;
}

/**
 * The clear that Undo can still take back: the newest one, while nothing has
 * been sent since (after that, a provider already started afresh).
 */
export function undoableClear(events: readonly ConversationEvent[]): number | undefined {
  const at = contextStart(events);
  if (at < 0) return undefined;
  const sent = events.some((e) => e.seq > at && e.type === 'user.message');
  return sent ? undefined : at;
}

/** The chat's goal as it stands, if it has one. */
export function chatGoal(events: readonly ConversationEvent[]): string | undefined {
  const last = events.findLast((e) => e.type === 'goal');
  return last?.type === 'goal' ? (last.goal ?? undefined) : undefined;
}
