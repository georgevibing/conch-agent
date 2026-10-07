import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { createFetcher } from '../conchapps/fetcher';
import type { AppFetcher, AppFetchRequest, AppFetchResponse } from '../conchapps/types';
import { loadConfig } from '../config';
import { Services } from '../services';
import { NOT_HERE, onThisComputer } from '../test/here';
import { faviconHost, Favicons, ICON_BYTES, iconLinks, sniff } from './favicons';
import { registerFaviconRoutes } from './routes';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const ICO = Buffer.from([0x00, 0x00, 0x01, 0x00, 1, 0, 16, 16]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const image = (type: string, bytes: Buffer): AppFetchResponse => ({
  ok: true,
  status: 200,
  headers: { 'content-type': type },
  body: bytes.toString('base64'),
  bodyBase64: true,
});
const html = (body: string, url?: string): AppFetchResponse => ({
  ok: true,
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
  body,
  ...(url && { url }),
});
const missing: AppFetchResponse = { ok: false, status: 404, headers: {}, body: '' };

/** A web of canned answers; anything else is a 404. */
function fake(web: Record<string, AppFetchResponse>) {
  const asked: { url: string; reaches: readonly string[]; request: AppFetchRequest }[] = [];
  const fetcher: AppFetcher = async (app, request) => {
    asked.push({ url: request.url, reaches: app.reaches, request });
    return web[request.url] ?? missing;
  };
  return { fetcher, asked };
}

describe('faviconHost', () => {
  it('takes public host names, lowercased', () => {
    expect(faviconHost('Example.COM')).toBe('example.com');
    expect(faviconHost('a-b.co.uk')).toBe('a-b.co.uk');
    expect(faviconHost('xn--mnchen-3ya.de')).toBe('xn--mnchen-3ya.de');
  });

  it.each([
    undefined,
    ['example.com'],
    '',
    'localhost',
    'foo.localhost',
    'printer.local',
    'metadata.google.internal',
    'example',
    '127.0.0.1',
    '169.254.169.254',
    '0x7f.0x1',
    '[::1]',
    '::1',
    'example.com:8080',
    'example.com.',
    '-bad.com',
    'bad-.com',
    'a..com',
    'ex ample.com',
    'example.com/path',
    'user@example.com',
    `${'a'.repeat(64)}.com`,
    `${'a.'.repeat(127)}com`,
  ])('refuses %j', (raw) => {
    expect(faviconHost(raw)).toBeUndefined();
  });
});

describe('sniff', () => {
  it('knows raster images by their first bytes, and nothing else', () => {
    expect(sniff(PNG)).toBe('image/png');
    expect(sniff(ICO)).toBe('image/x-icon');
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniff(Buffer.from('GIF89a...'))).toBe('image/gif');
    expect(sniff(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniff(SVG)).toBeUndefined();
    expect(sniff(Buffer.from('<html>'))).toBeUndefined();
    expect(sniff(Buffer.alloc(0))).toBeUndefined();
  });
});

describe('iconLinks', () => {
  const base = new URL('https://example.com/start/');

  it('puts apple-touch-icon first, then the largest, and skips SVG and plain http', () => {
    const page = `<html><head>
      <link rel="icon" href="/small.png" sizes="16x16">
      <link rel="mask-icon" href="/mask.svg">
      <link rel="icon" type="image/svg+xml" href="/vector">
      <link rel="icon" href="/also.svg">
      <LINK REL='shortcut icon' HREF='big.png?v=1&amp;x=2' sizes='16x16 64x64'>
      <link rel="icon" href="http://example.com/plain.png" sizes="128x128">
      <link rel="apple-touch-icon" href="https://cdn.example.net/touch.png">
      <link rel="stylesheet" href="/site.css">
    </head></html>`;
    expect(iconLinks(page, base).map(String)).toEqual([
      'https://cdn.example.net/touch.png',
      'https://example.com/start/big.png?v=1&x=2',
      'https://example.com/small.png',
    ]);
  });

  it('copes with nothing to find', () => {
    expect(iconLinks('', base)).toEqual([]);
    expect(iconLinks('<link rel="icon">', base)).toEqual([]);
    expect(iconLinks('<link rel=icon href="javascript:alert(1)">', base)).toEqual([]);
  });
});

describe('Favicons', () => {
  it('takes the site’s own /favicon.ico, from the site and nowhere else', async () => {
    const { fetcher, asked } = fake({
      'https://example.com/favicon.ico': image('image/vnd.microsoft.icon', ICO),
    });
    const icon = await new Favicons({ fetcher }).get('example.com');
    expect(icon).toEqual({ type: 'image/x-icon', bytes: ICO });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.reaches).toEqual(['example.com']);
    expect(asked[0]?.request.method).toBe('GET');
    expect(asked[0]?.request.headers.cookie).toBeUndefined();
  });

  it('finds the icon the home page names when there is no /favicon.ico', async () => {
    const { fetcher, asked } = fake({
      'https://example.com/': html(
        '<link rel="icon" href="/i/32.png" sizes="32x32"><link rel="apple-touch-icon" href="https://static.example.net/t.png">',
        'https://www.example.com/',
      ),
      'https://static.example.net/t.png': image('image/png', PNG),
    });
    expect(await new Favicons({ fetcher }).get('example.com')).toEqual({
      type: 'image/png',
      bytes: PNG,
    });
    expect(asked.map((a) => a.url)).toEqual([
      'https://example.com/favicon.ico',
      'https://example.com/',
      'https://static.example.net/t.png',
    ]);
    // Each request may only go to the host it names.
    expect(asked[2]?.reaches).toEqual(['static.example.net']);
  });

  it('tries the next icon the page names, at most two', async () => {
    const { fetcher, asked } = fake({
      'https://example.com/': html(
        '<link rel="icon" href="/a.png" sizes="96x96"><link rel="icon" href="/b.png" sizes="48x48"><link rel="icon" href="/c.png" sizes="16x16">',
      ),
      'https://example.com/c.png': image('image/png', PNG),
    });
    expect(await new Favicons({ fetcher }).get('example.com')).toBeUndefined();
    expect(asked.map((a) => a.url)).toEqual([
      'https://example.com/favicon.ico',
      'https://example.com/',
      'https://example.com/a.png',
      'https://example.com/b.png',
    ]);
  });

  it('refuses SVG, HTML dressed as an image, and anything not an image', async () => {
    for (const answer of [
      image('image/svg+xml', SVG),
      image('image/png', SVG),
      image('image/png', Buffer.from('<html><script>x</script>')),
      image('application/octet-stream', PNG),
      image('text/html', PNG),
      { ...image('', PNG), headers: {} },
    ]) {
      const { fetcher } = fake({ 'https://example.com/favicon.ico': answer });
      expect(await new Favicons({ fetcher }).get('example.com')).toBeUndefined();
    }
  });

  it('refuses an icon over 100 KB and an empty one', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(ICON_BYTES)]);
    for (const bytes of [big, Buffer.alloc(0)]) {
      const { fetcher } = fake({ 'https://example.com/favicon.ico': image('image/png', bytes) });
      expect(await new Favicons({ fetcher }).get('example.com')).toBeUndefined();
    }
    const fits = Buffer.concat([PNG, Buffer.alloc(ICON_BYTES - PNG.length)]);
    const { fetcher } = fake({ 'https://example.com/favicon.ico': image('image/png', fits) });
    expect(await new Favicons({ fetcher }).get('example.com')).toMatchObject({ type: 'image/png' });
  });

  it('reads icons only from a page that is HTML', async () => {
    const { fetcher, asked } = fake({
      'https://example.com/': {
        ...html('<link rel="icon" href="/a.png">'),
        headers: { 'content-type': 'text/plain' },
      },
      'https://example.com/a.png': image('image/png', PNG),
    });
    expect(await new Favicons({ fetcher }).get('example.com')).toBeUndefined();
    expect(asked).toHaveLength(2);
  });

  it('keeps what it found for a day and what it didn’t for an hour', async () => {
    let now = 1_000_000;
    const web: Record<string, AppFetchResponse> = {
      'https://found.com/favicon.ico': image('image/png', PNG),
    };
    const { fetcher, asked } = fake(web);
    const favicons = new Favicons({ fetcher, now: () => now });
    await favicons.get('found.com');
    await favicons.get('none.com');
    const count = asked.length;
    now += 59 * 60_000;
    expect(await favicons.get('found.com')).toMatchObject({ type: 'image/png' });
    expect(await favicons.get('none.com')).toBeUndefined();
    expect(asked).toHaveLength(count);
    now += 2 * 60_000;
    web['https://none.com/favicon.ico'] = image('image/x-icon', ICO);
    expect(await favicons.get('none.com')).toMatchObject({ type: 'image/x-icon' });
    expect(await favicons.get('found.com')).toMatchObject({ type: 'image/png' });
    expect(asked).toHaveLength(count + 1);
    now += 24 * 60 * 60_000;
    await favicons.get('found.com');
    expect(asked).toHaveLength(count + 2);
  });

  it('keeps at most so many sites, forgetting the least recently used', async () => {
    const { fetcher, asked } = fake({});
    const favicons = new Favicons({ fetcher, size: 2 });
    await favicons.get('a.com');
    await favicons.get('b.com');
    await favicons.get('a.com');
    await favicons.get('c.com');
    const count = asked.length;
    await favicons.get('a.com');
    expect(asked).toHaveLength(count);
    await favicons.get('b.com');
    expect(asked.length).toBeGreaterThan(count);
  });

  it('asks once for a site wanted many times at once', async () => {
    const { fetcher, asked } = fake({ 'https://example.com/favicon.ico': image('image/png', PNG) });
    const favicons = new Favicons({ fetcher });
    await Promise.all([1, 2, 3].map(() => favicons.get('example.com')));
    expect(asked).toHaveLength(1);
  });

  it('looks up only so many new sites an hour', async () => {
    let now = 0;
    const { fetcher } = fake({});
    const favicons = new Favicons({ fetcher, now: () => now, lookupsPerHour: 2 });
    expect(await favicons.get('a.com')).toBeUndefined();
    expect(await favicons.get('b.com')).toBeUndefined();
    expect(await favicons.get('c.com')).toBe('busy');
    // What it already knows doesn't count.
    expect(await favicons.get('a.com')).toBeUndefined();
    now += 60 * 60_000 + 1;
    expect(await favicons.get('c.com')).toBeUndefined();
  });

  it('gives up quietly when the fetcher throws', async () => {
    const fetcher: AppFetcher = () => Promise.reject(new Error('boom'));
    expect(await new Favicons({ fetcher }).get('example.com')).toBeUndefined();
  });

  it('never connects inward: a name that resolves to your network or metadata is refused', async () => {
    for (const address of ['10.0.0.5', '192.168.1.1', '127.0.0.1', '169.254.169.254', '::1']) {
      const resolve = vi.fn(async () => [{ address, family: address.includes(':') ? 6 : 4 }]);
      const fetcher = createFetcher({ resolve, publicRedirects: true, timeoutMs: 2000 });
      expect(await new Favicons({ fetcher }).get('inward.example.com')).toBeUndefined();
      // Looked up (so the guard saw the address), then refused before anything was sent.
      expect(resolve).toHaveBeenCalledWith('inward.example.com');
    }
  });
});

