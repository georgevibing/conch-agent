import { HereLinkBody, HereRedeemBody } from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Gatekeeper } from '../security';
import { safePage } from './here';

/**
 * "This computer", proven (ADR 0063).
 *
 * - `POST /api/here/link`: a program holding this computer's key asks for a
 *   one-time link to a page, and with `file`, for the private file that opens
 *   it. Its key is checked in `security.ts` (`HERE_API`). Conch's own launchers
 *   don't use it: they ask through `here/asks` (`ThisComputer.answer`), so no
 *   secret ever goes to whatever listens on the port.
 * - `POST /api/here`: the web app hands in the code it took from `#here=`, and
 *   the browser gets the cookie that makes it this computer.
 *
 * `Accept: text/plain` answers with just the file (or the address).
 */
export function registerHereRoutes(app: FastifyInstance, gate: Gatekeeper): void {
  const link = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = HereLinkBody.safeParse(request.body ?? {});
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: body.error.issues[0]?.message });
    const page = safePage(body.data.page);
    if (!page)
      return reply.code(400).send({ error: 'bad-request', message: 'That isn’t a page of Conch.' });
    const port = request.socket.localPort ?? gate.config.CONCH_PORT;
    const made = await gate.here.link({ port, page, file: body.data.file ?? false });
    if (request.headers.accept === 'text/plain')
      return reply.type('text/plain; charset=utf-8').send(made.file ?? made.url);
    return made;
  };

  app.post('/api/here/link', link);

  app.post('/api/here', async (request, reply) => {
    // A code only works on this computer: through a proxy or from elsewhere, never.
    if (!gate.looksLocal(request))
      return reply.code(403).send({
        error: 'here-only',
        message: 'This link only works on the computer running Conch.',
      });
    const client = gate.clientKey(request);
    const wait = gate.limiter.retryAfter(client, false);
    if (wait > 0) {
      const seconds = Math.ceil(wait / 1000);
      return reply
        .code(429)
        .header('retry-after', String(seconds))
        .send({ error: 'rate-limited', message: 'Too many tries.', retryAfter: seconds });
    }
    const body = HereRedeemBody.safeParse(request.body);
    if (!body.success || !gate.here.redeem(body.data.code)) {
      gate.limiter.fail(client);
      return reply.code(401).send({
        error: 'invalid',
        message:
          'That link has expired or was already used. Open Conch from your apps again, or run: pnpm conch open',
      });
    }
    reply.header('set-cookie', gate.hereCookie(request));
    return { ok: true };
  });
}
