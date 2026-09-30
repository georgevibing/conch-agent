import { userInfo } from 'node:os';

import {
  AccessSettings,
  CheckupFixBody,
  CreateKeyBody,
  Id,
  SetPasswordBody,
  SignInBody,
  VerifyBody,
  type SignInVia,
} from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import type { Gatekeeper } from '../security';
import type { Services } from '../services';
import { checkup, findTokenProfile, workspaceRules } from './checkup';
import { FixError, runFix } from './fixes';
import { exposure } from './network';
import { AccessError } from './store';

function parse<T extends z.ZodType>(schema: T, value: unknown, reply: FastifyReply) {
  const result = schema.safeParse(value);
  if (result.success) return result.data as z.infer<T>;
  void reply.code(400).send({ error: 'bad-request', message: result.error.issues[0]?.message });
  return undefined;
}

function suggestedUsername() {
  try {
    return userInfo().username;
  } catch {
    return '';
  }
}

const WRONG = 'That didn’t work. Check it and try again.';

/**
 * Sign-in, sign-out and everything under Settings → Security.
 *
 * Errors never say *which* part was wrong (username or password), sensitive
 * changes need a password or key entered in the last ten minutes, and every
 * sign-in starts a brand-new session.
 */
export function registerAuthRoutes(app: FastifyInstance, services: Services, gate: Gatekeeper) {
  const { access: store } = services;

  const currentSessionId = (request: FastifyRequest) =>
    request.access?.kind === 'session' ? request.access.session.id : undefined;

  const throttled = (request: FastifyRequest, reply: FastifyReply) => {
    const wait = gate.limiter.retryAfter(gate.clientKey(request), gate.isLocal(request));
    if (wait <= 0) return false;
    const seconds = Math.ceil(wait / 1000);
    void reply
      .code(429)
      .header('retry-after', String(seconds))
      .send({ error: 'rate-limited', message: 'Too many tries.', retryAfter: seconds });
    return true;
  };

  const startSession = async (
    request: FastifyRequest,
    reply: FastifyReply,
    via: SignInVia,
    keyId?: string,
  ) => {
    const { token, session } = await store.createSession({
      via,
      userAgent: request.headers['user-agent'],
      keyId,
    });
    reply.header('set-cookie', gate.sessionCookie(request, token));
    request.access = { kind: 'session', session };
  };

  const requireVerified = (request: FastifyRequest, reply: FastifyReply) => {
    if (gate.verified(request.access)) return true;
    void reply.code(403).send({
      error: 'verify-required',
      message: 'Confirm it’s you to make this change.',
    });
    return false;
  };

  const settings = async (request: FastifyRequest): Promise<AccessSettings> => {
    const file = await store.get();
    const { preferences } = await services.settings.get();
    return AccessSettings.parse({
      method: await gate.method(),
      ...(file.username && { username: file.username }),
      suggestedUsername: suggestedUsername(),
      keys: await store.keys(),
      sessions: await store.sessions(currentSessionId(request)),
      checkup: checkup({
        config: services.config,
        access: file,
        accessLocked: await store.locked(),
        permissionMode: preferences.permissionMode,
        secure: gate.isSecure(request),
        homeProblems: services.homeProblems,
        tailscale: gate.hosts.tailscale,
        workspaceRules: await workspaceRules(await services.settings.workspace()),
        trustedIntegrations: await services.integrations.store.trusted(),
        browserLocal: (await services.browser.store.settings()).allowLocal,
        terminalRemote: (await services.terminal.settings()).allowRemote,
        provider: await services.providers.checkupCopy(),
        ...(services.config.CONCH_TOKEN && { tokenProfile: await findTokenProfile() }),
      }),
      exposure: exposure(services.config),
      port: services.config.CONCH_PORT,
      urls: gate.hosts.urls(),
      ...(gate.hosts.tailscale && { tailscale: `https://${gate.hosts.tailscale}` }),
      verified: gate.verified(request.access),
    });
  };

  // ── Public ─────────────────────────────────────────────────────────────

  app.get('/api/auth', (request) => gate.status(request));

  app.post('/api/auth/sign-in', async (request, reply) => {
    const body = parse(SignInBody, request.body, reply);
    if (!body) return;
    if (throttled(request, reply)) return;
    const client = gate.clientKey(request);
    const local = gate.isLocal(request);
    const method = await gate.method();

    let ok = false;
    let keyId: string | undefined;
    if (body.with === 'pairing') {
      ok = await store.consumePairing(body.code);
    } else if (body.with === 'key') {
      keyId = await gate.checkKey(body.key);
      ok = keyId !== undefined;
    } else if (method === 'password') {
      ok = (await store.verify({ username: body.username, secret: body.password })).ok;
    }
    if (!ok) {
      gate.limiter.fail(client);
      return reply.code(401).send({ error: 'invalid', message: WRONG });
    }
    gate.limiter.succeed(client, local);
    await startSession(request, reply, body.with, keyId);
    return gate.status(request);
  });

  app.post('/api/auth/sign-out', async (request, reply) => {
    const resolved = await gate.resolve(request);
    if (typeof resolved === 'object' && resolved.kind === 'session') {
      await store.revokeSession(resolved.session.id);
      gate.disconnect([resolved.session.id]);
    }
    reply.header('set-cookie', gate.clearCookies());
    return { ok: true };
  });

  // ── Security settings (signed in) ──────────────────────────────────────

  app.get('/api/access', (request) => settings(request));

  app.post('/api/access/verify', async (request, reply) => {
    const body = parse(VerifyBody, request.body, reply);
    if (!body) return;
    if (throttled(request, reply)) return;
    const client = gate.clientKey(request);
    const method = await gate.method();
    const ok =
      method === 'key'
        ? (await gate.checkKey(body.secret)) !== undefined
        : method === 'password'
          ? (await store.verify({ secret: body.secret })).ok
          : true;
    if (!ok) {
      gate.limiter.fail(client);
      return reply.code(401).send({ error: 'invalid', message: WRONG });
    }
    gate.limiter.succeed(client, gate.isLocal(request));
    const sessionId = currentSessionId(request);
    if (sessionId) {
      await store.markVerified(sessionId);
      if (request.access?.kind === 'session') request.access.session.verifiedAt = Date.now();
    }
    return settings(request);
  });

  /**
   * A checkup finding's one-click fix. Only the actions in `CheckupAction` run,
   * each only takes trust away, and each keeps the verification its own
   * settings route asks for. Returns the checkup without the finding.
   */
  app.post('/api/access/fix', async (request, reply) => {
    const body = parse(CheckupFixBody, request.body, reply);
    if (!body) return;
    try {
      const done = await runFix(services, body.action, {
        local: gate.isLocal(request),
        verified: gate.verified(request.access),
      });
      return { done, access: await settings(request) };
    } catch (error) {
      if (!(error instanceof FixError)) throw error;
      return reply
        .code(error.code === 'verify-required' ? 403 : 409)
        .send({ error: error.code, message: error.message });
    }
  });

  app.put('/api/access/password', async (request, reply) => {
    const body = parse(SetPasswordBody, request.body, reply);
    if (!body) return;
    if (!requireVerified(request, reply)) return;
    const keep = currentSessionId(request);
    try {
      await store.setPassword(body.username, body.password, keep);
    } catch (error) {
      if (error instanceof AccessError)
        return reply.code(400).send({ error: error.code, message: error.message });
      throw error;
    }
    // Changing the password signs every other device out (OWASP ASVS 5.0 V7.4.3).
    gate.disconnectAll(keep);
    if (!keep) await startSession(request, reply, 'setup');
    return settings(request);
  });

  app.post('/api/access/keys', async (request, reply) => {
    const body = parse(CreateKeyBody, request.body, reply);
    if (!body) return;
    if (!requireVerified(request, reply)) return;
    const keep = currentSessionId(request);
    const switching = (await store.method()) !== 'key';
    const created = await store.addKey(body.name, keep);
    if (switching) gate.disconnectAll(keep);
    if (!keep) await startSession(request, reply, 'setup', created.info.id);
    return created;
  });

  app.delete<{ Params: { id: string } }>('/api/access/keys/:id', async (request, reply) => {
    const id = parse(Id, request.params.id, reply);
    if (!id) return;
    try {
      const ended = await store.revokeKey(id);
      gate.disconnect(ended);
      // Terminals opened with this key (not a session) end too.
      services.terminal.endOwnedBy([`key:${id}`]);
      if (ended.includes(currentSessionId(request) ?? ''))
        reply.header('set-cookie', gate.clearCookies());
    } catch (error) {
      if (error instanceof AccessError)
        return reply.code(404).send({ error: error.code, message: error.message });
      throw error;
    }
    return settings(request);
  });

  /** Turn sign-in off. Remote devices are then refused until it's turned back on. */
  app.delete('/api/access', async (request, reply) => {
    if (!requireVerified(request, reply)) return;
    const ended = await store.disable();
    gate.disconnect(ended);
    // With sign-in off, other devices can't get in: nor can their terminals stay.
    services.terminal.endWhere((s) => s.meta.openedFrom === 'another-device');
    reply.header('set-cookie', gate.clearCookies());
    return { ok: true };
  });

  app.post('/api/access/pairing', async (request, reply) => {
    if ((await store.method()) === 'none') {
      return reply.code(409).send({
        error: 'no-sign-in',
        message: 'Choose a password or access key first.',
      });
    }
    if (!requireVerified(request, reply)) return;
    return store.createPairing();
  });

  app.delete<{ Params: { id: string } }>('/api/access/sessions/:id', async (request, reply) => {
    const id = parse(Id, request.params.id, reply);
    if (!id) return;
    const removed = await store.revokeSession(id);
    if (!removed) return reply.code(404).send({ error: 'not-found', message: 'Not signed in.' });
    gate.disconnect([id]);
    if (id === currentSessionId(request)) reply.header('set-cookie', gate.clearCookies());
    return settings(request);
  });

  app.delete('/api/access/sessions', async (request) => {
    const ended = await store.revokeOtherSessions(currentSessionId(request));
    gate.disconnect(ended);
    return settings(request);
  });
}
