import {
  ChatLearningBody,
  ForgetPastBody,
  LearningAnswerBody,
  LearningSpendingBody,
  NeverRemoveBody,
} from '@conch/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { mintConsent, type PersonConsent } from '../memory/consent';
import type { MemoryStore } from '../memory/store';
import type { QuietLearning } from './service';
import type { LearningSpend } from './spend';

/**
 * Quiet learning (ADR 0088), under `/api`, behind the gateway's host, origin
 * and sign-in checks. Everything here is a person's answer: Keep, Undo,
 * Forget, "Don't learn from this chat", what learning may spend, letting
 * something be learned again. No tool the assistant has reaches any of it.
 */
export function registerQuietLearningRoutes(
  app: FastifyInstance,
  deps: { learning: QuietLearning; spend: LearningSpend; memory: MemoryStore },
): void {
  const { learning, spend, memory } = deps;
  const bad = (reply: FastifyReply, message: string | undefined) =>
    reply.code(400).send({ error: 'bad-request', message: message ?? 'That isn’t right.' });

  app.get('/api/learning', () => learning.status());

  app.post('/api/learning/answer', async (request, reply) => {
    const body = LearningAnswerBody.safeParse(request.body);
    if (!body.success) return bad(reply, body.error.issues[0]?.message);
    const { entryId, answer, seen } = body.data;
    // Keep on something that waits is a person's answer for the words they saw
    // (ADR 0087): minted here, for that memory and those words, good once.
    let consent: PersonConsent | undefined;
    if (answer === 'keep') {
      const waiting = await learning.store.entry(entryId);
      if (waiting?.state === 'waiting') {
        if (!seen) return bad(reply, 'Say which words you’re keeping.');
        consent = mintConsent(request, 'keep', { id: waiting.after.id, content: seen });
      }
    }
    const entry = await learning.answer(entryId, answer, consent);
    if (!entry)
      return reply
        .code(404)
        .send({ error: 'not-found', message: 'That isn’t in what Conch learned any more.' });
    if (entry === 'changed')
      return reply.code(409).send({
        error: 'changed',
        message: 'Those words changed since you saw them. Have a look again first.',
      });
    if (entry === 'needs-anyway')
      return reply.code(409).send({
        error: 'needs-anyway',
        message:
          'The memory check refused this one. If you’re sure, keep it from What Conch knows about you.',
      });
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

  // What used to be true is yours to forget too: only Conch's copy goes, nothing live.
  app.post('/api/learning/past/forget', async (request, reply) => {
    const body = ForgetPastBody.safeParse(request.body);
    if (!body.success) return bad(reply, body.error.issues[0]?.message);
    const forgotten = await memory.forgetPast(body.data.id);
    if (forgotten) learning.pastChanged();
    return { forgotten };
  });

  app.post('/api/learning/recap/seen', async () => {
    await learning.seeRecap();
    return { ok: true };
  });
}
