/**
 * How I did it (ADR 0113): `GET /api/conversations/:id/timeline`, and
 * `POST /api/trajectories/preview` and `/export`. Under `/api`, so sign-in,
 * Host, Origin and Fetch Metadata are checked like everything else. Saving is
 * a person's: an access key (a script, the assistant's own shell) can't write
 * a file of every chat onto the disk.
 */
import {
  RunTimeline,
  TrajectoryExportBody,
  TrajectoryExportResult,
  TrajectoryPreview,
} from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { TrajectoryError, type TrajectoryProblem, type TrajectoryService } from './service';

const STATUS: Record<TrajectoryProblem, number> = {
  missing: 404,
  none: 404,
  denied: 403,
  'not-folder': 409,
  unwritable: 409,
};

function personOnly(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.access?.kind !== 'bearer') return false;
  void reply.code(403).send({
    error: 'person-only',
    message: 'Only you can save chats to this computer, in Conch itself.',
  });
  return true;
}

function fail(reply: FastifyReply, error: unknown) {
  if (!(error instanceof TrajectoryError)) throw error;
  return reply
    .code(STATUS[error.code])
    .send({ error: `trajectory-${error.code}`, message: error.message });
}

export function registerTrajectoryRoutes(app: FastifyInstance, service: TrajectoryService): void {
  app.get<{ Params: { id: string } }>('/api/conversations/:id/timeline', async (request, reply) => {
    try {
      return RunTimeline.parse(await service.timeline(request.params.id));
    } catch (error) {
      return fail(reply, error);
    }
  });

  for (const action of ['preview', 'export'] as const)
    app.post(`/api/trajectories/${action}`, async (request, reply) => {
      if (personOnly(request, reply)) return;
      const body = TrajectoryExportBody.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ error: 'bad-request', message: 'Nothing to save.' });
      try {
        return action === 'preview'
          ? TrajectoryPreview.parse(await service.preview(body.data))
          : TrajectoryExportResult.parse(await service.export(body.data));
      } catch (error) {
        return fail(reply, error);
      }
    });
}
