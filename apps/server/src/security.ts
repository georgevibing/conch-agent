import type { AccessMethod, AuthStatus, WaitingApproval } from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Config } from './config';
import { Emitter } from './lib/emitter';
import { SignInLimiter } from './auth/limiter';
import { HostPolicy, isLoopbackAddress, isLoopbackHost } from './auth/network';
import { safeEqual } from './auth/secrets';
import {
  type AccessStore,
  type SessionRecord,
  SESSION_MAX_AGE_MS,
  VERIFY_WINDOW_MS,
} from './auth/store';

/** How a request was let in. */
export type Access =
  | { kind: 'local' }
  | { kind: 'session'; session: SessionRecord }
  | { kind: 'bearer'; keyId: string };

declare module 'fastify' {
  interface FastifyRequest {
    access?: Access;
    /** A script's key that needs approval to be used from this device. */
    approval?: WaitingApproval;
  }
}

/** Who a request is, or why it isn't let in. */
export type Resolved = Access | 'unauthorized' | 'setup-required' | 'approval-required';

/** Endpoints anyone may call: enough to load the app and sign in. */
const PUBLIC_API = new Set([
  'GET /api/health',
  'GET /api/auth',
  'POST /api/auth/sign-in',
  'POST /api/auth/sign-out',
]);

const COOKIE = 'conch_session';
/** `__Host-` cookies must be Secure, host-only and Path=/ — browsers enforce it. */
const SECURE_COOKIE = `__Host-${COOKIE}`;
/** Names this browser as a device, across sign-ins. Never cleared by signing out. */
const DEVICE_COOKIE = 'conch_device';
const SECURE_DEVICE_COOKIE = `__Host-${DEVICE_COOKIE}`;
/** Browsers cap a cookie's life at 400 days (RFC 6265bis). */
const DEVICE_MAX_AGE_S = 400 * 24 * 60 * 60;
/** How often open sockets are checked against `access.json` (the terminal may have changed it). */
const SWEEP_MS = 2000;

