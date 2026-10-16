import type { ChatMessageActionBody } from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });

/** A message another of your chats sent to one that holds them (ADR 0134): pass it on, or not. */
export const togetherApi = {
  act: (conversationId: string, messageId: string, action: ChatMessageActionBody['action']) =>
    request(
      Ok,
      `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
      { method: 'POST', body: { action } satisfies ChatMessageActionBody },
    ),
};
