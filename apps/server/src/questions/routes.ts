import { AnswerQuestionBody } from '@conch/protocol';
import type { FastifyInstance } from 'fastify';

import { QuestionError, type QuestionDesk } from './desk';

const STATUS = { 'not-found': 404, answered: 409, invalid: 400 } as const;

/**
 * The answer to a question the assistant asked (ADR 0060 §4), from the card
 * on any device. `null` skips it. Under `/api`, behind the gateway's host,
 * origin and sign-in checks; the answer is checked against the question's
 * fields before the assistant sees it.
 */
export function registerQuestionRoutes(app: FastifyInstance, desk: QuestionDesk): void {
  app.post<{ Params: { id: string; questionId: string } }>(
    '/api/conversations/:id/questions/:questionId/answer',
    async (request, reply) => {
      const body = AnswerQuestionBody.safeParse(request.body);
      if (!body.success)
        return reply
          .code(400)
          .send({ error: 'bad-request', message: 'That answer couldn’t be read.' });
      try {
        desk.answer(request.params.id, request.params.questionId, body.data.answer);
        return { ok: true };
      } catch (error) {
        if (error instanceof QuestionError)
          return reply.code(STATUS[error.code]).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );
}