function hostname(hostHeader: string | undefined): string | undefined {
  if (!hostHeader) return undefined;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

const FORWARDED = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip'];

/**
 * Decides who gets in. One instance per gateway; shared by the HTTP hooks,
 * the auth routes and the WebSocket handler.
 */
export class Gatekeeper {
  readonly limiter = new SignInLimiter();
  readonly hosts: HostPolicy;
  /** Open sockets per session, so signing a device out disconnects it at once. */
  readonly #sockets = new Map<string, Set<{ close(code?: number, reason?: string): void }>>();
  /** Sessions just signed out, so what they started (terminals) can end with them. */
  readonly signedOut = new Emitter<string[]>();
  /** Devices changed (perhaps from the terminal): `waiting` asking for approval. */
  readonly devicesChanged = new Emitter<{ waiting: number }>();
  /** Which open sockets are on this computer, so approval doesn't apply to them. */
  readonly #localSockets = new WeakSet<object>();
  #sweep?: ReturnType<typeof setInterval>;
  #seen = '';

  constructor(
    readonly config: Config,
    readonly store: AccessStore,
  ) {
    this.hosts = new HostPolicy(config);
  }

  /** `CONCH_TOKEN` (legacy) acts as an access key and turns sign-in on. */
  async method(): Promise<AccessMethod> {
    const method = await this.store.method();
    return method === 'none' && this.config.CONCH_TOKEN ? 'key' : method;
  }

  /**
   * A request from this computer, to a loopback name, not relayed by a proxy.
   * The loopback socket alone isn't enough: `tailscale serve`, `vite --host`
   * or any reverse proxy on this machine make remote visitors look local.
   */
  isLocal(request: FastifyRequest): boolean {
    const host = hostname(request.headers.host);
    return (
      isLoopbackAddress(request.socket.remoteAddress) &&
      host !== undefined &&
      isLoopbackHost(host) &&
      !FORWARDED.some((h) => request.headers[h] !== undefined)
    );
  }

  /** HTTPS end to end (directly, or via a local TLS proxy like `tailscale serve`), or never leaves this computer. */
  isSecure(request: FastifyRequest): boolean {
    if (request.protocol === 'https') return true;
    if (this.isLocal(request)) return true;
    return (
      isLoopbackAddress(request.socket.remoteAddress) &&
      request.headers['x-forwarded-proto'] === 'https'
    );
  }

  /**
   * Throttle key: the client address, or its /64 for IPv6 (one device gets a
   * whole /64). Behind a local proxy, the *last* X-Forwarded-For entry is the
   * one the proxy added; earlier entries are whatever the client claimed.
   */
  clientKey(request: FastifyRequest): string {
    const forwarded = request.headers['x-forwarded-for'];
    const ip =
      forwarded && isLoopbackAddress(request.socket.remoteAddress)
        ? (String(forwarded).split(',').at(-1)?.trim() ?? '')
        : (request.socket.remoteAddress ?? '');
    return ip.includes(':') && !ip.startsWith('::ffff:') ? ip.split(':').slice(0, 4).join(':') : ip;
  }

  sessionToken(request: FastifyRequest): string | undefined {
    const cookie = request.headers.cookie;
    return readCookie(cookie, SECURE_COOKIE) ?? readCookie(cookie, COOKIE);
  }

  deviceToken(request: FastifyRequest): string | undefined {
    const cookie = request.headers.cookie;
    return readCookie(cookie, SECURE_DEVICE_COOKIE) ?? readCookie(cookie, DEVICE_COOKIE);
  }

  /**
   * New devices need the person's OK for this request: approval is on, and
   * it doesn't come from this computer (which is where approving happens).
   */
  async approvalApplies(request: FastifyRequest): Promise<boolean> {
    return !this.isLocal(request) && (await this.store.approvalOn());
  }

  async resolve(request: FastifyRequest): Promise<Resolved> {
    const method = await this.method();
    const token = this.sessionToken(request);
    if (token) {
      const session = await this.store.findSession(token);
      if (session) {
        // With approval on, a session from elsewhere counts only on an approved device.
        if (
          (await this.approvalApplies(request)) &&
          !(await this.store.deviceApproved(session.deviceId))
        )
          return 'unauthorized';
        return { kind: 'session', session };
      }
    }
    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
    if (bearer) {
      if (this.limiter.retryAfter(this.clientKey(request), this.isLocal(request)) > 0)
        return 'unauthorized';
      const keyId = await this.checkKey(bearer);
      if (!keyId) {
        this.limiter.fail(this.clientKey(request));
        return 'unauthorized';
      }
      if (await this.approvalApplies(request)) {
        const keyName =
          keyId === 'env'
            ? 'CONCH_TOKEN'
            : ((await this.store.keys()).find((k) => k.id === keyId)?.name ?? 'an access key');
        const access = await this.store.scriptAccess({
          keyId,
          keyName,
          userAgent: request.headers['user-agent'],
          address: this.clientKey(request),
        });
        if (!access.approved) {
          request.approval = access.request;
          return 'approval-required';
        }
      }
      return { kind: 'bearer', keyId };
    }
    if (method === 'none') return this.isLocal(request) ? { kind: 'local' } : 'setup-required';
    return 'unauthorized';
  }

  /** The id of the key this is, if it's a valid key. */
  async checkKey(key: string): Promise<string | undefined> {
    if (this.config.CONCH_TOKEN && safeEqual(key.trim(), this.config.CONCH_TOKEN)) return 'env';
    if ((await this.store.method()) !== 'key') return undefined;
    return (await this.store.verifyKey(key)).keyId;
  }

  async status(request: FastifyRequest): Promise<AuthStatus> {
    const resolved = request.access ?? (await this.resolve(request));
    const signedIn = typeof resolved === 'object';
    const token = signedIn ? undefined : this.sessionToken(request);
    const approval = token ? await this.store.waitingFor(token) : undefined;
    return {
      method: await this.method(),
      signedIn,
      setupRequired: resolved === 'setup-required',
      secure: this.isSecure(request),
      // Only those still outside need telling: the way back in is on this computer.
      ...(!signedIn && (await this.store.locked()) && { locked: true }),
      ...(approval && { approval }),
    };
  }

  /** Sensitive changes need a recent password/key ("sudo mode"). */
  verified(access: Access | undefined): boolean {
    if (!access) return false;
    if (access.kind !== 'session') return true;
    return Date.now() - access.session.verifiedAt < VERIFY_WINDOW_MS;
  }

  sessionCookie(request: FastifyRequest, token: string): string {
    const secure = this.isSecure(request) && !this.isLocal(request);
    const name = secure ? SECURE_COOKIE : COOKIE;
    return `${name}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_MS / 1000}${secure ? '; Secure' : ''}`;
  }

  /** Long-lived and HttpOnly: page scripts can't read it, so an injected one can't take it away. */
  deviceCookie(request: FastifyRequest, token: string): string {
    const secure = this.isSecure(request) && !this.isLocal(request);
    const name = secure ? SECURE_DEVICE_COOKIE : DEVICE_COOKIE;
    return `${name}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DEVICE_MAX_AGE_S}${secure ? '; Secure' : ''}`;
  }

  clearCookies(): string[] {
    return [
      `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
      `${SECURE_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure`,
    ];
  }

  track(
    sessionId: string,
    socket: { close(code?: number, reason?: string): void },
    local = false,
  ): () => void {
    let set = this.#sockets.get(sessionId);
    if (!set) this.#sockets.set(sessionId, (set = new Set()));
    set.add(socket);
    if (local) this.#localSockets.add(socket);
    this.#startSweep();
    return () => {
      set.delete(socket);
      if (!set.size) this.#sockets.delete(sessionId);
      if (!this.#sockets.size) this.#stopSweep();
    };
  }

  /**
   * While anyone is connected, look at `access.json` every couple of seconds:
   * `pnpm conch` may have signed a device out, removed it, or approved one, in
   * another process. Closes what was signed out and says when devices changed.
   */
  #startSweep() {
    if (this.#sweep) return;
    this.#sweep = setInterval(() => void this.sweep().catch(() => undefined), SWEEP_MS);
    this.#sweep.unref();
  }

  #stopSweep() {
    clearInterval(this.#sweep);
    this.#sweep = undefined;
  }

  async sweep(): Promise<void> {
    const file = await this.store.get();
    const approval = await this.store.approvalOn();
    const ended: string[] = [];
    for (const [id, sockets] of this.#sockets) {
      const session = file.sessions.find((s) => s.id === id);
      const active = await this.store.sessionActive(id);
      const approved = !approval || (await this.store.deviceApproved(session?.deviceId));
      if (!active) ended.push(id);
      else if (!approved)
        for (const socket of sockets)
          if (!this.#localSockets.has(socket)) socket.close(4401, 'Signed out');
    }
    if (ended.length) this.disconnect(ended);
    const now = Date.now();
    const waiting = file.requests.filter((r) => r.rejectedAt === undefined && r.expiresAt > now);
    const seen = JSON.stringify([
      approval,
      waiting.map((r) => r.code),
      file.devices.map((d) => [d.id, d.approvedAt, d.label]),
      file.sessions.filter((s) => !s.pending).map((s) => s.id),
    ]);
    if (seen !== this.#seen) {
      const first = this.#seen === '';
      this.#seen = seen;
      if (!first) this.devicesChanged.emit({ waiting: waiting.length });
    }
  }

  /** Disconnect signed-out devices right away. */
  disconnect(sessionIds: Iterable<string>): void {
    const ids = [...sessionIds];
    for (const id of ids) {
      for (const socket of this.#sockets.get(id) ?? []) socket.close(4401, 'Signed out');
      this.#sockets.delete(id);
    }
    if (ids.length) this.signedOut.emit(ids);
  }

  disconnectAll(except?: string): void {
    this.disconnect([...this.#sockets.keys()].filter((id) => id !== except));
  }
}

function securityHeaders(request: FastifyRequest, reply: FastifyReply, secure: boolean) {
  const host = request.headers.host ?? '';
  reply.headers({
    // Only our own code runs, and nothing loads from elsewhere: remote images
    // are blocked too, so a prompt-injected reply can't leak data through an
    // <img> URL.
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'self'",
      // Toasts and animation libraries inject <style> at runtime. Styles can't run
      // script, and React escapes all content, so this is the accepted trade-off.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src 'self' ws://${host} wss://${host}`,
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'origin-agent-cluster': '?1',
    'x-dns-prefetch-control': 'off',
    'permissions-policy':
      // The microphone is Conch's own, for dictation and talk mode (ADR 0027); never an embedded page's.
      'camera=(), geolocation=(), microphone=(self), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()',
  });
  if (secure && request.protocol === 'https')
    reply.header('strict-transport-security', 'max-age=31536000');
  const route = request.routeOptions.url ?? '';
  if (route.startsWith('/api/') || route === '/ws') reply.header('cache-control', 'no-store');
}

/**
 * Guards every request, in order:
 *
 * 1. **Host** must be one of ours — defeats DNS rebinding.
 * 2. **Fetch metadata / Origin** — a page on another site (or another port
 *    of localhost) can't call the API or open the WebSocket.
 * 3. **Sign-in** — everything but loading the app and signing in needs a
 *    session, an access key, or (with sign-in off) a genuinely local request.
 */
export function registerSecurity(app: FastifyInstance, gate: Gatekeeper): void {
  const reject = (reply: FastifyReply, status: number, error: string, message: string) =>
    reply.code(status).send({ error, message });

  // Only JSON bodies. `text/plain` is a "simple" content type that a hostile
  // page can send cross-site without a preflight, so we don't parse it at all.
  app.removeContentTypeParser('text/plain');

  // Node detaches upgraded sockets from its HTTP parser. If an early guard
  // rejects before @fastify/websocket sets request.ws, its cleanup hook cannot
  // close the socket. A proxy must not reuse that connection for another request.
  // Successful upgrades are hijacked by ws and do not run onSend.
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.headers.upgrade?.toLowerCase() === 'websocket') reply.header('connection', 'close');
    return payload;
  });
  app.addHook('onResponse', async (request) => {
    if (request.headers.upgrade?.toLowerCase() === 'websocket') request.raw.socket.end();
  });

  app.addHook('onRequest', async (request, reply) => {
    const host = hostname(request.headers.host);
    if (!host || !gate.hosts.allows(host)) {
      return reply
        .code(421)
        .type('text/plain')
        .send(
          `Conch doesn’t answer to “${host ?? '?'}”. To allow it, start Conch with CONCH_ALLOWED_HOSTS=${host ?? 'name'}.`,
        );
    }
    securityHeaders(request, reply, gate.isSecure(request));

    // Classify by the route Fastify actually matched, never the raw URL, so
    // tricks like `/%61pi/state` or `//api/state` can't dodge the check.
    const path = request.routeOptions.url ?? '';
    const isApi = path.startsWith('/api/') || path === '/ws';
    const isWrite = request.method !== 'GET' && request.method !== 'HEAD';
    const isUpgrade = request.headers.upgrade?.toLowerCase() === 'websocket';

    // Fetch Metadata resource isolation: refuse anything a *different* site
    // initiated, except plain navigations to the app (e.g. clicking a link).
    const site = request.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') {
      const navigation =
        request.headers['sec-fetch-mode'] === 'navigate' && !isWrite && !isApi && !isUpgrade;
      if (!navigation) return reject(reply, 403, 'cross-site', 'Cross-site request refused.');
    }

    // Origin must be exactly this host and port. Comparing hostnames alone
    // would let any page on localhost:<other port> drive the agent.
    const origin = request.headers.origin;
    if (origin !== undefined && (isWrite || isUpgrade || isApi)) {
      let originHost: string | undefined;
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        originHost = undefined;
      }
      if (!originHost || originHost !== request.headers.host?.toLowerCase())
        return reject(reply, 403, 'cross-origin', 'Cross-origin request refused.');
    }

    if (!isApi || PUBLIC_API.has(`${request.method} ${path}`)) return;

    const resolved = await gate.resolve(request);
    if (resolved === 'setup-required') {
      return reject(
        reply,
        401,
        'setup-required',
        'Sign-in isn’t set up yet. On the computer running Conch, open Settings → Security.',
      );
    }
    if (resolved === 'unauthorized') return reject(reply, 401, 'unauthorized', 'Please sign in.');
    if (resolved === 'approval-required') {
      const code = request.approval?.code ?? '';
      return reply.code(403).send({
        error: 'approval-required',
        code,
        message:
          request.approval?.state === 'rejected'
            ? 'Using this key from this device was turned down.'
            : `This key needs your approval to be used from this device. On the computer running Conch, run: pnpm conch devices approve ${code}`,
      });
    }
    request.access = resolved;
    // A browser signed in before Conch kept devices gets its device cookie now.
    if (resolved.kind === 'session' && !gate.deviceToken(request)) {
      const adopted = await gate.store.adoptDevice(resolved.session.id, gate.clientKey(request));
      if (adopted) {
        resolved.session.deviceId = adopted.deviceId;
        reply.header('set-cookie', gate.deviceCookie(request, adopted.token));
      }
    }
  });
}
