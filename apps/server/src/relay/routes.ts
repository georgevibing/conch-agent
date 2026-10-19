/**
 * The always-on relay's routes (ADR 0140), under `/api` like every other, so
 * Host, Origin, Fetch Metadata and sign-in apply. Setting one up, or pointing
 * Conch at one, changes where the internet reaches it: a trust decision, so
 * from another device it needs a recent password, key or passkey (as the
 * public door does). Forgetting it only takes reach away and never needs one.
 */
import { SetRelayBody } from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Gatekeeper } from '../security';
import { RelayError, type RelayService } from './service';

export function registerRelayRoutes(app: FastifyInstance, relay: RelayService, gate: Gatekeeper) {
  const trusted = (request: FastifyRequest, reply: FastifyReply) => {
    if (gate.isLocal(request) || gate.verified(request.access)) return true;
    void reply
      .code(403)
      .send({ error: 'verify-required', message: 'Confirm it’s you to make this change.' });
    return false;
  };

  app.get('/api/relay', () => relay.view());

  app.post('/api/relay/pair', async (request, reply) => {
    if (!trusted(request, reply)) return reply;
    return relay.pair();
  });

  app.put('/api/relay', async (request, reply) => {
    const body = SetRelayBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: body.error.issues[0]?.message });
    if (!trusted(request, reply)) return reply;
    try {
      return await relay.connect(body.data.url);
    } catch (error) {
      if (error instanceof RelayError)
        return reply.code(400).send({ error: 'invalid', message: error.message });
      throw error;
    }
  });

  app.post('/api/relay/check', async () => {
    await relay.repair().catch(() => undefined);
    return relay.view();
  });

  app.delete('/api/relay', () => relay.forget());
}
