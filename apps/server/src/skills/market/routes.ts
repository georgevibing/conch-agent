/**
 * Discover's routes (ADR 0077). Searching and reading are free; adding and
 * updating are a person's press in Conch, never a script's access key.
 */
import {
  MarketId,
  MarketInstallBody,
  MarketPreviewBody,
  MarketQuery,
  MarketUpdateBody,
  type ServerEvent,
} from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { SkillError } from '../store';
import { MarketError } from './http';
import type { SkillMarket } from './service';

const STATUS: Record<MarketError['code'], number> = {
  offline: 503,
  limited: 429,
  'not-found': 404,
  refused: 409,
  'too-big': 413,
  changed: 409,
};

function send(reply: FastifyReply, error: unknown) {
  if (error instanceof MarketError)
    return reply.code(STATUS[error.code]).send({ error: error.code, message: error.message });
  if (error instanceof SkillError) {
    const status = { 'not-found': 404, invalid: 400, 'read-only': 409, 'needs-review': 409 }[
      error.code
    ];
    return reply.code(status).send({ error: error.code, message: error.message });
  }
  throw error;
}

/** Adding a skill is a person's choice: an access key (a script, the assistant's shell) can't. */
function personOnly(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.access?.kind !== 'bearer') return false;
  void reply.code(403).send({
    error: 'person-only',
    message: 'Only you can add a skill, in Conch itself, not with an access key.',
  });
  return true;
}

export function registerMarketRoutes(
  app: FastifyInstance,
  market: SkillMarket,
  helpers: {
    detail: (skillId: string) => Promise<unknown>;
    emit: (event: ServerEvent) => void;
  },
) {
  const run = async <T>(reply: FastifyReply, task: () => Promise<T>) => {
    try {
      return await task();
    } catch (error) {
      return send(reply, error);
    }
  };
  const bad = (reply: FastifyReply, message: string) =>
    reply.code(400).send({ error: 'invalid', message });

  app.get('/api/skills/market', async (request, reply) => {
    const query = MarketQuery.safeParse(request.query ?? {});
    if (!query.success) return bad(reply, 'That search isn’t one Conch can run.');
    return run(reply, () => market.search(query.data));
  });

  app.get<{ Querystring: { id?: string } }>(
    '/api/skills/market/listing',
    async (request, reply) => {
      const id = MarketId.safeParse(request.query.id);
      if (!id.success) return bad(reply, 'That isn’t a skill Conch knows how to find.');
      return run(reply, () => market.listing(id.data));
    },
  );

  app.post('/api/skills/market/preview', async (request, reply) => {
    const body = MarketPreviewBody.safeParse(request.body ?? {});
    if (!body.success) return bad(reply, 'That isn’t a skill Conch knows how to find.');
    return run(reply, () => market.preview(body.data.id));
  });

  app.post('/api/skills/market/install', async (request, reply) => {
    if (personOnly(request, reply)) return reply;
    const body = MarketInstallBody.safeParse(request.body ?? {});
    if (!body.success) return bad(reply, 'Open the skill again to read it first.');
    return run(reply, async () => {
      const skillId = await market.install(body.data);
      helpers.emit({ type: 'skills.changed' });
      return helpers.detail(skillId);
    });
  });

  app.get<{ Querystring: { refresh?: string } }>(
    '/api/skills/market/updates',
    async (request, reply) =>
      run(reply, async () => ({
        updates: await market.checkUpdates({ force: request.query.refresh === '1' }),
      })),
  );

  app.post<{ Params: { id: string } }>('/api/skills/:id/market/update/preview', (request, reply) =>
    run(reply, () => market.previewUpdate(request.params.id)),
  );

  app.post<{ Params: { id: string } }>('/api/skills/:id/market/update', async (request, reply) => {
    if (personOnly(request, reply)) return reply;
    const body = MarketUpdateBody.safeParse(request.body ?? {});
    if (!body.success) return bad(reply, 'Open the update again to read it first.');
    return run(reply, async () => {
      await market.update(request.params.id, body.data);
      helpers.emit({ type: 'skills.changed' });
      return helpers.detail(request.params.id);
    });
  });
}
