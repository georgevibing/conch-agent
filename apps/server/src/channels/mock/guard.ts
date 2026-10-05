import type { FastifyInstance } from 'fastify';

import { RequestLimiter } from '../../auth/requests';
import { readCapped } from '../types';

/**
 * Pretend providers have published fixture credentials. Binding to loopback
 * alone does not protect them from a web page or another local program.
 * Budget before body parsing, and share the budget across all callers.
 */
export function guardMockServer(
  app: FastifyInstance,
  options: { burst?: number; perMinute?: number; concurrent?: number; timeoutMs?: number } = {},
): void {
  const requests = new RequestLimiter(options.burst ?? 300, options.perMinute ?? 1200, 1);
  let running = 0;
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    const bound = app.server.address();
    const port = typeof bound === 'object' && bound ? bound.port : undefined;
    if (
      !port ||
      (request.headers.host !== `127.0.0.1:${port}` && request.headers.host !== `localhost:${port}`)
    )
      return reply
        .code(421)
        .send({ error: 'This pretend provider only answers on its local address.' });
    const site = request.headers['sec-fetch-site'];
    if (request.headers.origin !== undefined || (site !== undefined && site !== 'none'))
      return reply.code(403).send({ error: 'Web pages cannot drive a pretend provider.' });
    const wait = requests.take('all');
    if (wait || running >= (options.concurrent ?? 32))
      return reply
        .code(429)
        .header('retry-after', String(Math.max(1, Math.ceil(wait / 1000))))
        .send({ error: 'Too many requests to this pretend provider.' });
    running++;
    const deadline = setTimeout(() => {
      // A completed WebSocket upgrade is intentionally long-lived. An Upgrade
      // header by itself must not exempt a slow HTTP body or response.
      if (request.ws && reply.sent) return;
      request.raw.socket.destroy();
    }, options.timeoutMs ?? 20_000);
    deadline.unref();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(deadline);
      running--;
      reply.raw.off('finish', release);
      reply.raw.off('close', release);
      request.raw.socket.off('close', release);
    };
    reply.raw.once('finish', release);
    reply.raw.once('close', release);
    // A WebSocket hijacks the response; its slot lasts until its socket closes.
    request.raw.socket.once('close', release);
  });
}

/** The origin is injected by Services, never learned from a control request. */
export async function deliverMockHook(
  origin: string | undefined,
  raw: string,
  init: RequestInit = {},
  query?: URLSearchParams,
): Promise<{ status: number; ok: boolean; body: string }> {
  if (!origin) throw new Error('The pretend provider has no trusted delivery address.');
  const target = new URL(raw);
  const expected = new URL(origin);
  if (
    expected.protocol !== 'http:' ||
    expected.hostname !== '127.0.0.1' ||
    !expected.port ||
    expected.origin !== origin ||
    target.origin !== expected.origin ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    !/^\/hooks\/[A-Za-z0-9_-]{1,128}$/.test(target.pathname)
  )
    throw new Error('Pretend providers may deliver only to this Conch’s channel hooks.');
  if (query) target.search = query.toString();
  const deadline = AbortSignal.timeout(15_000);
  const response = await fetch(target, {
    ...init,
    redirect: 'error',
    signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
  });
  return {
    status: response.status,
    ok: response.ok,
    body: (
      await readCapped(response, 1024 * 1024, 'The pretend hook reply is too large.')
    ).toString('utf8'),
  };
}
