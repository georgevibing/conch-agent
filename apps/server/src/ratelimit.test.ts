import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { limitRoutes } from './ratelimit';

describe('limitRoutes', () => {
  it('answers 429 with Retry-After once a key spends its window, before the body is read', async () => {
    const app = Fastify();
    await limitRoutes(app, {
      max: 2,
      timeWindow: 60_000,
      key: (request) => String(request.headers['x-who']),
      message: (seconds) => `Wait ${seconds} seconds.`,
    });
    const work = vi.fn(() => ({ ok: true }));
    app.post('/work', work);
    const send = (who: string) =>
      app.inject({
        method: 'POST',
        url: '/work',
        headers: { 'x-who': who, 'content-type': 'application/json' },
        payload: '{"a":1}',
      });
    expect((await send('a')).statusCode).toBe(200);
    expect((await send('a')).statusCode).toBe(200);
    const refused = await send('a');
    expect(refused.statusCode).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(refused.headers['x-ratelimit-limit']).toBeUndefined();
    expect(refused.json()).toMatchObject({
      error: 'rate-limited',
      message: expect.stringMatching(/^Wait \d+ seconds\.$/),
    });
    expect(work).toHaveBeenCalledTimes(2);
    // Another key has its own budget, and a success carries no budget headers.
    const other = await send('b');
    expect(other.statusCode).toBe(200);
    expect(other.headers['x-ratelimit-remaining']).toBeUndefined();
    await app.close();
  });

  it('does not count a request an earlier server hook refused', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (request, reply) => {
      if (request.headers['x-refuse']) return reply.code(403).send({ error: 'no' });
    });
    await limitRoutes(app, {
      max: 1,
      timeWindow: 60_000,
      key: () => 'all',
      message: () => 'Wait.',
    });
    app.get('/x', () => 'ok');
    for (let i = 0; i < 5; i++)
      expect((await app.inject({ url: '/x', headers: { 'x-refuse': '1' } })).statusCode).toBe(403);
    expect((await app.inject('/x')).statusCode).toBe(200);
    expect((await app.inject('/x')).statusCode).toBe(429);
    await app.close();
  });
});
