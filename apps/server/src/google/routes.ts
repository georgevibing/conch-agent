import { isLoopbackAddress } from '../auth/network';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Gatekeeper } from '../security';
import { GoogleError, type GoogleService } from './service';

const Cookie = 'conch_google_flow';
const Params = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().min(1).max(4096).optional(),
  error: z.string().max(200).optional(),
});

/** Existing gateway Host/Origin/session guards cover /api. Callback only spends a browser-bound state. */
export function googleRoutes(app: FastifyInstance, service: GoogleService, gate: Gatekeeper) {
  const https = (request: FastifyRequest) =>
    request.protocol === 'https' ||
    (isLoopbackAddress(request.socket.remoteAddress) &&
      request.headers['x-forwarded-proto'] === 'https');
  const origin = (request: FastifyRequest) =>
    `${https(request) ? 'https' : 'http'}://${request.headers.host}`;
  const guarded = async (reply: FastifyReply, run: () => Promise<unknown>) => {
    try {
      return await run();
    } catch (error) {
      return reply
        .code(error instanceof GoogleError && error.kind === 'unavailable' ? 503 : 400)
        .send({
          error: error instanceof GoogleError ? error.kind : 'invalid',
          message:
            error instanceof GoogleError
              ? error.message
              : 'Check the Google connection details and try again.',
        });
    }
  };
  const verified = (request: FastifyRequest, reply: FastifyReply) => {
    if (gate.verified(request.access)) return true;
    void reply
      .code(403)
      .send({ error: 'verify-required', message: 'Confirm it’s you to change Google access.' });
    return false;
  };
  app.get('/api/google', () => service.status());
  app.get<{ Params: { id: string } }>('/api/google/flows/:id', (request) =>
    service.flowStatus(request.params.id),
  );
  app.post('/api/google/configure', async (request, reply) => {
    if (!verified(request, reply)) return;
    return guarded(reply, async () => {
      await service.configure(request.body, origin(request));
      return service.status();
    });
  });
  app.post('/api/google/connect', async (request, reply) => {
    if (!verified(request, reply)) return;
    return guarded(reply, async () => {
      const result = await service.start(request.body, origin(request));
      reply
        .header('Cache-Control', 'no-store')
        .header(
          'Set-Cookie',
          `${Cookie}=${result.nonce}; HttpOnly; SameSite=Lax; Path=/oauth/google/callback; Max-Age=600${https(request) ? '; Secure' : ''}`,
        );
      return { url: result.url, flowId: result.flowId };
    });
  });
  app.post<{ Params: { id: string } }>('/api/google/accounts/:id/check', (request, reply) =>
    guarded(reply, () => service.check(request.params.id)),
  );
  app.delete<{ Params: { id: string } }>('/api/google/accounts/:id', async (request, reply) => {
    if (!verified(request, reply)) return;
    return guarded(reply, async () => {
      await service.disconnect(request.params.id);
      return { ok: true };
    });
  });
  app.get('/oauth/google/callback', async (request, reply) => {
    reply
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .header(
        'Set-Cookie',
        `${Cookie}=; HttpOnly; SameSite=Lax; Path=/oauth/google/callback; Max-Age=0${https(request) ? '; Secure' : ''}`,
      );
    const query = Params.safeParse(request.query);
    let result = 'failed';
    if (query.success) {
      const { state, code, error } = query.data;
      if (error || !code) {
        service.cancel(state);
        result = error === 'access_denied' ? 'denied' : 'failed';
      } else {
        const nonce =
          request.headers.cookie
            ?.split(';')
            .map((s) => s.trim())
            .find((s) => s.startsWith(`${Cookie}=`))
            ?.slice(Cookie.length + 1) ?? '';
        try {
          await service.finish(state, code, nonce, origin(request));
          result = 'connected';
        } catch {
          result = 'failed';
        }
      }
    }
    return reply.redirect(`/integrations?google=${result}`, 303);
  });
}
