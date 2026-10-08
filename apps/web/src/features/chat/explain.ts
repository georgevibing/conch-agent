import { ExplainStepResult } from '@conch/protocol';

import { request } from '../../api/client';

/**
 * "Why?" on a step (ADR 0103): one to three sentences from the chat's log,
 * or why there's no one to ask. Only reads; the work doesn't stop for it.
 */
export function explainStep(conversationId: string, toolUseId: string) {
  return request(
    ExplainStepResult,
    `/api/conversations/${encodeURIComponent(conversationId)}/explain`,
    { method: 'POST', body: { toolUseId } },
  );
}
