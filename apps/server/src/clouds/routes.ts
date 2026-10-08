import { ChooseCloudBody, ClaudeCloudBody, CloudPicker, CloudProviderId } from '@conch/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { CloudError } from './errors';
import type { CloudService } from './service';

/** Signing in again is the provider's own: `POST /api/providers/:id/login`. */
const Via = z.object({ via: z.enum(['bedrock', 'vertex']).optional() });

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof CloudError)
    return reply
      .code(error.problem === 'not-chosen' ? 404 : error.problem === 'signed-out' ? 401 : 400)
      .send({ error: error.problem, message: error.message });
  return reply
    .code(500)
    .send({ error: 'failed', message: (error as Error).message || 'That didn’t work.' });
}

/**
 * Your company's cloud (ADR 0109): the accounts found on this computer for a
 * provider, and choosing one. Under `/api`, so the gateway's host, origin and
 * sign-in checks cover it. Nothing here returns a secret, and choosing only
 * accepts an account this computer actually has.
 */
export function registerCloudRoutes(app: FastifyInstance, clouds: CloudService) {
  const provider = (params: unknown, reply: FastifyReply) => {
    const id = CloudProviderId.safeParse((params as { id?: string } | undefined)?.id);
    if (id.success) return id.data;
    void reply
      .code(404)
      .send({ error: 'not-found', message: 'There’s no cloud provider like that.' });
    return undefined;
  };

  app.get<{ Params: { id: string }; Querystring: { via?: string } }>(
    '/api/clouds/:id',
    async (request, reply) => {
      const id = provider(request.params, reply);
      if (!id) return;
      const via = Via.safeParse(request.query);
      try {
        return CloudPicker.parse(await clouds.picker(id, via.success ? via.data.via : undefined));
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.put<{ Params: { id: string } }>('/api/clouds/:id', async (request, reply) => {
    const id = provider(request.params, reply);
    if (!id) return;
    try {
      if (id === 'claude-code') {
        const body = ClaudeCloudBody.safeParse(request.body);
        if (!body.success)
          return reply
            .code(400)
            .send({ error: 'bad-request', message: body.error.issues[0]?.message });
        return CloudPicker.parse(await clouds.claudeCode(body.data));
      }
      const body = ChooseCloudBody.safeParse(request.body);
      if (!body.success)
        return reply
          .code(400)
          .send({ error: 'bad-request', message: body.error.issues[0]?.message });
      return CloudPicker.parse(await clouds.choose(id, body.data));
    } catch (error) {
      return fail(reply, error);
    }
  });
}
