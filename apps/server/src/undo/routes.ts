import { UndoBody } from '@conch/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { type z } from 'zod';

import { UndoError, type UndoService } from './service';

const PreviewBody = UndoBody.pick({ ids: true, direction: true });

/**
 * Undo (ADR 0030). Under `/api`, behind the gateway's host, origin and
 * sign-in checks. Putting files back changes nothing the person couldn't
 * have the assistant change, so it needs no more than a signed-in device;
 * it only ever writes where a change set says a file was.
 */
export function registerUndoRoutes(app: FastifyInstance, undo: UndoService): void {
  const fail = (reply: FastifyReply, error: unknown) => {
    if (!(error instanceof UndoError)) throw error;
    return reply
      .code(error.code === 'not-found' ? 404 : 410)
      .send({ error: `undo-${error.code}`, message: error.message });
  };
  const parse = <T extends z.ZodType>(schema: T, body: unknown, reply: FastifyReply) => {
    const parsed = schema.safeParse(body);
    if (parsed.success) return parsed.data as z.infer<T>;
    void reply.code(400).send({ error: 'bad-request', message: parsed.error.issues[0]?.message });
    return undefined;
  };

  app.get('/api/undo/latest', () => undo.latest());
  app.post('/api/undo/preview', async (request, reply) => {
    const body = parse(PreviewBody, request.body, reply);
    if (!body) return;
    try {
      return await undo.preview(body.ids, body.direction);
    } catch (error) {
      return fail(reply, error);
    }
  });
  app.post('/api/undo', async (request, reply) => {
    const body = parse(UndoBody, request.body, reply);
    if (!body) return;
    try {
      return await undo.apply(body.ids, body.direction, body.force);
    } catch (error) {
      return fail(reply, error);
    }
  });
}
