import type { AccessMethod, AuthStatus, WaitingApproval } from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Config } from './config';
import { Emitter } from './lib/emitter';
import { SignInLimiter } from './auth/limiter';
import { GatewayRequestLimits } from './auth/requests';
import { HERE_COOKIE_MAX_AGE_S, hereCookieName, ThisComputer } from './auth/here';
import { HostPolicy, isLoopbackAddress, isLoopbackHost } from './auth/network';
import { PasskeyCeremonies, passkeyPlace } from './auth/passkeys';
import { safeEqual } from './auth/secrets';
import {
  type AccessStore,
  type SessionRecord,
  SESSION_MAX_AGE_MS,
  VERIFY_WINDOW_MS,
} from './auth/store';
import { cliName } from './cli/command';
import { A2A_ENDPOINTS } from './a2a/door';

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
export type Resolved =
  Access | 'unauthorized' | 'setup-required' | 'here-required' | 'approval-required';

/** Endpoints anyone may call: enough to load the app and sign in. */
const PUBLIC_API = new Set([
  'GET /api/health',
  'GET /api/auth',
  'POST /api/auth/sign-in',
  'POST /api/auth/sign-out',
  // Handing in a one-time code from `#here=` (ADR 0063); it checks its own.
  'POST /api/here',
  // A passkey challenge to sign in, or to make Conch yours from the hello link (ADR 0064, 0065).
  'POST /api/auth/passkey',
  // The hello link: is it still good, and use it (ADR 0064). Each checks its own code.
  'POST /api/auth/hello',
  'POST /api/auth/hello/finish',
]);

/** What the menu bar helper may ask, with its token instead of a sign-in (ADR 0029). */
const TRAY_API = new Set(['GET /api/tray/status', 'POST /api/tray/quit']);

/** What this computer, proven, may ask even with sign-in on and no session (ADR 0063). */
const HERE_API = new Set(['POST /api/here/link']);

/** Cross-site navigations authenticated by their single-use OAuth flow, not a session cookie. */
const OAUTH_CALLBACKS = new Set([
  '/oauth/callback',
  '/oauth/provider/:flowId',
  '/oauth/google/callback',
]);

/**
 * Other apps and other agents (ADR 0073, ADR 0112) authenticate inside their
 * own routes, but share HTTP admission limits.
 */
const MCP_ENDPOINTS = new Set(['/mcp', '/mcp/hello', '/mcp/session']);

/**
 * The page Prometheus reads (ADR 0119): it checks its own scrape token, and
 * shares the request budgets. Off, it isn't there at all.
 */
