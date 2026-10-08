import { PastChatId, RunChatImportBody } from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Gatekeeper } from '../../security';
import { ChatImportError, type ChatImportService } from './service';

const STATUS = { 'not-found': 404, busy: 409, nothing: 400 } as const;

/**
 * Your past chats from other apps (ADR 0111). Looking and bringing them in
 * need only the page's sign-in: they're read-only words, and grant nothing.
 * Taking them all out again removes things, so it needs a recent password
 * or key (sudo mode).
 */
export function registerChatImportRoutes(
  app: FastifyInstance,
  chats: ChatImportService,
  gate: Gatekeeper,
): void {
  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof ChatImportError)
      return reply
        .code(STATUS[error.code])
        .send({ error: `chats-${error.code}`, message: error.message });
    throw error;
  };
  const verify = (request: FastifyRequest, reply: FastifyReply) => {
    if (gate.verified(request.access)) return true;
    void reply
      .code(403)
      .send({ error: 'verify-required', message: 'Confirm it’s you to take them out.' });
    return false;
  };
  const id = (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const parsed = PastChatId.safeParse(request.params.id);
    if (parsed.success) return parsed.data;
    void reply.code(404).send({ error: 'not-found', message: 'No such past chat.' });
    return undefined;
  };

  app.get('/api/import/chats', () => chats.status());

  // Starts bringing them in and answers at once: the status says how it's going.
  app.post('/api/import/chats', async (request, reply) => {
    const body = RunChatImportBody.safeParse(request.body ?? {});
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: body.error.issues[0]?.message });
    // Failures are the run's own (a file that won't read is skipped and counted).
    chats.start(body.data.sources).catch(() => undefined);
    return reply.code(202).send(await chats.status());
  });

  app.delete('/api/import/chats', async (request, reply) => {
    if (!verify(request, reply)) return;
    try {
      return { removed: await chats.removeAll() };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/past-chats', () => chats.list());

  app.get<{ Params: { id: string } }>('/api/past-chats/:id', async (request, reply) => {
    const chat = id(request, reply);
    if (!chat) return;
    const detail = await chats.detail(chat);
    if (!detail) return reply.code(404).send({ error: 'not-found', message: 'No such past chat.' });
    return detail;
  });

  app.post<{ Params: { id: string } }>('/api/past-chats/:id/continue', async (request, reply) => {
    const chat = id(request, reply);
    if (!chat) return;
    try {
      return { conversationId: await chats.carryOn(chat) };
    } catch (error) {
      return fail(reply, error);
    }
  });
}
