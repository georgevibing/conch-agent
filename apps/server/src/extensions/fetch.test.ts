/**
 * How a declared provider reaches its company (ADR 0122): only its own
 * hosts, over https, never inward, its key the way it declared and nothing
 * of anyone else's, and the answer streamed as it comes. A real https server
 * on this computer stands in for the company; only these tests call this
 * computer "public".
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { placeOf } from '../artifacts/live';
import { headersFor, partFetch, type PartFetchOptions } from './fetch';

// The test certificate `conchapps/fetcher.test.ts` keeps (api.example.test, other.example.test),
// read from there so it lives in one place.
const shared = readFileSync(
  join(import.meta.dirname, '..', 'conchapps', 'fetcher.test.ts'),
  'utf8',
);
const pem = (kind: string) =>
  new RegExp(`-----BEGIN ${kind}-----[\\s\\S]+?-----END ${kind}-----\\n`).exec(shared)?.[0] ?? '';
const KEY = pem('PRIVATE KEY');
const CERT = pem('CERTIFICATE');

let server: Server;
let port = 0;
const seen: Record<string, unknown>[] = [];

beforeAll(async () => {
  server = createServer({ key: KEY, cert: CERT }, (req, res) => {
    seen.push(req.headers);
    if (req.url === '/v1/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: one\n\n');
      setTimeout(() => res.end('data: two\n\n'), 30);
      return;
    }
    if (req.url === '/v1/moved') {
      res.writeHead(302, { location: 'https://other.example.test/v1/x' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'a=b' });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** The test names answer on this computer, called public here only. */
const options = (extra: Partial<PartFetchOptions> = {}): PartFetchOptions => ({
  app: { id: 'example', name: 'Example AI', reaches: ['api.example.test'] },
  provider: { auth: 'bearer' },
  resolve: async () => [{ address: '127.0.0.1', family: 4 }],
  place: () => 'public',
  ca: CERT,
  ...extra,
});
const at = (path: string, host = 'api.example.test') => `https://${host}:${port}${path}`;

describe('a declared provider’s fetch', () => {
  it('reaches its own host and streams the answer as it comes', async () => {
    const fetch = partFetch(options());
    const response = await fetch(at('/v1/stream'));
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toBe('data: one\n\n');
    let rest = '';
    for (;;) {
      const next = await reader?.read();
      if (!next || next.done) break;
      rest += new TextDecoder().decode(next.value);
    }
    expect(rest).toBe('data: two\n\n');
  });

  it('refuses any other host, plain http, and a sign-in in the address', async () => {
    const fetch = partFetch(options());
    await expect(fetch(at('/v1', 'other.example.test'))).rejects.toThrow(
      /may only reach api\.example\.test, not other\.example\.test/,
    );
    await expect(fetch(`http://api.example.test:${port}/v1`)).rejects.toThrow(/over https/);
    await expect(fetch(`https://u:p@api.example.test:${port}/v1`)).rejects.toThrow(
      /credentials|sign-in/,
    );
  });

  it('never reaches inward, whatever the name says', async () => {
    // The real map of places: 127.0.0.1 is this computer.
    const fetch = partFetch(options({ place: placeOf }));
    await expect(fetch(at('/v1'))).rejects.toThrow(/on this computer/);
    const lan = partFetch(
      options({ place: placeOf, resolve: async () => [{ address: '192.168.1.20', family: 4 }] }),
    );
    await expect(lan(at('/v1'))).rejects.toThrow(/your own network/);
    const metadata = partFetch(
      options({ place: placeOf, resolve: async () => [{ address: '169.254.169.254', family: 4 }] }),
    );
    await expect(metadata(at('/v1'))).rejects.toThrow(/never connects to/);
  });

  it('never follows a redirect, and passes no cookie back', async () => {
    const fetch = partFetch(options());
    const moved = await fetch(at('/v1/moved'));
    expect(moved.status).toBe(302);
    const plain = await fetch(at('/v1'));
    expect(plain.headers.get('set-cookie')).toBeNull();
  });

  it('sends the key the way the provider declared, and nothing of Conch’s', async () => {
    seen.length = 0;
    const header = partFetch(options({ provider: { auth: 'header', header: 'x-api-key' } }));
    await header(at('/v1'), {
      headers: { authorization: 'Bearer k-123', cookie: 'conch=1', 'x-forwarded-for': '1.2.3.4' },
    });
    expect(seen.at(-1)).toMatchObject({ 'x-api-key': 'k-123' });
    expect(seen.at(-1)).not.toHaveProperty('authorization');
    expect(seen.at(-1)).not.toHaveProperty('cookie');
    expect(seen.at(-1)).not.toHaveProperty('x-forwarded-for');
    const none = partFetch(options({ provider: { auth: 'none' } }));
    await none(at('/v1'), { headers: { authorization: 'Bearer k-123' } });
    expect(seen.at(-1)).not.toHaveProperty('authorization');
  });

  it('moves a bearer key into the declared header and keeps the rest', () => {
    const headers = headersFor(
      new Headers({ authorization: 'Bearer abc', 'anthropic-version': '2023-06-01', host: 'x' }),
      { auth: 'header', header: 'api-key' },
      'example',
    );
    expect(headers).toMatchObject({ 'api-key': 'abc', 'anthropic-version': '2023-06-01' });
    expect(headers).not.toHaveProperty('host');
  });
});
