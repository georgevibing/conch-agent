import { WaitActionBody } from '@conch/protocol';
import type { FastifyInstance } from 'fastify';

import type { WaitService } from './service';

/**
 * Check now and Stop waiting, from a waiting row (ADR 0124). Under `/api`,
 * behind the gateway's host, origin and sign-in checks. Neither can start
 * anything: one looks sooner, the other ends the wait.
 */
export function registerWaitRoutes(app: FastifyInstance, waits: WaitService): void {
  app.post<{ Params: { id: string; waitId: string } }>(
    '/api/conversations/:id/waits/:waitId',
    async (request, reply) => {
      const body = WaitActionBody.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ error: 'bad-request', message: 'That couldn’t be read.' });
      const { id, waitId } = request.params;
      const found = body.data.action === 'check' ? waits.check(id, waitId) : waits.stop(id, waitId);
      if (!found)
        return reply
          .code(404)
          .send({ error: 'not-found', message: 'Conch isn’t waiting for that any more.' });
      return { ok: true };
    },
  );
}
