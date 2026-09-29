import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Config } from './config';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

function hostname(hostHeader: string | undefined): string | undefined {
  if (!hostHeader) return undefined;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Guards against the two ways a web page could reach a local agent:
 *
 * - DNS rebinding: a malicious domain resolving to 127.0.0.1. We only answer
 *   requests whose `Host` is loopback or explicitly allowed.
 * - Cross-site requests: browsers always send `Origin` on WebSocket upgrades
 *   and cross-origin writes; it must be one of ours.
 *
 * When remote access is enabled, a shared token is additionally required.
 */
export function registerSecurity(app: FastifyInstance, config: Config): void {
  const allowed = new Set([...LOCAL_HOSTS, ...config.CONCH_ALLOWED_HOSTS]);
  if (config.CONCH_ALLOW_REMOTE) allowed.add(config.CONCH_HOST.toLowerCase());

  const reject = (reply: FastifyReply, status: number, message: string) =>
    reply.code(status).type('text/plain').send(message);

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const host = hostname(request.headers.host);
    if (!host || !allowed.has(host)) return reject(reply, 421, 'Unknown host');

    const origin = request.headers.origin;
    const isWrite = request.method !== 'GET' && request.method !== 'HEAD';
    const isUpgrade = request.headers.upgrade?.toLowerCase() === 'websocket';
    if (origin && (isWrite || isUpgrade)) {
      const originHost = hostname(origin.replace(/^[a-z]+:\/\//i, ''));
      if (!originHost || !allowed.has(originHost))
        return reject(reply, 403, 'Cross-origin request');
    }

    if (config.CONCH_TOKEN) {
      const url = new URL(request.url, 'http://x');
      const fromQuery = url.searchParams.get('token');
      const fromCookie = /(?:^|;\s*)conch_token=([^;]+)/.exec(request.headers.cookie ?? '')?.[1];
      const fromHeader = request.headers.authorization?.replace(/^Bearer\s+/i, '');
      const token = fromQuery ?? fromCookie ?? fromHeader;
      if (token !== config.CONCH_TOKEN) return reject(reply, 401, 'Missing or invalid token');
      if (fromQuery) {
        reply.header(
          'set-cookie',
          `conch_token=${fromQuery}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
        );
      }
    }
  });
}
