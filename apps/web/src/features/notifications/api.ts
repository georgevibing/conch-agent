import {
  PushAnswerResult,
  PushApproval,
  PushStatus,
  type PushPrefsPatch,
  type PushSubscriptionJson,
} from '@conch/protocol';
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
  /** What the approval sheet shows before it's answered (ADR 0108). */
  approval: (conversationId: string, permissionId: string) =>
    request(
      PushApproval,
      `/api/push/approvals/${encodeURIComponent(conversationId)}/${encodeURIComponent(permissionId)}`,
    ),
  /** The approval sheet's answer; a step that matters asks to confirm it's you first. */
  answer: (conversationId: string, permissionId: string, decision: 'allow' | 'deny') =>
    request(PushAnswerResult, '/api/push/answer', {
      method: 'POST',
      body: { conversationId, permissionId, decision },
    }),
};

export const pushKeys = {
  status: ['push'] as const,
  /** Whether this browser still holds a subscription made with Conch's key. */
  here: (publicKey: string) => ['push', 'here', publicKey] as const,
};
