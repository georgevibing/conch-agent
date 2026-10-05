import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deliverMockHook, guardMockServer } from './guard';
import { MockGoogleChat } from './googlechat';
import { MockLine } from './line';
import { MockTeams } from './teams';
import { MockTwilio } from './twilio';
import { MockWeChat } from './wechat';

const close: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const stop of close.splice(0).reverse()) await stop();
});

async function serve(app: FastifyInstance): Promise<string> {
  close.push(() => app.close());
  await app.listen({ host: '127.0.0.1', port: 0 });
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

describe('pretend providers cannot become network proxies', () => {
  it('requires an independent trusted door origin and rejects other hosts, ports and paths', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const origin = 'http://127.0.0.1:4321';
    await expect(deliverMockHook(undefined, `${origin}/hooks/id`)).rejects.toThrow(/trusted/);
    for (const raw of [
      'https://example.com/hooks/id',
      'http://169.254.169.254/hooks/id',
      'http://127.0.0.1:4322/hooks/id',
      'http://localhost:4321/hooks/id',
      'http://user:pass@127.0.0.1:4321/hooks/id',
      `${origin}/api/access`,
      `${origin}/hooks/id/../../api/access`,
      `${origin}/hooks/id?target=elsewhere`,
      `${origin}/hooks/id#fragment`,
    ])
      await expect(deliverMockHook(origin, raw)).rejects.toThrow();
    await expect(
      deliverMockHook('http://example.com:4321', 'http://example.com:4321/hooks/id'),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not follow even a same-origin redirect or leak callback headers across origins', async () => {
    const received = vi.fn(() => 'should not be reached');
    const other = Fastify();
    other.post('/hooks/leak', received);
    const elsewhere = await serve(other);
    const app = Fastify();
    app.post('/hooks/cross', (_request, reply) => reply.redirect(`${elsewhere}/hooks/leak`, 307));
    app.post('/hooks/local', (_request, reply) => reply.redirect('/hooks/leak', 307));
    app.post('/hooks/leak', received);
    const origin = await serve(app);
    for (const route of ['cross', 'local'])
      await expect(
        deliverMockHook(origin, `${origin}/hooks/${route}`, {
          method: 'POST',
          headers: { authorization: 'Bearer fixture', 'x-line-signature': 'fixture' },
          body: 'message',
        }),
      ).rejects.toThrow();
    expect(received).not.toHaveBeenCalled();
  });

  it('keeps WeChat verification queries on the approved hook and caps streamed replies', async () => {
    const app = Fastify();
    app.get<{ Querystring: { echostr: string } }>(
      '/hooks/verify',
      (request) => request.query.echostr,
    );
    app.get('/hooks/large', (_request, reply) =>
      reply.send(Readable.from([Buffer.alloc(700_000), Buffer.alloc(700_000)])),
    );
    const origin = await serve(app);
    expect(
      await deliverMockHook(
        origin,
        `${origin}/hooks/verify`,
        {},
        new URLSearchParams({ echostr: 'http://169.254.169.254/#?x&y=</script>' }),
      ),
    ).toMatchObject({ status: 200, body: 'http://169.254.169.254/#?x&y=</script>' });
    await expect(deliverMockHook(origin, `${origin}/hooks/large`)).rejects.toThrow(/too large/);
  });

  it('puts a deadline on headers and a stalled reply body', async () => {
    const app = Fastify();
    app.get('/hooks/stall', (_request, reply) => {
      const stream = new Readable({
        read() {
          this.push('started');
          this._read = () => undefined;
        },
      });
      return reply.send(stream);
    });
    const origin = await serve(app);
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const deadline = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => timeout(50));
    await expect(deliverMockHook(origin, `${origin}/hooks/stall`)).rejects.toThrow();
    expect(deadline).toHaveBeenCalledWith(15_000);
  });

  it('applies the destination boundary in every callback-producing provider', async () => {
    const captured = vi.fn(() => 'leaked');
    const sink = Fastify();
    sink.all('/hooks/leak', captured);
    const other = await serve(sink);
    const door = await serve(Fastify());
    const teams = new MockTeams();
    const wechat = new MockWeChat();
    const line = new MockLine();
    const twilio = new MockTwilio();
    const google = new MockGoogleChat();
    for (const mock of [teams, wechat, line, twilio, google]) {
      await mock.start();
      close.push(() => mock.stop());
      mock.deliveryOrigin = () => door;
    }
    const endpoint = `${other}/hooks/leak`;
    teams.endpoint(endpoint);
    line.endpoint = endpoint;
    twilio.number.sms_url = endpoint;
    google.endpoint(endpoint);
    await expect(teams.say('private')).rejects.toThrow(/channel hooks/);
    await expect(wechat.configure(endpoint, 'fixture')).rejects.toThrow(/channel hooks/);
    expect(await line.say('private')).toBe(0);
    expect(await twilio.say('private')).toBe(0);
    expect(await google.say('private')).toBe(0);
    expect(captured).not.toHaveBeenCalled();
  });
});

