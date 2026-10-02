import { StartChannelLinkBody } from '@conch/protocol';
import type { FastifyInstance } from 'fastify';

import type { Gatekeeper } from '../security';
import { type ChannelLinking, LinkingError } from './linking';

const STATUS: Record<LinkingError['code'], number> = {
  'not-found': 404,
  invalid: 400,
  unavailable: 409,
};

/**
 * Linking WhatsApp or Signal by QR code (ADR 0043). Showing a code opens a
 * new way in — whoever scans it links their account and talks to your
 * assistant as you — so from another device it needs a password or key
 * from the last few minutes, like connecting a bot. Looking at a link and
 * stopping one never do.
 */
export function registerChannelLinkRoutes(
  app: FastifyInstance,
  linking: ChannelLinking,
  gate: Gatekeeper,
) {
  const fail = (error: unknown) => {
    if (!(error instanceof LinkingError)) throw error;
    return { status: STATUS[error.code], body: { error: error.code, message: error.message } };
  };

  app.post('/api/channels/link', async (request, reply) => {
    const parsed = StartChannelLinkBody.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'bad-request', message: parsed.error.issues[0]?.message });
    if (!gate.isLocal(request) && !gate.verified(request.access))
      return reply
        .code(403)
        .send({ error: 'verify-required', message: 'Confirm it’s you to make this change.' });
    try {
      return linking.start(parsed.data.kind, parsed.data.channelId);
    } catch (error) {
      const { status, body } = fail(error);
      return reply.code(status).send(body);
    }
  });

  app.get<{ Params: { id: string } }>('/api/channels/link/:id', async (request, reply) => {
    try {
      return linking.get(request.params.id);
    } catch (error) {
      const { status, body } = fail(error);
      return reply.code(status).send(body);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/channels/link/:id', async (request, reply) => {
    linking.cancel(request.params.id);
    return reply.code(204).send();
  });
}
