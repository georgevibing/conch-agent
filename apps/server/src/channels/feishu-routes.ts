import { type FeishuScan, StartFeishuScanBody } from '@conch/protocol';
import type { FastifyInstance } from 'fastify';

import type { Gatekeeper } from '../security';
import type { FeishuRegistrations } from './feishu-register';
import { ChannelError } from './types';

/**
 * Making a Feishu or Lark bot by scanning a code (ADR 0120). Whoever scans
 * the code becomes the bot's owner, so showing one is a trust decision: from
 * another device it needs a password or key from the last few minutes, like
 * connecting a bot. Looking at a scan and stopping one never do. The app's
 * keys stay on the gateway.
 */
export function registerFeishuScanRoutes(
  app: FastifyInstance,
  scans: FeishuRegistrations,
  gate: Gatekeeper,
) {
  app.post('/api/channels/feishu/scan', async (request, reply) => {
    const parsed = StartFeishuScanBody.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'bad-request', message: parsed.error.issues[0]?.message });
    if (!gate.isLocal(request) && !gate.verified(request.access))
      return reply
        .code(403)
        .send({ error: 'verify-required', message: 'Confirm it’s you to make this change.' });
    try {
      const begun = await scans.begin(parsed.data.region);
      return {
        id: begun.id,
        state: 'waiting',
        url: begun.url,
        expiresAt: begun.expiresAt,
      } satisfies FeishuScan;
    } catch (error) {
      if (!(error instanceof ChannelError)) throw error;
      return reply
        .code(error.code === 'rate-limit' ? 429 : 502)
        .send({ error: 'unavailable', message: error.message });
    }
  });

  app.get<{ Params: { id: string } }>('/api/channels/feishu/scan/:id', async (request, reply) => {
    const status = scans.status(request.params.id);
    if (!status)
      return reply
        .code(404)
        .send({ error: 'not-found', message: 'That code is gone. Show a new one.' });
    const id = request.params.id;
    if (status.state === 'waiting')
      return {
        id,
        state: 'waiting',
        url: status.url,
        expiresAt: status.expiresAt,
      } satisfies FeishuScan;
    if (status.state === 'done')
      return { id, state: 'done', channelId: status.channelId } satisfies FeishuScan;
    return { id, state: status.state, message: status.message } satisfies FeishuScan;
  });

  app.delete<{ Params: { id: string } }>(
    '/api/channels/feishu/scan/:id',
    async (request, reply) => {
      scans.cancel(request.params.id);
      return reply.code(204).send();
    },
  );
}
