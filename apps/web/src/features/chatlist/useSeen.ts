import { isUnread, type ConversationSummary } from '@conch/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { api } from '../../api/client';
import { keys, useConversations } from '../../api/queries';

/**
 * The chat you have open is never new to you (ADR 0089): when something lands
 * in it while you're looking — a reply finishing, a message from a chat app —
 * it's marked seen, here and on your other devices. Only while the window is
 * really in front of you; a chat that finished in a background tab stays new.
 */
export function useSeen(conversationId: string | undefined) {
  const client = useQueryClient();
  const chat = useConversations().data?.find((c) => c.id === conversationId);
  const unread = chat ? isUnread(chat) : false;

  useEffect(() => {
    if (!conversationId || !unread) return;
    const see = () => {
      if (document.visibilityState !== 'visible') return;
      // Gone at once here; the gateway's word follows.
      client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
        list?.map((c) => (c.id === conversationId ? { ...c, seenAt: Date.now() } : c)),
      );
      void api.seeConversation(conversationId).catch(() => undefined);
    };
    see();
    document.addEventListener('visibilitychange', see);
    return () => document.removeEventListener('visibilitychange', see);
  }, [client, conversationId, unread]);
}
