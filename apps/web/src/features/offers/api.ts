import { type AcceptOfferBody, DismissOfferBody } from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

/** Taken: carrying on started now, waits for the reply in front of it, or had already. */
const Accepted = z.object({
  ok: z.literal(true),
  state: z.enum(['started', 'queued', 'done']),
});

const Ok = z.object({ ok: z.boolean() });

const path = (conversationId: string, offerId: string, what: 'accept' | 'dismiss') =>
  `/api/conversations/${encodeURIComponent(conversationId)}/offers/${encodeURIComponent(offerId)}/${what}`;

/** Offers in a chat (ADR 0060). */
export const offersApi = {
  /** It's on now: the chat carries on with the request, once. */
  accept: (conversationId: string, offerId: string, body: AcceptOfferBody = {}) =>
    request(Accepted, path(conversationId, offerId, 'accept'), { method: 'POST', body }),
  /** “Not now”, for this chat. */
  dismiss: (conversationId: string, offerId: string) =>
    request(Ok, path(conversationId, offerId, 'dismiss'), {
      method: 'POST',
      body: DismissOfferBody.parse({}),
    }),
};