describe('GET /api/favicon', () => {
  const open: { close(): Promise<void> }[] = [];
  afterEach(async () => {
    while (open.length) await open.pop()?.close();
  });

  async function route(web: Record<string, AppFetchResponse>) {
    const { fetcher, asked } = fake(web);
    const app = Fastify();
    registerFaviconRoutes(app, new Favicons({ fetcher, lookupsPerHour: 3 }));
    open.push(app);
    return { app, asked };
  }

  it('sends the icon as the image it is, kept a day, unable to run anything', async () => {
    const { app } = await route({ 'https://example.com/favicon.ico': image('image/png', PNG) });
    const reply = await app.inject({ url: '/api/favicon?host=Example.com' });
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['content-type']).toBe('image/png');
    expect(reply.headers['cache-control']).toBe('private, max-age=86400');
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
    expect(reply.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(reply.rawPayload.equals(PNG)).toBe(true);
  });

  it('answers 404 when a site has no icon', async () => {
    const { app } = await route({});
    const reply = await app.inject({ url: '/api/favicon?host=example.com' });
    expect(reply.statusCode).toBe(404);
    expect(reply.headers['cache-control']).toBe('private, max-age=3600');
  });

  it('refuses a host that isn’t a public name, without asking anyone', async () => {
    const { app, asked } = await route({});
    for (const query of [
      '',
      '?host=',
      '?host=127.0.0.1',
      '?host=localhost',
      '?host=example.com:444',
      '?host=example.com&host=other.com',
      '?host=%5B%3A%3A1%5D',
      `?host=${'a'.repeat(300)}.com`,
    ]) {
      expect((await app.inject({ url: `/api/favicon${query}` })).statusCode).toBe(400);
    }
    expect(asked).toHaveLength(0);
  });

  it('says so when it has looked up too many sites lately', async () => {
    const { app } = await route({});
    for (const host of ['a.com', 'b.com', 'c.com'])
      expect((await app.inject({ url: `/api/favicon?host=${host}` })).statusCode).toBe(404);
    const reply = await app.inject({ url: '/api/favicon?host=d.com' });
    expect(reply.statusCode).toBe(429);
    expect(reply.headers['retry-after']).toBeDefined();
  });

  it('is only for the person signed in, like every other /api route', async () => {
    const services = new Services(
      loadConfig({
        CONCH_HOME: await mkdtemp(join(tmpdir(), 'conch-favicon-api-')),
        CONCH_ENGINE: 'mock',
        CONCH_LOG_LEVEL: 'silent',
        CONCH_WEB_DIST: '/nonexistent',
      }),
    );
    const app = onThisComputer(await buildApp(services), services);
    open.push(app);
    services.learning.stop();
    const get = vi.spyOn(services.favicons, 'get').mockResolvedValue(undefined);
    const outsider = await app.inject({
      url: '/api/favicon?host=example.com',
      headers: { [NOT_HERE]: '1' },
    });
    expect([401, 403]).toContain(outsider.statusCode);
    const foreign = await app.inject({
      url: '/api/favicon?host=example.com',
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    expect(foreign.statusCode).toBe(403);
    expect(get).not.toHaveBeenCalled();
    const here = await app.inject({ url: '/api/favicon?host=example.com' });
    expect(here.statusCode).toBe(404);
    expect(get).toHaveBeenCalledWith('example.com');
  });
});
