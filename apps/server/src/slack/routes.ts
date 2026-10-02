import { SlackConnectBody, SlackUpdateBody } from '@conch/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { SlackError, type SlackService } from './service';

/**
 * Slack, connected to Conch (ADR 0049). The gateway's Host/Origin/session
 * guards cover `/api`; the token comes in once, in a body, and never goes
 * back out.
 */
export function slackRoutes(app: FastifyInstance, slack: SlackService) {
  const guarded = async (reply: FastifyReply, run: () => Promise<unknown>) => {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof SlackError)) throw error;
      return reply
        .code(error.kind === 'unavailable' ? 503 : error.kind === 'not-connected' ? 409 : 400)
        .send({ error: error.kind, message: error.message });
    }
  };
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/slack')) reply.header('Cache-Control', 'no-store');
  });
  app.get('/api/slack', () => slack.status());
  app.post('/api/slack/connect', { bodyLimit: 4_000 }, async (request, reply) => {
    const body = SlackConnectBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send({ error: 'invalid', message: 'Paste the User OAuth Token from your Slack app.' });
    return guarded(reply, () => slack.connect(body.data.token));
  });
  app.post('/api/slack/check', (_request, reply) => guarded(reply, () => slack.check()));
  app.patch('/api/slack', async (request, reply) => {
    const body = SlackUpdateBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid', message: body.error.issues[0]?.message });
    return guarded(reply, () => slack.update(body.data));
  });
  app.delete('/api/slack', (_request, reply) =>
    guarded(reply, async () => {
      await slack.disconnect();
      return { ok: true };
    }),
  );
}
