import {
  ChatLearningBody,
  LearningAnswerBody,
  LearningSpendingBody,
  NeverRemoveBody,
} from '@conch/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';

import type { QuietLearning } from './service';
import type { LearningSpend } from './spend';

/**
 * Quiet learning (ADR 0087), under `/api`, behind the gateway's host, origin
 * and sign-in checks. Everything here is a person's answer: Keep, Undo,
 * Forget, "Don't learn from this chat", what learning may spend, letting
 * something be learned again. No tool the assistant has reaches any of it.
 */
export function registerQuietLearningRoutes(
  app: FastifyInstance,
  deps: { learning: QuietLearning; spend: LearningSpend },
): void {
  const { learning, spend } = deps;
  const bad = (reply: FastifyReply, message: string | undefined) =>
    reply.code(400).send({ error: 'bad-request', message: message ?? 'That isn’t right.' });

  app.get('/api/learning', () => learning.status());

  app.post('/api/learning/answer', async (request, reply) => {
    const body = LearningAnswerBody.safeParse(request.body);
    if (!body.success) return bad(reply, body.error.issues[0]?.message);
    const entry = await learning.answer(body.data.entryId, body.data.answer);
    if (!entry)
      return reply
        .code(404)
        .send({ error: 'not-found', message: 'That isn’t in what Conch learned any more.' });
    return entry;
  });

  app.put('/api/learning/spending', async (request, reply) => {
    const body = LearningSpendingBody.safeParse(request.body);
    if (!body.success) return bad(reply, body.error.issues[0]?.message);
    return spend.setLimit(body.data.limitUsd);
  });

  app.put<{ Params: { id: string } }>('/api/learning/chats/:id', async (request, reply) => {
    const body = ChatLearningBody.safeParse(request.body);
    if (!body.success) return bad(reply, body.error.issues[0]?.message);
    if (!/^[\w-]{1,128}$/.test(request.params.id)) return bad(reply, 'That isn’t a chat.');
    await learning.quiet(request.params.id, body.data.quiet);
    return { quiet: body.data.quiet };
  });

  app.post('/api/learning/never/remove', async (request, reply) => {
    const body = NeverRemoveBody.safeParse(request.body);
    if (!body.success) return bad(reply, body.error.issues[0]?.message);
    return { removed: await learning.removeNever(body.data.id) };
  });

  app.post('/api/learning/recap/seen', async () => {
    await learning.seeRecap();
    return { ok: true };
  });
}
