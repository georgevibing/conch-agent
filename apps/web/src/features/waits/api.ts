import type { WaitActionBody } from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });

/** What a chat waits for (ADR 0124): look sooner, or stop waiting. */
export const waitsApi = {
  act: (conversationId: string, waitId: string, action: WaitActionBody['action']) =>
    request(
      Ok,
      `/api/conversations/${encodeURIComponent(conversationId)}/waits/${encodeURIComponent(waitId)}`,
      { method: 'POST', body: { action } satisfies WaitActionBody },
    ),
};
