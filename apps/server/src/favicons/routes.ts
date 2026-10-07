/**
 * `GET /api/favicon?host=example.com`: a site's own icon, for the site chips
 * in a chat (ADR 0103). Under `/api`, so behind the gateway's host, origin,
 * budget and sign-in checks like every other route. A failure is a quick 404:
 * the chip shows a monogram instead.
 */
import type { FastifyInstance } from 'fastify';

import { faviconHost, type Favicons } from './favicons';

export function registerFaviconRoutes(app: FastifyInstance, favicons: Favicons): void {
  app.get<{ Querystring: { host?: unknown } }>('/api/favicon', async (request, reply) => {
    const host = faviconHost(request.query.host);
    if (!host)
      return reply
        .code(400)
        .send({ error: 'bad-request', message: 'Say which site by its name, like example.com.' });
    const icon = await favicons.get(host);
    if (icon === 'busy')
      return reply.code(429).header('retry-after', '600').send({
        error: 'rate-limited',
        message: 'Conch has looked up a lot of site icons lately. It will look again soon.',
      });
    if (!icon)
      return reply
        .code(404)
        .header('cache-control', 'private, max-age=3600')
        .send({ error: 'not-found', message: 'That site has no icon Conch shows.' });
    return reply
      .type(icon.type)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'private, max-age=86400')
      .send(icon.bytes);
  });
}
