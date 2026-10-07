import { type ConversationSummary, type Task } from '@conch/protocol';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { api } from '../../api/client';
import { keys } from '../../api/queries';
import { going, useTasks } from './queries';

/** Finished tasks are news this long at most; older ones never light up. */
export const FRESH_MS = 12 * 60 * 60 * 1000;

/**
 * A task that finished and you haven't looked at since (ADR 0033). Seen is
 * its own chat's `seenAt` (ADR 0089), so it's one answer on every device:
 * anything after you last had that chat open is new to you. A task that never
 * got a chat is seen once its parent chat was open after it finished.
 */
export function isTaskFresh(
  task: Task,
  conversations: readonly ConversationSummary[] | undefined,
  now = Date.now(),
): boolean {
  if (going(task) || !task.finishedAt || now - task.finishedAt > FRESH_MS) return false;
  const own = task.conversationId && conversations?.find((c) => c.id === task.conversationId);
  // As `isUnread`, whatever the chat's state: one that didn't finish is news too.
  if (own) return own.seenAt !== undefined && own.updatedAt > own.seenAt;
  const parent = conversations?.find((c) => c.id === task.parentConversationId);
  return parent?.seenAt !== undefined && parent.seenAt < task.finishedAt;
}

/**
 * The chats as the list has them, for asking what's new: read where it's
 * already known, never fetched again because a row came into view (that
 * would undo what the list just did to a chat, before the gateway has it).
 */
export function useKnownConversations() {
  return useQuery({ queryKey: keys.conversations, queryFn: api.conversations, enabled: false })
    .data;
}

/**
 * You've seen what it did: here at once, on your other devices once the
 * gateway has it. For wherever a task's result is in front of you — its own
 * chat, its sheet, the chat it came back to.
 */
export function seeTask(client: QueryClient, task: Task) {
  const id = task.conversationId ?? task.parentConversationId;
  if (!id) return;
  client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
    list?.map((c) => (c.id === id ? { ...c, seenAt: Math.max(Date.now(), c.updatedAt) } : c)),
  );
  void api.seeConversation(id).catch(() => undefined);
}

/**
 * The chat in front of you shows its tasks' results on their cards, or is a
 * task's own chat: what finished there is seen, as it finishes or when you
 * come back to it (one that didn't finish too, which `useSeen` leaves). Only
 * while the window is really in front of you, like `useSeen`.
 */
export function useSeenTasks(chatId: string | undefined) {
  const client = useQueryClient();
  const conversations = useKnownConversations();
  const { data } = useTasks();
  const fresh = (data?.tasks ?? []).filter(
    (t) =>
      Boolean(chatId) &&
      (t.parentConversationId === chatId || t.conversationId === chatId) &&
      isTaskFresh(t, conversations),
  );
  const key = fresh.map((t) => t.id).join(' ');

  useEffect(() => {
    if (!key) return;
    const see = () => {
      if (document.visibilityState !== 'visible') return;
      for (const task of fresh) seeTask(client, task);
    };
    see();
    document.addEventListener('visibilitychange', see);
    return () => document.removeEventListener('visibilitychange', see);
    // `fresh` is what `key` names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);
}
