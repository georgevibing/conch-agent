/**
 * `app.fetch` through the gateway (ADR 0061 §2): only the hosts on the
 * app's card, over https, never inward, redirects re-checked, the app's own
 * headers but nobody's cookies, and limits on everything. A real https
 * server on this computer stands in for the web: the resolver points the
 * test names at it, and only these tests call this computer "public".
 */
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

import { APP_LIMITS } from '@conch/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { placeOf } from '../artifacts/live';
import { createFetcher, type FetcherDeps } from './fetcher';
import type { AppFetchRequest } from './types';

// A certificate for the test names, good for a hundred years (made with openssl, for these tests only).
const KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgRaJFCwdbGlJXUBwd
4vsuWqgn7spL1iL64l0NOcVz2F2hRANCAARVgOZQaB+FdxGfjCQXUbQfbeuh0ZS8
C3DLYTeK6Sg1roEAffPJsY7+63pHyt4ySB/z0FC/zZWKl6DKmshPJoIc
-----END PRIVATE KEY-----
`;
const CERT = `-----BEGIN CERTIFICATE-----
MIIB2TCCAX6gAwIBAgIUL2p735CWAP05Jl/2AFU2I6MjRBcwCgYIKoZIzj0EAwIw
GzEZMBcGA1UEAwwQYXBpLmV4YW1wbGUudGVzdDAgFw0yNjEwMDMxMzI3MzJaGA8y
MTI2MDkwOTEzMjczMlowGzEZMBcGA1UEAwwQYXBpLmV4YW1wbGUudGVzdDBZMBMG
ByqGSM49AgEGCCqGSM49AwEHA0IABFWA5lBoH4V3EZ+MJBdRtB9t66HRlLwLcMth
N4rpKDWugQB988mxjv7rekfK3jJIH/PQUL/NlYqXoMqayE8mghyjgZ0wgZowHQYD
VR0OBBYEFOIfboFLuditVukmRIV1NdzedR8vMB8GA1UdIwQYMBaAFOIfboFLudit
VukmRIV1NdzedR8vMA8GA1UdEwEB/wQFMAMBAf8wRwYDVR0RBEAwPoIQYXBpLmV4
YW1wbGUudGVzdIISb3RoZXIuZXhhbXBsZS50ZXN0ghZlbHNld2hlcmUuZXhhbXBs
ZS50ZXN0MAoGCCqGSM49BAMCA0kAMEYCIQCUrMQYYtMp6RL8RwkpyZKwAyN+x1Iw
loTx0L/9FDyQXQIhAO8fwQbqjxNAEYBOej2ahfwkN0ReocBbukvoxmxzQtTG
-----END CERTIFICATE-----
`;

let server: Server;
let port = 0;
const seen: { path: string; method: string; headers: Record<string, unknown> }[] = [];

beforeAll(async () => {
  server = createServer({ key: KEY, cert: CERT }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const path = req.url ?? '/';
      seen.push({ path, method: req.method ?? '', headers: req.headers });
      const echo = () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            method: req.method,
            path,
            headers: req.headers,
            body: body.toString('utf8'),
            bytes: [...body],
          }),
        );
      };
      const go = (status: number, location: string) => {
        res.writeHead(status, { location });
        res.end();
      };
      if (path.startsWith('/echo')) return echo();
      if (path === '/bin') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        return res.end(Buffer.from([0, 1, 2, 255]));
      }
      if (path === '/gzip') {
        res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
        return res.end(gzipSync(JSON.stringify({ zipped: true })));
      }
      if (path === '/big') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        const chunk = Buffer.alloc(1024 * 1024, 'a');
        for (let i = 0; i < 6; i++) res.write(chunk);
        return res.end();
      }
      if (path === '/big-declared') {
        res.writeHead(200, {
          'content-type': 'text/plain',
          'content-length': String(APP_LIMITS.fetchBack + 1),
        });
        return res.end();
      }
      if (path === '/slow') return;
      if (path === '/r303') return go(303, '/echo');
      if (path === '/r302') return go(302, '/echo');
      if (path === '/r307') return go(307, '/echo');
      if (path === '/r308') return go(308, '/echo');
      if (path === '/loop') return go(302, '/loop');
      if (path.startsWith('/hop/')) {
        const left = Number(path.slice(5));
        return go(302, left > 0 ? `/hop/${left - 1}` : '/echo');
      }
      if (path === '/to-other') return go(307, `https://other.example.test:${port}/echo`);
      if (path === '/to-elsewhere') return go(302, `https://elsewhere.example.test:${port}/echo`);
      if (path === '/to-metadata') return go(302, 'https://169.254.169.254/latest/meta-data/');
      if (path === '/to-http') return go(302, `http://api.example.test:${port}/echo`);
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not here');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const names: Record<string, string[]> = {
  'api.example.test': ['127.0.0.1'],
  'other.example.test': ['127.0.0.1'],
  'elsewhere.example.test': ['127.0.0.1'],
  'metadata.example.test': ['169.254.169.254'],
  'lan.example.test': ['10.0.0.5'],
  'home.example.test': ['127.0.0.1'],
  'mixed.example.test': ['127.0.0.1', '192.168.1.1'],
};
const resolve = vi.fn(async (hostname: string) =>
  (names[hostname] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
);

/** Only these tests call this computer "public", so the server above stands in for the web. */
const place = (address: string) => (address === '127.0.0.1' ? 'public' : placeOf(address));

function fetcher(deps: FetcherDeps = {}) {
  return createFetcher({ resolve, place, ca: CERT, ...deps });
}

const app = {
  id: 'plant-diary',
  reaches: [
    'api.example.test',
    'other.example.test',
    'metadata.example.test',
    'lan.example.test',
    'mixed.example.test',
  ],
};

const request = (path: string, extra: Partial<AppFetchRequest> = {}): AppFetchRequest => ({
  url: `https://api.example.test:${port}${path}`,
  method: 'GET',
  headers: {},
  ...extra,
});

const go = (
  f: ReturnType<typeof fetcher>,
  r: AppFetchRequest,
  signal = new AbortController().signal,
) => f(app, r, signal);

const json = (body: string) =>
  JSON.parse(body) as {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: string;
    bytes: number[];
  };

describe('app.fetch: what an app may send', () => {
  it('sends the app’s method, headers and body, and reads the answer', async () => {
    const f = fetcher();
    const answer = await go(
      f,
      request('/echo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'k-123' },
        body: '{"plant":"fern"}',
      }),
    );
    expect(answer).toMatchObject({ ok: true, status: 200 });
    expect(answer.refused).toBeUndefined();
    const echoed = json(answer.body);
    expect(echoed.method).toBe('POST');
    expect(echoed.body).toBe('{"plant":"fern"}');
    expect(echoed.headers['x-api-key']).toBe('k-123');
    expect(echoed.headers['content-type']).toBe('application/json');
    expect(echoed.headers['user-agent']).toBe('Conch app (plant-diary)');
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const)
      expect(json((await go(f, request('/echo', { method }))).body).method).toBe(method);
  });

  it('never sends cookies, a host, proxy or hop-by-hop headers', async () => {
    const answer = await go(
      fetcher(),
      request('/echo', {
        headers: {
          cookie: 'session=yours',
          host: 'evil.example',
          'proxy-authorization': 'Basic x',
          'x-forwarded-for': '10.0.0.1',
          connection: 'upgrade',
          upgrade: 'websocket',
          'transfer-encoding': 'chunked',
          'x-kept': 'yes',
        },
      }),
    );
    const headers = json(answer.body).headers;
    expect(headers.cookie).toBeUndefined();
    expect(headers.host).toBe(`api.example.test:${port}`);
    expect(headers['proxy-authorization']).toBeUndefined();
    expect(headers['x-forwarded-for']).toBeUndefined();
    expect(headers.upgrade).toBeUndefined();
    expect(headers['x-kept']).toBe('yes');
  });

  it('sends bytes as they are, and refuses a body too big, on a GET, or a header with a line break', async () => {
    const f = fetcher();
    const bytes = Buffer.from([0, 255, 10, 13]);
    const answer = await go(
      f,
      request('/echo', { method: 'PUT', body: bytes.toString('base64'), bodyBase64: true }),
    );
    expect(json(answer.body).bytes).toEqual([0, 255, 10, 13]);
    const big = await go(
      f,
      request('/echo', { method: 'POST', body: 'x'.repeat(APP_LIMITS.fetchOut + 1) }),
    );
    expect(big.refused).toMatch(/too much to send/);
    expect((await go(f, request('/echo', { body: 'x' }))).refused).toBe(
      'A GET request can’t carry a body.',
    );
    expect(
      (await go(f, request('/echo', { headers: { 'x-a': 'one\r\nx-b: two' } }))).refused,
    ).toMatch(/line break/);
    expect((await go(f, request('/echo', { headers: { 'x-name': 'Zoë' } }))).refused).toMatch(
      /characters a header can’t carry/,
    );
    expect(
      (await go(f, request('/echo', { method: 'TRACE' as AppFetchRequest['method'] }))).refused,
    ).toMatch(/can’t send TRACE/);
  });

  it('gives binary back as base64, text as text, and unzips what came zipped', async () => {
    const f = fetcher();
    const bin = await go(f, request('/bin'));
    expect(bin.bodyBase64).toBe(true);
    expect([...Buffer.from(bin.body, 'base64')]).toEqual([0, 1, 2, 255]);
    const zipped = await go(f, request('/gzip'));
    expect(JSON.parse(zipped.body)).toEqual({ zipped: true });
    expect(zipped.headers['content-encoding']).toBeUndefined();
    const missing = await go(f, request('/nowhere'));
    expect(missing).toMatchObject({ ok: false, status: 404, body: 'not here' });
    expect(missing.refused).toBeUndefined();
    const head = await go(f, request('/echo', { method: 'HEAD' }));
    expect(head).toMatchObject({ ok: true, status: 200, body: '' });
  });

  it('stops at 5 MB back, whether it says so first or not', async () => {
    const f = fetcher();
    expect((await go(f, request('/big'))).refused).toMatch(/more than an app can take/);
    expect((await go(f, request('/big-declared'))).refused).toMatch(/more than an app can take/);
  });

  it('gives up on a site that doesn’t answer, and when the call is stopped', async () => {
    expect((await go(fetcher({ timeoutMs: 300 }), request('/slow'))).refused).toBe(
      `api.example.test:${port} took too long to answer.`,
    );
    const controller = new AbortController();
    const pending = go(fetcher(), request('/slow'), controller.signal);
    setTimeout(() => controller.abort(), 100);
    expect((await pending).refused).toBe('The request was stopped.');
  });
});

