import { FinishSlackImportBody, ImportSourceId, RunImportBody } from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { ChannelServiceError } from '../channels/service';
import type { Gatekeeper } from '../security';
import { ImportError, type ImportService } from './service';

const STATUS = { 'not-found': 404, busy: 409, nothing: 400 } as const;

/**
 * Come home (ADR 0035). Looking needs only the page's sign-in. Bringing
 * things over can connect a bot and save keys, so it needs a recent
 * password or key (sudo mode); so does Undo, which removes things.
 */
export function registerImportRoutes(
  app: FastifyInstance,
  imports: ImportService,
  gate: Gatekeeper,
): void {
  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof ImportError)
      return reply
        .code(STATUS[error.code])
        .send({ error: `import-${error.code}`, message: error.message });
    // Slack said no to a key (ADR 0042): which one, in its words.
    if (error instanceof ChannelServiceError)
      return reply.code(error.code === 'not-found' ? 404 : 400).send({
        error: error.code,
        message: error.message,
        ...(error.field && { field: error.field }),
      });
    throw error;
  };
  const verify = (request: FastifyRequest, reply: FastifyReply) => {
    if (gate.verified(request.access)) return true;
    void reply
      .code(403)
      .send({ error: 'verify-required', message: 'Confirm it’s you to bring things over.' });
    return false;
  };

  app.get('/api/import', () => imports.status());

  // A Slack bot another app had one key for (ADR 0042): what the Slack setup picks up from.
  app.get('/api/import/slack', () => imports.slack());

  app.post<{ Params: { source: string } }>('/api/import/:source/slack', async (request, reply) => {
    const source = ImportSourceId.safeParse(request.params.source);
    const body = FinishSlackImportBody.safeParse(request.body ?? {});
    if (!source.success || !body.success)
      return reply.code(400).send({ error: 'bad-request', message: 'That isn’t a Slack key.' });
    if (!verify(request, reply)) return;
    try {
      return (await imports.finishSlack(source.data, body.data)).view;
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get<{ Params: { source: string } }>('/api/import/:source', async (request, reply) => {
    const source = ImportSourceId.safeParse(request.params.source);
    if (!source.success)
      return reply
        .code(404)
        .send({ error: 'not-found', message: 'Not an app Conch can bring things from.' });
    try {
      return await imports.plan(source.data);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/import', async (request, reply) => {
    const body = RunImportBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: body.error.issues[0]?.message });
    if (!verify(request, reply)) return;
    try {
      return await imports.run(body.data.source, body.data.items);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/import/undo', async (request, reply) => {
    if (!verify(request, reply)) return;
    try {
      return await imports.undo();
    } catch (error) {
      return fail(reply, error);
    }
  });
}
