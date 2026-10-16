import { ChatMessageActionBody } from '@conch/protocol';
import type { FastifyInstance } from 'fastify';

import type { TogetherService } from './service';

/**
 * Pass on, or dismiss, a message another of your chats sent to one that holds
 * them (ADR 0134). Under `/api`, behind the gateway's host, origin and sign-in
 * checks: only a person's press gets a held message through.
 */
export function registerTogetherRoutes(app: FastifyInstance, together: TogetherService): void {
  app.post<{ Params: { id: string; messageId: string } }>(
    '/api/conversations/:id/messages/:messageId',
    async (request, reply) => {
      const body = ChatMessageActionBody.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ error: 'bad-request', message: 'That couldn’t be read.' });
      const { id, messageId } = request.params;
      const done = await together.messages?.act(id, messageId, body.data.action);
      if (!done)
        return reply
          .code(404)
          .send({ error: 'not-found', message: 'That message isn’t waiting any more.' });
      return { ok: true };
    },
  );
}