describe('pretend provider admission', () => {
  it('rejects browser origins and rebinding hosts before reading a control body', async () => {
    const app = Fastify();
    guardMockServer(app);
    const work = vi.fn(() => ({ ok: true }));
    app.post('/__control/say', work);
    const origin = await serve(app);
    for (const headers of [
      { origin: 'https://evil.example' },
      { 'sec-fetch-site': 'cross-site' },
      { origin },
    ])
      expect((await fetch(`${origin}/__control/say`, { method: 'POST', headers })).status).toBe(
        403,
      );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/__control/say',
          headers: { host: 'evil.example' },
        })
      ).statusCode,
    ).toBe(421);
    expect(work).not.toHaveBeenCalled();
    expect((await fetch(`${origin}/__control/say`, { method: 'POST' })).status).toBe(200);
  });

  it('charges one shared burst before parsing, even if caller and token headers rotate', async () => {
    const app = Fastify();
    guardMockServer(app, { burst: 2, perMinute: 1 });
    const work = vi.fn(() => ({ ok: true }));
    app.post('/token', work);
    const origin = await serve(app);
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`${origin}/token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': `192.0.2.${i}`,
          authorization: `Bearer ${i}`,
        },
        body: '{',
      });
      expect(response.status).toBe(i < 2 ? 400 : 429);
      if (i === 2) expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    }
    expect(work).not.toHaveBeenCalled();
  });

  it('ends a stalled HTTP handler and releases its slot at the fixed deadline', async () => {
    const app = Fastify();
    guardMockServer(app, { concurrent: 1, timeoutMs: 100 });
    let finish: (() => void) | undefined;
    app.get(
      '/stall',
      () =>
        new Promise<string>((resolve) => {
          finish = () => resolve('late');
        }),
    );
    app.get('/ready', () => 'ready');
    const origin = await serve(app);
    const stalled = fetch(`${origin}/stall`).then(
      () => 'unexpected response',
      () => 'closed',
    );
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect((await fetch(`${origin}/ready`)).status).toBe(429);
    expect(await stalled).toBe('closed');
    finish?.();
    expect((await fetch(`${origin}/ready`)).status).toBe(200);
  });

  it('caps concurrent work and releases its slot after completion', async () => {
    const app = Fastify();
    guardMockServer(app, { concurrent: 2 });
    const waiting: (() => void)[] = [];
    app.get('/wait', () => new Promise<string>((resolve) => waiting.push(() => resolve('done'))));
    app.get('/ready', () => 'ready');
    const origin = await serve(app);
    const first = fetch(`${origin}/wait`);
    const second = fetch(`${origin}/wait`);
    await vi.waitFor(() => expect(waiting).toHaveLength(2));
    expect((await fetch(`${origin}/ready`)).status).toBe(429);
    for (const done of waiting) done();
    await Promise.all([first, second]);
    expect((await fetch(`${origin}/ready`)).status).toBe(200);
  });
});