describe('app.fetch: where an app may go', () => {
  it('only reaches the hosts on its card, over https, with no sign-in in the address', async () => {
    const f = fetcher();
    expect(
      (await go(f, { ...request('/echo'), url: `https://elsewhere.example.test:${port}/echo` }))
        .refused,
    ).toMatch(
      /may only reach api\.example\.test.*not elsewhere\.example\.test\. Add it to “reaches”/,
    );
    expect(
      (await go(f, { ...request('/echo'), url: `http://api.example.test:${port}/echo` })).refused,
    ).toMatch(/isn’t a secure \(https\) address/);
    expect(
      (await go(f, { ...request('/echo'), url: `https://user:pw@api.example.test:${port}/echo` }))
        .refused,
    ).toMatch(/sign-in/);
    expect((await go(f, { ...request('/echo'), url: 'https://127.0.0.1/x' })).refused).toMatch(
      /may only reach/,
    );
    expect((await go(f, { ...request('/echo'), url: 'not a url' })).refused).toMatch(
      /isn’t a web address/,
    );
  });

  it('never connects inward: this computer, your network, metadata — checked as it connects', async () => {
    // Without the test's stand-in, this computer is what it is: refused.
    const real = createFetcher({ resolve, ca: CERT });
    expect((await go(real, request('/echo'))).refused).toBe(
      'api.example.test is on this computer, which apps can’t reach.',
    );
    const f = fetcher();
    expect(
      (await go(f, { ...request('/'), url: 'https://metadata.example.test/latest/meta-data/' }))
        .refused,
    ).toBe('metadata.example.test points somewhere Conch never connects to.');
    expect((await go(f, { ...request('/'), url: 'https://lan.example.test/' })).refused).toBe(
      'lan.example.test is on your own network, which apps can’t reach.',
    );
    // One bad address among good ones refuses the name.
    expect(
      (await go(f, { ...request('/'), url: `https://mixed.example.test:${port}/echo` })).refused,
    ).toBe('mixed.example.test is on your own network, which apps can’t reach.');
  });

  it('never reaches Conch’s own port', async () => {
    expect((await go(fetcher({ gatewayPort: port }), request('/echo'))).refused).toBe(
      'An app can’t reach Conch itself.',
    );
  });

  it('re-checks every redirect: method and body kept by 307 and 308, GET after 303', async () => {
    const f = fetcher();
    const post = {
      method: 'POST' as const,
      body: 'hello',
      headers: { 'content-type': 'text/plain' },
    };
    for (const path of ['/r307', '/r308']) {
      const echoed = json((await go(f, request(path, post))).body);
      expect(echoed).toMatchObject({ method: 'POST', body: 'hello', path: '/echo' });
    }
    for (const path of ['/r303', '/r302']) {
      const echoed = json((await go(f, request(path, post))).body);
      expect(echoed).toMatchObject({ method: 'GET', body: '', path: '/echo' });
      expect(echoed.headers['content-type']).toBeUndefined();
    }
    expect(json((await go(f, request('/hop/2'))).body).path).toBe('/echo');
    expect((await go(f, request('/hop/3'))).refused).toMatch(/sent the request on too many times/);
    expect((await go(f, request('/loop'))).refused).toMatch(/too many times/);
  });

  it('follows a redirect only to a host the app may reach, and never carries credentials across', async () => {
    const f = fetcher();
    const other = await go(
      f,
      request('/to-other', { headers: { authorization: 'Bearer secret', 'x-api-key': 'k' } }),
    );
    const headers = json(other.body).headers;
    expect(headers.host).toBe(`other.example.test:${port}`);
    expect(headers.authorization).toBeUndefined();
    expect(headers['x-api-key']).toBe('k');
    const same = await go(f, request('/r307', { headers: { authorization: 'Bearer mine' } }));
    expect(json(same.body).headers.authorization).toBe('Bearer mine');
    expect((await go(f, request('/to-elsewhere'))).refused).toBe(
      'elsewhere.example.test isn’t one of the sites this app may reach, and the request was sent on to it.',
    );
    expect((await go(f, request('/to-metadata'))).refused).toMatch(/isn’t one of the sites/);
    expect((await go(f, request('/to-http'))).refused).toMatch(/https/);
  });

  it('allows public research redirects while still rejecting private and insecure destinations', async () => {
    const f = fetcher({ publicRedirects: true });
    const result = await go(f, request('/to-elsewhere'));
    expect(result.refused).toBeUndefined();
    expect(result.url).toBe(`https://elsewhere.example.test:${port}/echo`);
    expect((await go(f, request('/to-metadata'))).refused).toMatch(/never connects/);
    expect((await go(f, request('/to-http'))).refused).toMatch(/https/);
  });

  it('makes at most 600 requests an hour per app, then holds off', async () => {
    let now = 1_000_000;
    const f = fetcher({ now: () => now });
    const lan = { ...request('/'), url: 'https://lan.example.test/' };
    for (let i = 0; i < APP_LIMITS.fetchPerHour; i++) await go(f, lan);
    expect((await go(f, lan)).refused).toMatch(/600 requests in the last hour/);
    // Another app has its own hour.
    expect(
      (await f({ ...app, id: 'other-app' }, lan, new AbortController().signal)).refused,
    ).toMatch(/your own network/);
    now += 3_600_001;
    expect((await go(f, lan)).refused).toMatch(/your own network/);
    // A host it can't reach at all doesn't use up its hour.
    const g = fetcher({ now: () => now });
    for (let i = 0; i < APP_LIMITS.fetchPerHour + 5; i++)
      await go(g, { ...request('/'), url: 'https://nowhere.example/' });
    expect((await go(g, lan)).refused).toMatch(/your own network/);
  });
});
