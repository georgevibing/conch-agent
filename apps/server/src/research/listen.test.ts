/**
 * `GET /api/listen`: a music card's preview or episode, streamed through
 * Conch. A real https server on this computer stands in for Apple and a
 * podcast host: the resolver points the test names at it, and only these
 * tests call this computer "public".
 */
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';

import type { ConversationEvent } from '@conch/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { placeOf } from '../artifacts/live';
import { audioType, carriedIn, registerListenRoutes, type Carried } from './listen';

// The app fetcher's test certificate (api / other / elsewhere .example.test), for these tests only.
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

const AUDIO = Buffer.alloc(64 * 1024, 7);
let upstream: Server;
let port = 0;
const seen: { path: string; headers: Record<string, unknown> }[] = [];
let closed = 0;

beforeAll(async () => {
  upstream = createServer({ key: KEY, cert: CERT }, (req, res) => {
    const path = req.url ?? '/';
    seen.push({ path, headers: req.headers });
    res.on('close', () => closed++);
    if (path === '/preview.m4a') {
      const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
      if (range) {
        const from = Number(range[1]);
        const to = range[2] ? Number(range[2]) : AUDIO.length - 1;
        res.writeHead(206, {
          'content-type': 'audio/x-m4a',
          'content-length': String(to - from + 1),
          'content-range': `bytes ${from}-${to}/${AUDIO.length}`,
          'accept-ranges': 'bytes',
          'set-cookie': 'tracker=1',
        });
        return res.end(AUDIO.subarray(from, to + 1));
      }
      res.writeHead(200, {
        'content-type': 'audio/x-m4a',
        'content-length': String(AUDIO.length),
        'accept-ranges': 'bytes',
      });
      return res.end(AUDIO);
    }
    if (path === '/episode.mp3') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(AUDIO);
    }
    if (path === '/page.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html>');
    }
    if (path === '/endless.mp3') {
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      const timer = setInterval(() => res.write(Buffer.alloc(16 * 1024, 1)), 5);
      res.on('close', () => clearInterval(timer));
      return;
    }
    if (path === '/to-other.m4a') {
      res.writeHead(302, { location: `https://other.example.test:${port}/preview.m4a` });
      return res.end();
    }
    if (path === '/to-lan.mp3') {
      res.writeHead(302, { location: `https://lan.example.test:${port}/episode.mp3` });
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  port = (upstream.address() as AddressInfo).port;
});
afterAll(async () => {
  upstream.closeAllConnections();
  await new Promise<void>((done) => upstream.close(() => done()));
});

const names: Record<string, string[]> = {
  'api.example.test': ['127.0.0.1'],
  'other.example.test': ['127.0.0.1'],
  'lan.example.test': ['10.0.0.5'],
};
const resolve = async (hostname: string) =>
  (names[hostname] ?? []).map((address) => ({ address, family: 4 }));
/** Only these tests call this computer "public", so the server above stands in for the web. */
const place = (address: string) => (address === '127.0.0.1' ? 'public' : placeOf(address));

const at = (path: string, host = 'api.example.test') => `https://${host}:${port}${path}`;

async function gateway(cards: Record<string, Carried>, limits = {}) {
  const app = Fastify();
  const carried = vi.fn(async (chat: string, src: string) =>
    chat === 'c1' ? cards[src] : undefined,
  );
  registerListenRoutes(app, {
    carried,
    resolve,
    place,
    ca: CERT,
    // Apple's preview servers, as far as these tests go.
    previewHost: (host) => host === 'api.example.test',
    limits,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, carried, port: (app.server.address() as AddressInfo).port };
}

interface Got {
  status: number;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

function get(
  g: { port: number },
  src: string,
  headers: Record<string, string> = {},
  chat = 'c1',
): Promise<Got> {
  return new Promise((done, failed) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: g.port,
        path: `/api/listen?chat=${encodeURIComponent(chat)}&src=${encodeURIComponent(src)}`,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          done({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
        );
        res.on('error', failed);
      },
    );
    req.on('error', failed);
    req.end();
  });
}

const close = (app: FastifyInstance) => app.close();

describe('/api/listen: what a music card plays', () => {
  it('streams a carried preview as audio, with ranges for scrubbing, and nobody’s cookies', async () => {
    const g = await gateway({ [at('/preview.m4a')]: { whole: false } });
    const whole = await get(g, at('/preview.m4a'));
    expect(whole.status).toBe(200);
    expect(whole.headers['content-type']).toBe('audio/mp4');
    expect(whole.body.equals(AUDIO)).toBe(true);
    expect(whole.headers['content-security-policy']).toMatch(/sandbox/);

    const part = await get(g, at('/preview.m4a'), {
      range: 'bytes=100-199',
      cookie: 'conch=secret',
    });
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 100-199/${AUDIO.length}`);
    expect(part.headers['accept-ranges']).toBe('bytes');
    expect(part.body.length).toBe(100);
    expect(part.headers['set-cookie']).toBeUndefined();
    const asked = seen.at(-1)?.headers ?? {};
    expect(asked.range).toBe('bytes=100-199');
    expect(asked.cookie).toBeUndefined();
    // The log is read once; scrubbing doesn't read it again.
    expect(g.carried).toHaveBeenCalledTimes(1);
    await close(g.app);
  });

  it('plays nothing a card in that chat doesn’t carry', async () => {
    const g = await gateway({ [at('/preview.m4a')]: { whole: false } });
    const before = seen.length;
    expect((await get(g, at('/episode.mp3'))).status).toBe(404);
    expect((await get(g, at('/preview.m4a'), {}, 'c2')).status).toBe(404);
    expect((await get(g, 'http://api.example.test/preview.m4a')).status).toBe(400);
    expect((await get(g, at('/preview.m4a'), {}, '../c1')).status).toBe(400);
    expect(seen.length).toBe(before);
    await close(g.app);
  });

  it('takes a song’s preview only from Apple’s servers, redirects included', async () => {
    const g = await gateway({
      [at('/preview.m4a', 'other.example.test')]: { whole: false },
      [at('/to-other.m4a')]: { whole: false },
    });
    const elsewhere = await get(g, at('/preview.m4a', 'other.example.test'));
    expect(elsewhere.status).toBe(403);
    expect(JSON.parse(elsewhere.body.toString()).message).toMatch(/only comes from Apple/);
    expect((await get(g, at('/to-other.m4a'))).status).toBe(403);
    await close(g.app);
  });

  it('plays a whole episode from its own host, but never one on your network', async () => {
    const g = await gateway({
      [at('/episode.mp3', 'other.example.test')]: { whole: true },
      [at('/to-lan.mp3', 'other.example.test')]: { whole: true },
    });
    const episode = await get(g, at('/episode.mp3', 'other.example.test'));
    expect(episode.status).toBe(200);
    expect(episode.headers['content-type']).toBe('audio/mpeg');
    const inward = await get(g, at('/to-lan.mp3', 'other.example.test'));
    expect(inward.status).toBe(403);
    expect(JSON.parse(inward.body.toString()).message).toMatch(/isn’t on the public web/);
    await close(g.app);
  });

  it('refuses what isn’t audio', async () => {
    const g = await gateway({ [at('/page.html')]: { whole: false } });
    const page = await get(g, at('/page.html'));
    expect(page.status).toBe(502);
    expect(page.body.toString()).not.toContain('<html>');
    await close(g.app);
  });

  it('never brings back more than a request may', async () => {
    const g = await gateway({ [at('/endless.mp3')]: { whole: true } }, { episodeBytes: 100_000 });
    const got = await get(g, at('/endless.mp3'));
    expect(got.status).toBe(200);
    expect(got.body.length).toBe(100_000);
    await close(g.app);
  });

  it('stops fetching when the page stops listening', async () => {
    const g = await gateway({ [at('/endless.mp3')]: { whole: true } });
    const before = closed;
    await new Promise<void>((done, failed) => {
      const timer = setTimeout(() => failed(new Error('no audio')), 5000);
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: g.port,
          path: `/api/listen?chat=c1&src=${encodeURIComponent(at('/endless.mp3'))}`,
        },
        (res) => {
          res.once('data', () => {
            clearTimeout(timer);
            req.destroy();
            done();
          });
        },
      );
      req.on('error', () => undefined);
      req.end();
    });
    await vi.waitFor(() => expect(closed).toBeGreaterThan(before), { timeout: 3000 });
    await close(g.app);
  });
});

describe('what a chat’s cards carry', () => {
  const src = 'https://a.example/x.m4a';
  const events = (name: string, chat = 'c1') =>
    [
      { type: 'tool.started', toolUseId: 't1', name, input: {} },
      {
        type: 'tool.finished',
        toolUseId: 't1',
        status: 'success',
        view: {
          kind: 'audio',
          chat,
          items: [{ kind: 'episode', title: 'A', preview: { url: src, whole: true } }],
        },
      },
    ] as unknown as ConversationEvent[];

  it('is only what music_search put in that same chat', () => {
    expect(carriedIn(events('mcp__conch__music_search'), 'c1', src)).toEqual({ whole: true });
    expect(carriedIn(events('music_search'), 'c1', src)).toEqual({ whole: true });
    expect(carriedIn(events('mcp__someapp__music_search'), 'c1', src)).toBeUndefined();
    expect(carriedIn(events('music_search', 'c2'), 'c1', src)).toBeUndefined();
    expect(carriedIn(events('music_search'), 'c1', 'https://a.example/y.m4a')).toBeUndefined();
  });

  it('tells audio by its type, or by its name when the type says nothing', () => {
    const u = new URL('https://a.example/x.mp3');
    expect(audioType('audio/mpeg', u)).toBe('audio/mpeg');
    expect(audioType('audio/x-m4a; charset=binary', u)).toBe('audio/mp4');
    expect(audioType('audio/x-m4p', u)).toBe('audio/mp4');
    expect(audioType('application/octet-stream', u)).toBe('audio/mpeg');
    expect(audioType('text/html', u)).toBeUndefined();
    expect(audioType('application/octet-stream', new URL('https://a.example/x.exe'))).toBe(
      undefined,
    );
  });
});
