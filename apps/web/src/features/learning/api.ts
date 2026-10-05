import { LearnedEntry, LearningSpending, LearningStatus } from '@conch/protocol';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { request } from '../../api/client';

/** Quiet learning (ADR 0088): what Conch learned from your chats, and your answers. */
export const learningApi = {
  status: () => request(LearningStatus, '/api/learning'),
  /** Keep, Undo or Forget one thing learned; `seen`, the words you saw when you answered. */
  answer: (entryId: string, answer: 'keep' | 'undo' | 'dismiss', seen?: string) =>
    request(LearnedEntry, '/api/learning/answer', {
      method: 'POST',
      body: { entryId, answer, ...(seen && { seen }) },
    }),
  /** What learning may spend a month; `null`: no limit. */
  setSpending: (limitUsd: number | null) =>
    request(LearningSpending, '/api/learning/spending', { method: 'PUT', body: { limitUsd } }),
  /** Don't learn from this chat, or learn from it again. */
  quiet: (conversationId: string, quiet: boolean) =>
    request(
      z.object({ quiet: z.boolean() }),
      `/api/learning/chats/${encodeURIComponent(conversationId)}`,
      { method: 'PUT', body: { quiet } },
    ),
  /** Let Conch learn something again. */
  removeNever: (id: string) =>
    request(z.object({ removed: z.boolean() }), '/api/learning/never/remove', {
      method: 'POST',
      body: { id },
    }),
  /** Got it, on the week's recap. */
  seeRecap: () =>
    request(z.object({ ok: z.boolean() }), '/api/learning/recap/seen', {
      method: 'POST',
      body: {},
    }),
};

/** Everything under `learning`, so `learning.changed` refreshes it all. */
export const learningKeys = { all: ['learning'] as const };

export function useLearning() {
  return useQuery({ queryKey: learningKeys.all, queryFn: learningApi.status });
}
