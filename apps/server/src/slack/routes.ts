import { SlackConnectBody, type SlackSetup } from '@conch/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';

import type { SlackApps } from './apps';
import { SlackError, type SlackService } from './service';

/**
 * Connecting Slack to Conch (ADR 0049). Once connected it's an app like any
 * other (`/api/integrations/slack`, ADR 0052); only what setting it up needs
 * is here. The gateway's Host/Origin/session guards cover `/api`; the token
 * comes in once, in a body, and never goes back out.
 */
export function slackRoutes(
  app: FastifyInstance,
  slack: SlackService,
  apps: SlackApps,
  /** The Slack channel's app, offered for this too (never its keys). */
  channelApp: () => Promise<SlackSetup['channelApp']>,
) {
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
  // What the connect dialog can offer: the Slack app a channel already uses, by name only.
  app.get('/api/slack/setup', async (): Promise<SlackSetup> => {
    const known = await channelApp().catch(() => undefined);
    return known ? { channelApp: known } : {};
  });
  app.post('/api/slack/connect', { bodyLimit: 4_000 }, async (request, reply) => {
    const body = SlackConnectBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send({ error: 'invalid', message: 'Paste the User OAuth Token from your Slack app.' });
    return guarded(reply, async () => {
      await slack.connect(body.data.token);
      return apps.get('slack');
    });
  });
}
