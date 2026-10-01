import { ActivityKind, type SafetyStatus } from '@conch/protocol';
import type { FastifyInstance } from 'fastify';

import type { Activity } from '../activity/service';
import { sandboxSupport, secretPlaces } from './sandbox';

/**
 * Safe hands (ADR 0028): whether commands can be sealed here and what that
 * protects, and everything the assistant did (the activity timeline).
 */
export function registerSafetyRoutes(app: FastifyInstance, activity: Activity): void {
  app.get<{ Querystring: { before?: string; kind?: string; limit?: string } }>(
    '/api/activity',
    async (request, reply) => {
      const kind = request.query.kind ? ActivityKind.safeParse(request.query.kind) : undefined;
      if (kind && !kind.success)
        return reply.code(400).send({ error: 'bad-request', message: 'Not a kind of activity.' });
      const before = Number(request.query.before);
      const limit = Number(request.query.limit);
      return activity.page({
        ...(Number.isFinite(before) && before > 0 && { before }),
        ...(kind?.success && { kind: kind.data }),
        ...(Number.isFinite(limit) && limit > 0 && { limit }),
      });
    },
  );

  app.get('/api/safety', (): SafetyStatus => {
    const support = sandboxSupport();
    return {
      sandbox: {
        available: support.available,
        ...(!support.available && { reason: support.reason }),
        ...(!support.available && support.command && { command: support.command }),
        protects: [
          ...new Set(['Conch’s passwords and keys', ...secretPlaces().map((p) => p.what)]),
        ],
      },
    };
  });
}
