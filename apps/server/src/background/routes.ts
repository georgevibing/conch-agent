import { SetBackgroundBody } from '@conch/protocol';
import type { FastifyInstance } from 'fastify';

import { stopSoon } from '../lib/lifecycle';
import type { Gatekeeper } from '../security';
import type { BackgroundService } from './service';

/**
 * Always on (ADR 0026), and quitting Conch. Under `/api`, behind the
 * gateway's host, origin and sign-in checks. Turning it on lets Conch run
 * with nobody watching, and quitting cuts off every device, so both need a
 * recent password or key (sudo mode). Looking needs nothing more.
 */
export function registerBackgroundRoutes(
  app: FastifyInstance,
  background: BackgroundService,
  gate: Gatekeeper,
  busy: () => boolean,
): void {
  app.get('/api/background', () => background.status());

  app.put('/api/background', async (request, reply) => {
    const body = SetBackgroundBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: body.error.issues[0]?.message });
    if (!gate.verified(request.access))
      return reply.code(403).send({
        error: 'verify-required',
        message: body.data.on
          ? 'Confirm it’s you to keep Conch running on its own.'
          : 'Confirm it’s you to change how Conch starts.',
      });
    // A handover moves every device to the new Conch; a chat mid-answer would be cut short.
    if (body.data.on && busy())
      return reply.code(409).send({
        error: 'busy',
        message: 'A chat is still working. Wait for it to finish, then try again.',
      });
    return background.set(body.data.on);
  });

  // Adds an app to the person's own Applications or Start menu: nothing it could do
  // that opening Conch couldn't, so it asks for no more than the page already has.
  app.post('/api/background/shortcut', async (_request, reply) => {
    try {
      return await background.addShortcut();
    } catch (error) {
      return reply.code(409).send({ error: 'shortcut', message: (error as Error).message });
    }
  });

  app.post('/api/gateway/quit', (request, reply) => {
    if (!gate.verified(request.access))
      return reply
        .code(403)
        .send({ error: 'verify-required', message: 'Confirm it’s you to quit Conch.' });
    if (busy())
      return reply.code(409).send({
        error: 'busy',
        message: 'A chat is still working. Wait for it to finish, then quit Conch.',
      });
    return stopSoon('🐚  Conch has stopped. Open it again from your apps, or run pnpm start.')
      ? reply.code(202).send({ ok: true })
      : reply.code(409).send({
          error: 'not-quittable',
          message: 'Conch can’t quit itself here. Stop it in its Terminal window (Ctrl+C).',
        });
  });
}
