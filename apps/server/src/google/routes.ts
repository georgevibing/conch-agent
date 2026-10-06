import { isLoopbackAddress } from '../auth/network';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { GoogleAppId } from '@conch/protocol';
import type { Gatekeeper } from '../security';
import type { GoogleApps } from './apps';
import { GoogleError, type GoogleService } from './service';

export interface GoogleRouteDeps {
  apps?: GoogleApps;
  /** The email channel's Gmail sign-in, if there is one (ADR 0048). */
  gmailLogin?: () => Promise<{ address: string; password: string } | undefined>;
}

const Cookie = 'conch_google_flow';
const FlowParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) });
const Params = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().min(1).max(4096).optional(),
  error: z.string().max(200).optional(),
});

/** Existing gateway Host/Origin/session guards cover /api. Callback only spends a browser-bound state. */
export function googleRoutes(
  app: FastifyInstance,
  service: GoogleService,
  gate: Gatekeeper,
  deps: GoogleRouteDeps = {},
) {
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
        .code(
          error instanceof GoogleError && error.kind === 'unavailable'
            ? 503
            : error instanceof GoogleError && error.kind === 'consent'
              ? 409
              : 400,
        )
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
  // What one account may do in one product. Letting it do more is a person's choice: they
  // confirm it's them. Going past what Google allows answers 409, and the web app asks Google.
  app.post<{ Params: { id: string } }>(
    '/api/google/accounts/:id/access',
    { bodyLimit: 1_000 },
    async (request, reply) => {
      const params = FlowParams.safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({ error: 'invalid', message: 'That isn’t a Google account.' });
      const { id } = params.data;
      if ((await service.raises(id, request.body)) && !verified(request, reply)) return;
      return guarded(reply, () => service.setAccess(id, request.body));
    },
  );
  app.delete<{ Params: { id: string } }>('/api/google/accounts/:id', async (request, reply) => {
    if (!verified(request, reply)) return;
    return guarded(reply, async () => {
      await service.disconnect(request.params.id);
      return { ok: true };
    });
  });
  // ── Gmail with an app password, and the apps (ADR 0048) ─────────────────
  // Checked by signing in to Gmail before anything is kept. The password comes
  // in once, in the body, and never goes back out.
  app.post('/api/google/mail/password', { bodyLimit: 4_000 }, async (request, reply) => {
    if (!verified(request, reply)) return;
    return guarded(reply, () => service.connectPassword(request.body));
  });
  // Whether the email channel already signs in to Gmail: only the address is said.
  app.get('/api/google/mail/reusable', async () => ({
    address: (await deps.gmailLogin?.().catch(() => undefined))?.address,
  }));
  // Use the email channel's sign-in for Gmail too: only when a person asks, and checked first.
  app.post('/api/google/mail/reuse', async (request, reply) => {
    if (!verified(request, reply)) return;
    return guarded(reply, async () => {
      const login = await deps.gmailLogin?.();
      if (!login) throw new GoogleError('invalid', 'Email isn’t connected with Gmail any more.');
      return service.connectPassword(login);
    });
  });
  // An account that's already connected, used for an app again ("Use this account").
  app.post<{ Params: { app: string } }>('/api/google/apps/:app/use', async (request, reply) => {
    if (!verified(request, reply)) return;
    return guarded(reply, async () => {
      const id = GoogleAppId.parse(request.params.app);
      await deps.apps?.show(id);
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
    return reply.redirect(`/apps?google=${result}`, 303);
  });
}
