import { isLoopbackAddress } from '../auth/network';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Gatekeeper } from '../security';
import { GoogleError, type GoogleService } from './service';

const Cookie = 'conch_google_flow';
const FlowParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) });
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
  const nonce = (request: FastifyRequest, flowId: string) =>
    request.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${Cookie}_${flowId}=`))
      ?.slice(Cookie.length + flowId.length + 2) ?? '';
  const clearCookie = (request: FastifyRequest, reply: FastifyReply, flowId: string) =>
    reply.header(
      'Set-Cookie',
      `${Cookie}_${flowId}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${https(request) ? '; Secure' : ''}`,
    );
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
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/google')) reply.header('Cache-Control', 'no-store');
  });
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
  app.post('/api/google/import', { bodyLimit: 40_000 }, async (request, reply) => {
    if (!verified(request, reply)) return;
    return guarded(reply, async () => {
      await service.importCredentials(request.body, origin(request));
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
          `${Cookie}_${result.flowId}=${result.nonce}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${https(request) ? '; Secure' : ''}`,
        );
      return { url: result.url, flowId: result.flowId, mode: result.mode };
    });
  });
  app.post<{ Params: { id: string } }>(
    '/api/google/flows/:id/complete',
    { bodyLimit: 10_000 },
    async (request, reply) => {
      if (!verified(request, reply)) return;
      return guarded(reply, async () => {
        const { id } = FlowParams.parse(request.params);
        await service.complete(id, request.body, nonce(request, id), origin(request));
        clearCookie(request, reply, id);
        return service.flowStatus(id);
      });
    },
  );
  app.delete<{ Params: { id: string } }>('/api/google/flows/:id', async (request, reply) => {
    if (!verified(request, reply)) return;
    return guarded(reply, async () => {
      const { id } = FlowParams.parse(request.params);
      service.cancel(id, nonce(request, id), origin(request));
      clearCookie(request, reply, id);
      return { ok: true };
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
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    const query = Params.safeParse(request.query);
    let result = 'failed';
    if (query.success) {
      const { state, code, error } = query.data;
      clearCookie(request, reply, state);
      if (error || !code) {
        service.cancel(state, nonce(request, state), origin(request), error);
        result = error === 'access_denied' ? 'denied' : 'failed';
      } else {
        try {
          await service.finish(state, code, nonce(request, state), origin(request));
          result = service.flowStatus(state).state === 'ready' ? 'connected' : 'failed';
        } catch {
          result = 'failed';
        }
      }
    }
    return reply.redirect(`/integrations?google=${result}`, 303);
  });
}
