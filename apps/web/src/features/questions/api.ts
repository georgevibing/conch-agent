import type { AnswerQuestionBody } from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });

/** Questions the assistant asked in a chat (ADR 0055 §4). */
export const questionsApi = {
  /** Answer one, or skip it with `null`. Conch checks the answer and words it itself. */
  answer: (conversationId: string, questionId: string, answer: AnswerQuestionBody['answer']) =>
    request(
      Ok,
      `/api/conversations/${encodeURIComponent(conversationId)}/questions/${encodeURIComponent(questionId)}/answer`,
      { method: 'POST', body: { answer } satisfies AnswerQuestionBody },
    ),
};
