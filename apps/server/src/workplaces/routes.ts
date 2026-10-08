import { SetCloudKeyBody } from '@conch/protocol';
import type { FastifyInstance } from 'fastify';

import type { Gatekeeper } from '../security';
import type { Services } from '../services';

/**
 * Where work runs (ADR 0106). Under `/api`, so the gateway's host, origin and
 * sign-in checks cover them. Saving the cloud's key sends work folders off this
 * computer from then on: it needs a recent sign-in, and the key never comes back.
 */
export function registerWorkPlaceRoutes(
  app: FastifyInstance,
  services: Services,
  gate: Gatekeeper,
) {
  const places = services.workplaces;

  app.get<{ Querystring: { look?: string } }>('/api/workplaces', (request) =>
    places.status({ look: request.query.look === '1' }),
  );

  app.put('/api/workplaces/cloud-key', async (request, reply) => {
    const parsed = SetCloudKeyBody.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'bad-request', message: parsed.error.issues[0]?.message ?? 'Bad key.' });
    if (!gate.verified(request.access))
      return reply
        .code(403)
        .send({ error: 'verify-required', message: 'Confirm it’s you to make this change.' });
    try {
      await places.setCloudKey(parsed.data.key);
    } catch (error) {
      return reply.code(400).send({
        error: 'bad-request',
        message: error instanceof Error ? error.message : 'Daytona didn’t accept that key.',
      });
    }
    return places.status();
  });

  app.delete('/api/workplaces/cloud-key', async () => {
    await places.forgetCloudKey();
    return places.status();
  });
}