const SCRAPE_ENDPOINTS = new Set(['/metrics']);

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
  /** Making and using passkeys (ADR 0065): the challenges it gave out live here. */
  readonly passkeys: PasskeyCeremonies;
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
  /** The menu bar helper's token (ADR 0029), once it has one. */
  #trayToken?: string;

  /** The menu bar helper carries this token in `X-Conch-Tray`. */
  setTrayToken(token: string): void {
    this.#trayToken = token;
  }

  /**
   * The menu bar helper asking: from this computer itself (never a proxy),
   * with its token, compared in constant time. It only reads counts and quits:
   * the helper sends it to whatever listens on Conch's port, so it never opens
   * anything (pages open through `here/asks`, ADR 0063).
   */
  trayAllowed(request: FastifyRequest): boolean {
    const given = request.headers['x-conch-tray'];
    return (
      this.#trayToken !== undefined &&
      typeof given === 'string' &&
      this.looksLocal(request) &&
      safeEqual(given, this.#trayToken)
    );
  }

  constructor(
    readonly config: Config,
    readonly store: AccessStore,
    readonly here: ThisComputer = new ThisComputer(config.CONCH_HOME),
  ) {
    this.hosts = new HostPolicy(config);
    this.passkeys = new PasskeyCeremonies(store);
  }

  /** `CONCH_TOKEN` (legacy) acts as an access key and turns sign-in on. */
  async method(): Promise<AccessMethod> {
    const method = await this.store.method();
    return method === 'none' && this.config.CONCH_TOKEN ? 'key' : method;
  }

  /**
   * A request that *looks* like it's from this computer: a loopback socket, a
   * loopback name, and no proxy saying it relayed it. The loopback socket alone
   * isn't enough: `tailscale serve`, `vite --host` or any reverse proxy on this
   * machine make remote visitors look local. And looks aren't enough either: a
   * proxy that rewrites `Host` and adds no header (nginx's defaults), or another
   * account on this computer, looks exactly like this. So this decides only
   * what describes the connection (cookie flags, "secure"); who gets trusted is
   * `isLocal`.
   */
  looksLocal(request: FastifyRequest): boolean {
    const host = hostname(request.headers.host);
    return (
      isLoopbackAddress(request.socket.remoteAddress) &&
      host !== undefined &&
      isLoopbackHost(host) &&
      !FORWARDED.some((h) => request.headers[h] !== undefined)
    );
  }

  /** The cookie that makes a browser "this computer", for the port this request came in on. */
  hereCookieName(request: FastifyRequest): string {
    return hereCookieName(request.socket.localPort ?? this.config.CONCH_PORT);
  }

  /**
   * Proof that only your account on this computer can have (ADR 0063): the
   * cookie a one-time code gave this browser. The key it's made with never
   * leaves its file, so nothing that is sent can be replayed to mint more.
   */
  proves(request: FastifyRequest): boolean {
    return this.here.checkCookie(readCookie(request.headers.cookie, this.hereCookieName(request)));
  }

  /**
   * This computer, proven: it looks local *and* carries proof (ADR 0063).
   * Everything that trusts "this computer" asks this.
   */
  isLocal(request: FastifyRequest): boolean {
    return this.looksLocal(request) && this.proves(request);
  }

  /** The cookie for a browser that just proved it's on this computer. */
  hereCookie(request: FastifyRequest): string {
    return `${this.hereCookieName(request)}=${this.here.cookie()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${HERE_COOKIE_MAX_AGE_S}`;
  }

  /** HTTPS end to end (directly, or via a local TLS proxy like `tailscale serve`), or never leaves this computer. */
  isSecure(request: FastifyRequest): boolean {
    if (request.protocol === 'https') return true;
    if (this.looksLocal(request)) return true;
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
    if (method === 'none') {
      if (this.isLocal(request)) return { kind: 'local' };
      // Looks like this computer, without the proof: open it from Conch (ADR 0063).
      return this.looksLocal(request) ? 'here-required' : 'setup-required';
    }
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
    const looksLocal = this.looksLocal(request);
    return {
      method: await this.method(),
      signedIn,
      setupRequired: resolved === 'setup-required',
      ...(resolved === 'here-required' && { hereRequired: true }),
      ...(looksLocal && {
        here: this.proves(request) ? ('proven' as const) : ('unproven' as const),
      }),
      secure: this.isSecure(request),
      // Only those still outside need telling: the way back in is on this computer.
      ...(!signedIn && (await this.store.locked()) && { locked: true }),
      ...(approval && { approval }),
      ...(!signedIn && (await this.passkeysHere(request)) && { passkeys: true }),
    };
  }

  /** A passkey made for the address this request came to could sign in (ADR 0065). */
  async passkeysHere(request: FastifyRequest): Promise<boolean> {
    const place = passkeyPlace(request);
    if (!place || (await this.store.method()) === 'none') return false;
    return (await this.store.passkeyRecords()).some((p) => p.rpId === place.rpId);
  }

  /** Sensitive changes need a recent password/key ("sudo mode"). */
  verified(access: Access | undefined): boolean {
    if (!access) return false;
    if (access.kind !== 'session') return true;
    return Date.now() - access.session.verifiedAt < VERIFY_WINDOW_MS;
  }

  sessionCookie(request: FastifyRequest, token: string): string {
    const secure = this.isSecure(request) && !this.looksLocal(request);
    const name = secure ? SECURE_COOKIE : COOKIE;
    return `${name}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_MS / 1000}${secure ? '; Secure' : ''}`;
  }

  /** Long-lived and HttpOnly: page scripts can't read it, so an injected one can't take it away. */
  deviceCookie(request: FastifyRequest, token: string): string {
    const secure = this.isSecure(request) && !this.looksLocal(request);
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
      // Frames are our own pages (artifacts, files, Conch apps), and exactly two video
      // players, so a video plays in the chat. Narrow on purpose: the player's frame is
      // made only after the person presses play (until then nothing loads from YouTube
      // or Vimeo, the poster is a picture the gateway kept); its address is built by
      // Conch from an id checked against the site's own shape (`videoPlayer` in
      // @conch/protocol: 11 letters for YouTube, digits for Vimeo), never a link a
      // model or a page supplied, so nothing from the chat can ride in it; and the
      // frame is sandboxed, has no microphone or camera, and is cross-origin, so it
      // can't read the page. YouTube's player refuses to play without a referrer
      // (error 153), so that one frame sends Conch's origin, never a path; the page
      // itself stays `no-referrer`.
      "frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com",
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
 * 3. **Request budgets** — before body parsing, authentication or route work;
 *    public credential attempts have a smaller budget, reserved immediately.
 * 4. **Sign-in** — everything but loading the app and signing in needs a
 *    session, an access key, or (with sign-in off) this computer, proven
 *    (ADR 0063). Signed-in writes also share a budget per device or access key.
 */
export function registerSecurity(app: FastifyInstance, gate: Gatekeeper): void {
  const localLimits = new GatewayRequestLimits();
  const remoteLimits = new GatewayRequestLimits();
  const reject = (reply: FastifyReply, status: number, error: string, message: string) =>
    reply.code(status).send({ error, message });
  const rateLimited = (reply: FastifyReply, wait: number) => {
    const seconds = Math.ceil(wait / 1000);
    return reply
      .code(429)
      .header('retry-after', String(seconds))
      .send({
        error: 'rate-limited',
        message: `Conch is receiving too many requests. Wait ${seconds} seconds, then try again.`,
        retryAfter: seconds,
      });
  };

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
          `Conch doesn’t answer to “${host ?? '?'}”. To open it there, run “conch setup” on the computer running Conch and choose the way you reach it.`,
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

    const oauthCallback = OAUTH_CALLBACKS.has(path);
    const mcpEndpoint =
      MCP_ENDPOINTS.has(path) || A2A_ENDPOINTS.has(path) || SCRAPE_ENDPOINTS.has(path);
    if (!isApi && !oauthCallback && !mcpEndpoint) return;
    // Only this computer's proof gets its own recovery budget. A loopback
    // socket, a claimed proxy address or an unverified cookie is not enough.
    const limits = gate.isLocal(request) ? localLimits : remoteLimits;
    const client = gate.clientKey(request);
    const incomingWait = limits.incoming(client);
    if (incomingWait) return rateLimited(reply, incomingWait);
    const publicRoute = PUBLIC_API.has(`${request.method} ${path}`);
    if (
      (publicRoute && isWrite) ||
      path === '/api/access/verify' ||
      oauthCallback ||
      // A scraper's wrong tokens count like wrong passwords, in its own route.
      (mcpEndpoint && path !== '/mcp' && !SCRAPE_ENDPOINTS.has(path))
    ) {
      const credentialWait = limits.credentials(client);
      if (credentialWait) return rateLimited(reply, credentialWait);
    }
    if (publicRoute || oauthCallback || mcpEndpoint) return;
    // The menu bar helper (ADR 0029): only these, only with its own token, only from here.
    if (TRAY_API.has(`${request.method} ${path}`)) {
      if (gate.trayAllowed(request)) {
        const wait = isWrite ? limits.write('tray') : 0;
        return wait ? rateLimited(reply, wait) : undefined;
      }
      return reject(reply, 401, 'unauthorized', 'Only Conch’s menu bar helper can ask that.');
    }
    // Another one-time link, for a browser that is already this computer (ADR 0063).
    if (HERE_API.has(`${request.method} ${path}`)) {
      if (gate.isLocal(request)) {
        const wait = limits.write('local');
        return wait ? rateLimited(reply, wait) : undefined;
      }
      return reject(
        reply,
        401,
        'unauthorized',
        'Only a browser Conch opened on the computer running it can ask that.',
      );
    }

    const resolved = await gate.resolve(request);
    if (resolved === 'setup-required') {
      return reject(
        reply,
        401,
        'setup-required',
        'Sign-in isn’t set up yet. On the computer running Conch, open Settings → Security.',
      );
    }
    if (resolved === 'here-required') {
      return reject(
        reply,
        401,
        'here-required',
        `This browser hasn’t been opened from Conch yet. On the computer running Conch, open Conch from your apps, or run: ${cliName()} open`,
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
            : `This key needs your approval to be used from this device. Approve it in Settings → Devices on a device you’ve let in, or on the computer running Conch: ${cliName()} devices approve ${code}`,
      });
    }
    request.access = resolved;
    if (isWrite) {
      const principal =
        resolved.kind === 'session'
          ? `device:${resolved.session.deviceId ?? resolved.session.id}`
          : resolved.kind === 'bearer'
            ? `key:${resolved.keyId}`
            : 'local';
      const wait = limits.write(principal);
      if (wait) return rateLimited(reply, wait);
    }
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
