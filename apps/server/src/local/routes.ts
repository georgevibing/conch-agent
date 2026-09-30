import { LocalChooseBody, LocalPullBody } from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import type { Gatekeeper } from '../security';
import type { Services } from '../services';
import { LocalError } from './service';

/**
 * A model on this computer (ADR 0018). All under `/api`, so the gateway's host,
 * origin and sign-in checks cover them like everything else.
 *
 * Downloading a model persists something big on this computer that runs as
 * you, so it needs a recent password or key — the same sudo mode as
 * installing a program (ADR 0016). Only models Conch suggests can be
 * downloaded, and only by a person: the agent has no tool for it. Pausing,
 * cancelling, starting Ollama and choosing among models already here don't
 * persist anything new, so they don't ask.
 */
export function registerLocalRoutes(app: FastifyInstance, services: Services, gate: Gatekeeper) {
  const { local } = services;

  const verifyRequired = (request: FastifyRequest, reply: FastifyReply) => {
    if (gate.verified(request.access)) return false;
    void reply
      .code(403)
      .send({ error: 'verify-required', message: 'Confirm it’s you to make this change.' });
    return true;
  };

  const parse = <T extends z.ZodType>(schema: T, value: unknown, reply: FastifyReply) => {
    const result = schema.safeParse(value);
    if (result.success) return result.data as z.infer<T>;
    void reply.code(400).send({ error: 'bad-request', message: result.error.issues[0]?.message });
    return undefined;
  };

  const failed = (reply: FastifyReply, error: unknown) => {
    if (error instanceof LocalError) {
      const status = { 'not-found': 404, invalid: 409, unavailable: 503 }[error.code];
      return reply.code(status).send({ error: error.code, message: error.message });
    }
    throw error;
  };

  app.get('/api/local', () => local.status());

  app.post('/api/local/pull', async (request, reply) => {
    const body = parse(LocalPullBody, request.body, reply);
    if (!body) return;
    if (verifyRequired(request, reply)) return;
    try {
      return await local.pull(body.model);
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.post('/api/local/pull/pause', () => {
    local.pause();
    return local.status({ heal: false });
  });

  app.post('/api/local/pull/cancel', () => {
    local.cancel();
    return local.status({ heal: false });
  });

  app.post('/api/local/start', async (request, reply) => {
    if (!(await local.ensureRunning({ note: false }))) {
      return reply.code(503).send({
        error: 'unavailable',
        message: (await local.program())
          ? 'Ollama didn’t start. Open it once, then try again.'
          : 'Ollama isn’t on this computer yet.',
      });
    }
    return local.status();
  });

  app.put('/api/local/model', async (request, reply) => {
    const body = parse(LocalChooseBody, request.body, reply);
    if (!body) return;
    try {
      return await local.choose(body.model);
    } catch (error) {
      return failed(reply, error);
    }
  });
}
