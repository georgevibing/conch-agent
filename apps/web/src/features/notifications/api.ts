import { PushStatus, type PushPrefsPatch, type PushSubscriptionJson } from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

/** Notifications on your devices (ADR 0027). */
export const pushApi = {
  status: () => request(PushStatus, '/api/push'),
  subscribe: (subscription: PushSubscriptionJson, prefs?: PushPrefsPatch) =>
    request(PushStatus, '/api/push/subscriptions', {
      method: 'POST',
      body: { subscription, ...(prefs && { prefs }) },
    }),
  update: (id: string, prefs: PushPrefsPatch) =>
    request(PushStatus, `/api/push/subscriptions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { prefs },
    }),
  remove: (id: string) =>
    request(PushStatus, `/api/push/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  test: () =>
    request(z.object({ sent: z.number() }), '/api/push/test', { method: 'POST', body: {} }),
};

export const pushKeys = {
  status: ['push'] as const,
  /** Whether this browser still holds a subscription made with Conch's key. */
  here: (publicKey: string) => ['push', 'here', publicKey] as const,
};
