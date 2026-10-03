import { userInfo } from 'node:os';

import {
  AccessSettings,
  AddPasskeyBody,
  CheckupFixBody,
  CreateKeyBody,
  HelloCheck,
  HelloCheckBody,
  HelloFinishBody,
  Id,
  PasskeyOptionsBody,
  RenameDeviceBody,
  RenamePasskeyBody,
  SetApprovalBody,
  SetPasswordBody,
  SignInBody,
  VerifyBody,
  type PasskeyAssertion,
  type SignInVia,
} from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { CHANNEL_NAMES } from '../channels/catalog';
import type { Gatekeeper } from '../security';
import type { Services } from '../services';
import { checkup, findTokenProfile, workspaceRules } from './checkup';
import { describeDevice } from './device';
import { FixError, runFix } from './fixes';
import { exposure } from './network';
import { PasskeyError, passkeyPlace } from './passkeys';
import { AccessError } from './store';
import { sandboxSupport } from '../conversations/sandbox';
import { cliName } from '../cli/command';

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

  /** This browser, as a device: the one its cookie names, or a new one, and the cookie to send. */
  const thisDevice = async (request: FastifyRequest, via: SignInVia) => {
    const { device, token } = await store.signInDevice({
      token: gate.deviceToken(request),
      userAgent: request.headers['user-agent'],
      address: gate.clientKey(request),
      via,
    });
    return { device, cookie: gate.deviceCookie(request, token) };
  };

  const startSession = async (
    request: FastifyRequest,
    reply: FastifyReply,
    via: SignInVia,
    keyId?: string,
    deviceId?: string,
    passkeyId?: string,
  ) => {
    // Setting up sign-in signs this browser in: as a device, like any sign-in.
    const fresh = deviceId ? undefined : await thisDevice(request, via);
    const { token, session } = await store.createSession({
      via,
      userAgent: request.headers['user-agent'],
      keyId,
      ...(passkeyId && { passkeyId }),
      deviceId: deviceId ?? fresh?.device.id,
    });
    reply.header('set-cookie', gate.sessionCookie(request, token));
    if (fresh) reply.header('set-cookie', fresh.cookie);
    request.access = { kind: 'session', session };
  };

  const currentDeviceId = (request: FastifyRequest) =>
    request.access?.kind === 'session' ? request.access.session.deviceId : undefined;

  /** Approving a device, and turning approval off, happen only on the computer running Conch. */
  const requireHere = (request: FastifyRequest, reply: FastifyReply, what: string) => {
    if (gate.isLocal(request)) return true;
    void reply.code(403).send({
      error: 'here-only',
      message: `${what} on the computer running Conch: open Conch from your apps there, then Settings → Security; or run ${cliName()} devices in its terminal.`,
    });
    return false;
  };

  /**
   * Who may let a waiting device in (ADR 0065): this computer, or a device
   * that is itself approved. That device also confirms it's you first
   * (`requireVerified`), so a stolen session alone can't let its friends in.
   */
  const mayApprove = async (request: FastifyRequest) =>
    gate.isLocal(request) ||
    (request.access?.kind === 'session' && (await store.deviceApproved(currentDeviceId(request))));

  /** The name of the device this page is open on, to say who approved whom. */
  const currentDeviceName = async (request: FastifyRequest) => {
    const id = currentDeviceId(request);
    return id ? (await store.devices({ deviceId: id })).find((d) => d.id === id)?.name : undefined;
  };

  const changed = async () => {
    const waiting = (await store.requests()).filter((r) => !r.rejected).length;
    gate.devicesChanged.emit({ waiting });
  };

  /** A passkey's answer, checked for what it was asked for: the passkey it was, or nothing. */
  const passkeyAnswers = async (
    request: FastifyRequest,
    response: PasskeyAssertion,
    purpose: 'sign-in' | 'verify',
  ) => {
    const place = passkeyPlace(request);
    if (!place) return undefined;
    try {
      const used = await gate.passkeys.verifyAuthentication({
        response,
        place,
        purpose,
        ...(purpose === 'verify' && { sessionId: currentSessionId(request) }),
      });
      return used.id;
    } catch (error) {
      if (error instanceof PasskeyError) return undefined;
      throw error;
    }
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
      passkeys: await store.passkeys(passkeyPlace(request)?.rpId),
      passkeysHere: passkeyPlace(request) !== undefined,
      sessions: await store.sessions(currentSessionId(request)),
      devices: await store.devices({ deviceId: currentDeviceId(request) }),
      requests: await store.requests(),
      approval: {
        on: await store.approvalOn(),
        here: gate.isLocal(request),
        canApprove: await mayApprove(request),
      },
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
        pagesLocal: [
          ...new Set(
            (await services.artifacts.live.access.list().catch(() => []))
              .filter((a) => a.local)
              .map((a) => a.host),
          ),
        ],
        terminalRemote: (await services.terminal.settings()).allowRemote,
        provider: await services.providers.checkupCopy(),
        channels: await services.channels.checkupCopy(),
        ...(services.door.status().state === 'ready' &&
          services.door.status().url && {
            door: {
              url: services.door.status().url ?? '',
              apps: services.door.status().apps.map((kind) => CHANNEL_NAMES[kind]),
            },
          }),
        safety: {
          checkAfterReading: preferences.checkAfterReading,
          sealedCommands: preferences.sealedCommands,
          sandboxAvailable: sandboxSupport().available,
        },
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
    let passkeyId: string | undefined;
    if (body.with === 'pairing') {
      ok = await store.consumePairing(body.code);
    } else if (body.with === 'key') {
      keyId = await gate.checkKey(body.key);
      ok = keyId !== undefined;
    } else if (body.with === 'passkey') {
      passkeyId =
        method === 'none' ? undefined : await passkeyAnswers(request, body.response, 'sign-in');
      ok = passkeyId !== undefined;
    } else if (method === 'password') {
      ok = (await store.verify({ username: body.username, secret: body.password })).ok;
    }
    if (!ok) {
      gate.limiter.fail(client);
      return reply.code(401).send({ error: 'invalid', message: WRONG });
    }
    gate.limiter.succeed(client, local);
    const { device, cookie } = await thisDevice(request, body.with);
    if (await store.approvalOn()) {
      // This computer, a one-time link made by a device already let in, and a
      // passkey (the device and the person at once, ADR 0065) approve it.
      if (local || body.with === 'pairing' || body.with === 'passkey')
        await store.approveDevice(
          device.id,
          local ? 'this-computer' : body.with === 'pairing' ? 'link' : 'passkey',
        );
      else if (device.approvedAt === undefined) {
        // Right password or key, new device: it waits for the person's OK.
        let waiting;
        try {
          const started = await store.startWaiting({
            deviceId: device.id,
            via: body.with,
            keyId,
            userAgent: request.headers['user-agent'],
            address: client,
          });
          reply.header('set-cookie', gate.sessionCookie(request, started.token));
          reply.header('set-cookie', cookie);
          waiting = started.request;
        } catch (error) {
          if (error instanceof AccessError && error.code === 'busy')
            return reply.code(429).send({ error: 'busy', message: error.message });
          throw error;
        }
        await changed();
        return { ...(await gate.status(request)), signedIn: false, approval: waiting };
      }
    }
    await startSession(request, reply, body.with, keyId, device.id, passkeyId);
    reply.header('set-cookie', cookie);
    await changed();
    return gate.status(request);
  });

  /** Also how a device stops waiting for its approval. The device itself is remembered. */
  app.post('/api/auth/sign-out', async (request, reply) => {
    const token = gate.sessionToken(request);
    const ended = token ? await store.endSession(token) : undefined;
    if (ended) {
      gate.disconnect([ended]);
      await changed();
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
    // Only "no sign-in" has nothing to confirm. Every other way needs its proof:
    // a passkey, or the password or key (a passkey-only Conch has no secret to type).
    const ok =
      'passkey' in body
        ? (await passkeyAnswers(request, body.passkey, 'verify')) !== undefined
        : method === 'none'
          ? true
          : method === 'key'
            ? (await gate.checkKey(body.secret)) !== undefined
            : (await store.verify({ secret: body.secret })).ok;
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

  // ── Devices ────────────────────────────────────────────────────────────

  /**
   * Approve new devices. Turning it on adds protection, so any signed-in
   * device may (after confirming it's you). Turning it off takes it away, so
   * only this computer can: someone who got your password can't undo it.
   */
  app.put('/api/access/approval', async (request, reply) => {
    const body = parse(SetApprovalBody, request.body, reply);
    if (!body) return;
    if (!body.on && !requireHere(request, reply, 'Turn this off')) return;
    if (!requireVerified(request, reply)) return;
    try {
      await store.setApproval(body.on, {
        ...(gate.isLocal(request) && { hereDeviceId: currentDeviceId(request) }),
      });
    } catch (error) {
      if (error instanceof AccessError)
        return reply.code(409).send({ error: error.code, message: error.message });
      throw error;
    }
    await changed();
    return settings(request);
  });

  app.post<{ Params: { code: string } }>(
    '/api/access/requests/:code/approve',
    async (request, reply) => {
      if (!(await mayApprove(request)))
        return reply.code(403).send({
          error: 'approver-only',
          message:
            'Only a device that’s already let in can approve another. Approve it on one of those, or on the computer running Conch.',
        });
      if (!requireVerified(request, reply)) return;
      const local = gate.isLocal(request);
      try {
        await store.approve(
          request.params.code.slice(0, 16),
          local ? 'settings' : 'device',
          local ? undefined : await currentDeviceName(request),
        );
      } catch (error) {
        if (error instanceof AccessError)
          return reply.code(404).send({ error: error.code, message: error.message });
        throw error;
      }
      await changed();
      return settings(request);
    },
  );

  /** Turning a device down only takes trust away: any signed-in device may. */
  app.delete<{ Params: { code: string } }>('/api/access/requests/:code', async (request, reply) => {
    try {
      await store.reject(request.params.code.slice(0, 16));
    } catch (error) {
      if (error instanceof AccessError)
        return reply.code(404).send({ error: error.code, message: error.message });
      throw error;
    }
    await changed();
    return settings(request);
  });

  app.delete<{ Params: { id: string } }>('/api/access/devices/:id', async (request, reply) => {
    const id = parse(Id, request.params.id, reply);
    if (!id) return;
    try {
      const { ended } = await store.removeDevice(id);
      gate.disconnect(ended);
      if (ended.includes(currentSessionId(request) ?? ''))
        reply.header('set-cookie', gate.clearCookies());
    } catch (error) {
      if (error instanceof AccessError)
        return reply.code(404).send({ error: error.code, message: error.message });
      throw error;
    }
    await changed();
    return settings(request);
  });

  app.post<{ Params: { id: string } }>(
    '/api/access/devices/:id/sign-out',
    async (request, reply) => {
      const id = parse(Id, request.params.id, reply);
      if (!id) return;
      try {
        const ended = await store.signOutDevice(id);
        gate.disconnect(ended);
        if (ended.includes(currentSessionId(request) ?? ''))
          reply.header('set-cookie', gate.clearCookies());
      } catch (error) {
        if (error instanceof AccessError)
          return reply.code(404).send({ error: error.code, message: error.message });
        throw error;
      }
      await changed();
      return settings(request);
    },
  );

  app.patch<{ Params: { id: string } }>('/api/access/devices/:id', async (request, reply) => {
    const id = parse(Id, request.params.id, reply);
    if (!id) return;
    const body = parse(RenameDeviceBody, request.body, reply);
    if (!body) return;
    try {
      await store.renameDevice(id, body.name);
    } catch (error) {
      if (error instanceof AccessError)
        return reply.code(404).send({ error: error.code, message: error.message });
      throw error;
    }
    await changed();
    return settings(request);
  });

  // ── Passkeys (ADR 0065) ────────────────────────────────────────────────

  const NO_PASSKEYS_HERE = {
    error: 'no-passkeys-here',
    message:
      'Passkeys need a secure address: open Conch at its https:// address (or on this computer) to use one.',
  };

  /**
   * A challenge for a passkey. Signing in and the hello link are public (the
   * route is), each checked for what it is; adding one and confirming it's
   * you need a sign-in (`/api/access/passkeys/options` below).
   */
  app.post('/api/auth/passkey', async (request, reply) => {
    const body = parse(PasskeyOptionsBody, request.body, reply);
    if (!body) return;
    if (throttled(request, reply)) return;
    const place = passkeyPlace(request);
    if (!place) return reply.code(409).send(NO_PASSKEYS_HERE);
    if (body.purpose === 'sign-in')
      return { options: await gate.passkeys.authenticationOptions({ place, purpose: 'sign-in' }) };
    if (body.purpose === 'hello') {
      const check = await store.checkHello(body.code);
      if (!check.ok) {
        gate.limiter.fail(gate.clientKey(request));
        return reply.code(410).send(helloGone(check.reason));
      }
      return {
        options: await gate.passkeys.registrationOptions({
          place,
          purpose: 'hello',
          helloCode: body.code,
          userName: suggestedUsername(),
        }),
      };
    }
    return reply.code(401).send({ error: 'unauthorized', message: 'Please sign in.' });
  });

  app.post('/api/access/passkeys/options', async (request, reply) => {
    const body = parse(PasskeyOptionsBody, request.body, reply);
    if (!body) return;
    const place = passkeyPlace(request);
    if (!place) return reply.code(409).send(NO_PASSKEYS_HERE);
    const sessionId = currentSessionId(request);
    if (body.purpose === 'verify')
      return {
        options: await gate.passkeys.authenticationOptions({
          place,
          purpose: 'verify',
          ...(sessionId && { sessionId }),
        }),
      };
    if (body.purpose === 'add') {
      const file = await store.get();
      return {
        options: await gate.passkeys.registrationOptions({
          place,
          purpose: 'add',
          ...(sessionId && { sessionId }),
          userName: file.username ?? suggestedUsername(),
        }),
      };
    }
    return reply.code(400).send({ error: 'bad-request', message: 'Ask /api/auth/passkey.' });
  });

  /** Add a passkey: a new way in, so it needs a fresh confirmation (sudo mode). */
  app.post('/api/access/passkeys', async (request, reply) => {
    const body = parse(AddPasskeyBody, request.body, reply);
    if (!body) return;
    if (!requireVerified(request, reply)) return;
    const place = passkeyPlace(request);
    if (!place) return reply.code(409).send(NO_PASSKEYS_HERE);
    const sessionId = currentSessionId(request);
    try {
      const { passkey } = await gate.passkeys.verifyRegistration({
        response: body.response,
        place,
        purpose: 'add',
        ...(sessionId && { sessionId }),
        deviceName: describeDevice(request.headers['user-agent']).device,
      });
      const before = await store.method();
      await store.addPasskey(passkey, sessionId);
      // The first way in on a Conch with sign-in off: this browser stays signed in.
      if (before === 'none') {
        gate.disconnectAll(sessionId);
        if (!sessionId) await startSession(request, reply, 'setup');
      }
    } catch (error) {
      if (error instanceof PasskeyError)
        return reply.code(400).send({ error: 'passkey', message: error.message });
      throw error;
    }
    return settings(request);
  });

  /** A credential id: base64url, and it can be long (up to 1,023 bytes). */
  const PasskeyId = z.string().regex(/^[A-Za-z0-9_-]{16,1400}$/);

  app.patch<{ Params: { id: string } }>('/api/access/passkeys/:id', async (request, reply) => {
    const id = parse(PasskeyId, request.params.id, reply);
    if (!id) return;
    const body = parse(RenamePasskeyBody, request.body, reply);
    if (!body) return;
    try {
      await store.renamePasskey(id, body.name);
    } catch (error) {
      if (error instanceof AccessError)
        return reply.code(404).send({ error: error.code, message: error.message });
      throw error;
    }
    return settings(request);
  });

  app.delete<{ Params: { id: string } }>('/api/access/passkeys/:id', async (request, reply) => {
    const id = parse(PasskeyId, request.params.id, reply);
    if (!id) return;
    if (!requireVerified(request, reply)) return;
    try {
      const ended = await store.removePasskey(id);
      gate.disconnect(ended);
      if (ended.includes(currentSessionId(request) ?? ''))
        reply.header('set-cookie', gate.clearCookies());
    } catch (error) {
      if (error instanceof AccessError)
        return reply
          .code(error.code === 'not-found' ? 404 : 409)
          .send({ error: error.code, message: error.message });
      throw error;
    }
    return settings(request);
  });

  // ── The hello link: a new Conch is made yours (ADR 0064) ─────────────────

  const helloGone = (reason: 'expired' | 'claimed') =>
    reason === 'claimed'
      ? {
          error: 'claimed',
          message:
            'This Conch is already someone’s. If it’s yours, sign in. To start again, run conch reset on the computer running it.',
        }
      : {
          error: 'expired',
          message:
            'This link has been used or has run out. On the computer running Conch, run conch hello for a new one.',
        };

  app.post('/api/auth/hello', async (request, reply) => {
    const body = parse(HelloCheckBody, request.body, reply);
    if (!body) return;
    if (throttled(request, reply)) return;
    const check = await store.checkHello(body.code);
    if (!check.ok) gate.limiter.fail(gate.clientKey(request));
    return HelloCheck.parse({
      ok: check.ok,
      ...(check.ok ? { expiresAt: check.expiresAt } : { reason: check.reason }),
      address: request.headers.host ?? '',
      suggestedUsername: suggestedUsername(),
      passkeys: passkeyPlace(request) !== undefined,
    });
  });

  /**
   * Use the hello link: the passkey or password becomes the way in, new
   * devices need approving, and this browser is the first device, approved
   * and signed in. The code is checked again here, so one that ran out or
   * was used in another tab sets nothing.
   */
  app.post('/api/auth/hello/finish', async (request, reply) => {
    const body = parse(HelloFinishBody, request.body, reply);
    if (!body) return;
    if (throttled(request, reply)) return;
    const check = await store.checkHello(body.code);
    if (!check.ok) {
      gate.limiter.fail(gate.clientKey(request));
      return reply.code(410).send(helloGone(check.reason));
    }
    let passkeyId: string | undefined;
    try {
      if (body.with === 'passkey') {
        const place = passkeyPlace(request);
        if (!place) return reply.code(409).send(NO_PASSKEYS_HERE);
        const made = await gate.passkeys.verifyRegistration({
          response: body.response,
          place,
          purpose: 'hello',
          helloCode: body.code,
          deviceName: describeDevice(request.headers['user-agent']).device,
        });
        await store.claim(body.code, {
          kind: 'passkey',
          passkey: made.passkey,
          ownerId: made.ownerId ?? '',
        });
        passkeyId = made.passkey.id;
      } else {
        await store.claim(body.code, {
          kind: 'password',
          username: body.username,
          password: body.password,
        });
      }
    } catch (error) {
      if (error instanceof PasskeyError)
        return reply.code(400).send({ error: 'passkey', message: error.message });
      if (error instanceof AccessError)
        return error.code === 'weak-password'
          ? reply.code(400).send({ error: error.code, message: error.message })
          : reply.code(410).send(helloGone('expired'));
      throw error;
    }
    gate.limiter.succeed(gate.clientKey(request), gate.isLocal(request));
    // Anyone still connected from before (sign-in was off) is signed out now.
    gate.disconnectAll();
    const { device, cookie } = await thisDevice(request, 'hello');
    await store.approveDevice(device.id, 'hello');
    await startSession(request, reply, 'hello', undefined, device.id, passkeyId);
    reply.header('set-cookie', cookie);
    await changed();
    return gate.status(request);
  });
}
