import { CreateTaskBody } from '@conch/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { TaskError, type TaskService } from './service';

const STATUS = { 'not-found': 404, invalid: 400, busy: 409 } as const;

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof TaskError)
    return reply.code(STATUS[error.code]).send({ error: error.code, message: error.message });
  throw error;
}

/**
 * Background tasks (ADR 0033). Under `/api`, behind the gateway's host,
 * origin and sign-in checks. A task runs with exactly the powers of the chat
 * it was sent from: nothing here grants more, so nothing asks for more than
 * the page already has.
 */
export function registerTaskRoutes(app: FastifyInstance, tasks: TaskService): void {
  app.get('/api/tasks', () => tasks.list());
  app.post('/api/tasks', async (request, reply) => {
    const body = CreateTaskBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: body.error.issues[0]?.message });
    try {
      return await tasks.create({
        kind: 'background',
        text: body.data.text,
        ...(body.data.title && { title: body.data.title }),
        ...(body.data.conversationId && { parentConversationId: body.data.conversationId }),
        ...(body.data.options && { options: body.data.options }),
      });
    } catch (error) {
      return fail(reply, error);
    }
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/stop', async (request, reply) => {
    try {
      return await tasks.stop(request.params.id);
    } catch (error) {
      return fail(reply, error);
    }
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/retry', async (request, reply) => {
    try {
      return await tasks.retry(request.params.id);
    } catch (error) {
      return fail(reply, error);
    }
  });
  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    try {
      await tasks.remove(request.params.id);
      return { ok: true };
    } catch (error) {
      return fail(reply, error);
    }
  });
}
