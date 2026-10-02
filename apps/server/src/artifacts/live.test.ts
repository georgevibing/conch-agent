import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LIVE_DATA } from '@conch/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  fetchLive,
  fillSource,
  LiveData,
  LiveDataAccess,
  placeOf,
  readSources,
  type Reach,
} from './live';

const page = (sources: unknown) =>
  `<h1>Live</h1><script type="application/conch-data">${JSON.stringify(sources)}</script>`;

describe('what a page declares', () => {
  it('reads a page’s sources, with the host written out', () => {
    const { sources, problem } = readSources(
      page({
        weather: {
          url: 'https://api.example.com/v1/now?city={city}&days={days}',
          params: { city: { choices: ['berlin', 'lisbon'] }, days: { min: 1, max: 7 } },
          every: 600,
        },
      }),
    );
    expect(problem).toBeUndefined();
    expect(sources).toMatchObject([{ name: 'weather', host: 'api.example.com', local: false }]);
    expect(readSources('<h1>No data</h1>')).toEqual({ sources: [] });
  });

  it('refuses a host the page could fill in, a plain address, or anything undeclared', () => {
    const problem = (sources: unknown) => readSources(page(sources)).problem;
    // The host can never come from the page.
    expect(
      problem({ x: { url: 'https://{h}/a', params: { h: { choices: ['evil.example'] } } } }),
    ).toMatch(/host written out/);
    expect(
      problem({ x: { url: 'https://api.{h}.example/a', params: { h: { choices: ['x'] } } } }),
    ).toMatch(/host written out/);
    expect(problem({ x: { url: 'https://user:pw@api.example.com/a' } })).toMatch(
      /host written out/,
    );
    expect(problem({ x: { url: 'http://api.example.com/a' } })).toMatch(/secure address/);
    expect(problem({ x: { url: 'https://api.example.com/{q}' } })).toMatch(
      /doesn’t say what it may be/,
    );
    expect(
      problem({ x: { url: 'https://api.example.com/a', params: { q: { choices: ['a'] } } } }),
    ).toMatch(/doesn’t use it/);
    // A number that could spell out much more than a choice.
    expect(
      problem({
        x: { url: 'https://api.example.com/a?n={n}', params: { n: { min: 0, max: 1e9 } } },
      }),
    ).toMatch(/too many values/);
    expect(problem({ x: { url: 'https://api.example.com/a', headers: { cookie: 'x' } } })).toMatch(
      /doesn’t fit/,
    );
    const many = Object.fromEntries(
      Array.from({ length: LIVE_DATA.maxSources + 1 }, (_, i) => [
        `s${i}`,
        { url: 'https://a.example/x' },
      ]),
    );
    expect(problem(many)).toMatch(/at most 8/);
    // Plain http only for this computer, which needs its own OK.
    expect(readSources(page({ x: { url: 'http://localhost:9999/a' } })).sources[0]).toMatchObject({
      host: 'localhost:9999',
      local: true,
    });
  });

  it('fills in only what the page declared, as declared', () => {
    const [source] = readSources(
      page({
        weather: {
          url: 'https://api.example.com/now?city={city}&lat={lat}',
          params: {
            city: { choices: ['berlin', 'são paulo'] },
            lat: { min: -90, max: 90, step: 0.5 },
          },
        },
      }),
    ).sources;
    if (!source) throw new Error('no source');
    expect(fillSource(source, { city: 'são paulo', lat: 52.26 })).toEqual({
      url: 'https://api.example.com/now?city=s%C3%A3o%20paulo&lat=52.5',
    });
    // Free text, out of range, a value it didn't declare, a missing one: no.
    expect(fillSource(source, { city: 'my password is hunter2', lat: 1 })).toHaveProperty(
      'problem',
    );
    expect(fillSource(source, { city: 'berlin', lat: 91 })).toHaveProperty('problem');
    expect(fillSource(source, { city: 'berlin', lat: 1, d: 'secret' })).toHaveProperty('problem');
    expect(fillSource(source, { city: 'berlin' })).toHaveProperty('problem');
  });
});

describe('where a request may land', () => {
  it('knows this computer, your network, and the places never to go', () => {
    expect(placeOf('93.184.216.34')).toBe('public');
    expect(placeOf('127.0.0.1')).toBe('this-computer');
    expect(placeOf('::1')).toBe('this-computer');
    expect(placeOf('::ffff:10.0.0.7')).toBe('your-network');
    expect(placeOf('192.168.1.1')).toBe('your-network');
    expect(placeOf('fd12::1')).toBe('your-network');
    for (const never of [
      '169.254.169.254',
      'fe80::1',
      '0.0.0.0',
      '64:ff9b::a9fe:a9fe',
      '224.0.0.1',
    ])
      expect(placeOf(never), never).toBe('never');
  });
});

describe('reading for a page', () => {
  let server: Server;
  let base: string;
  let host: string;
  const hits: string[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(req.url ?? '');
      const url = new URL(req.url ?? '/', 'http://x');
      // Nothing of the person's ever arrives.
      if (req.headers.cookie || req.headers.authorization) res.statusCode = 418;
      if (url.pathname === '/weather') {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ city: url.searchParams.get('city'), temp: 21 }));
      }
      if (url.pathname === '/to-metadata') {
        res.writeHead(302, { location: 'https://169.254.169.254/latest/meta-data/' });
        return res.end();
      }
      if (url.pathname === '/to-network') {
        res.writeHead(302, { location: 'https://10.0.0.1/admin' });
        return res.end();
      }
      if (url.pathname === '/to-elsewhere') {
        res.writeHead(302, { location: 'https://not-approved.example/x' });
        return res.end();
      }
      if (url.pathname === '/big') {
        res.setHeader('content-type', 'text/plain');
        res.setHeader('content-length', String(LIVE_DATA.maxBytes + 1));
        return res.end('x'.repeat(LIVE_DATA.maxBytes + 1));
      }
      if (url.pathname === '/endless') {
        // No length said: stopped once it's too much.
        res.setHeader('content-type', 'text/plain');
        const chunk = 'y'.repeat(64 * 1024);
        const pump = () => {
          while (res.write(chunk));
          res.once('drain', pump);
        };
        res.on('close', () => res.removeAllListeners('drain'));
        return pump();
      }
      if (url.pathname === '/binary') {
        res.setHeader('content-type', 'application/octet-stream');
        return res.end(Buffer.from([0, 1, 2]));
      }
      if (url.pathname === '/slow') return setTimeout(() => res.end('late'), 2_000);
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    host = `localhost:${port}`;
    base = `http://${host}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  const reach = (more: Partial<Reach> = {}): Reach => ({
    local: true,
    gatewayPort: 4317,
    hosts: new Set([host]),
    ...more,
  });

  it('reads this computer only when you said so, and never Conch itself', async () => {
    const ok = await fetchLive(`${base}/weather?city=berlin`, reach());
    expect(ok).toMatchObject({ ok: true, status: 200, type: 'application/json' });
    expect(JSON.parse(ok.ok ? ok.body : '{}')).toEqual({ city: 'berlin', temp: 21 });

    expect(await fetchLive(`${base}/weather`, reach({ local: false }))).toMatchObject({
      ok: false,
      reason: 'refused',
      message: expect.stringMatching(/on this computer/),
    });
    const port = Number(host.split(':')[1]);
    expect(await fetchLive(`${base}/weather`, reach({ gatewayPort: port }))).toMatchObject({
      ok: false,
      reason: 'refused',
      message: 'A page can’t read from Conch itself.',
    });
    // By its number, too.
    expect(
      await fetchLive(`http://127.0.0.1:${port}/weather`, {
        ...reach({ gatewayPort: port }),
        hosts: new Set([`127.0.0.1:${port}`]),
      }),
    ).toMatchObject({ ok: false, reason: 'refused' });
  });

  it('never follows a redirect to metadata, your network, or a host it may not read', async () => {
    for (const [path, words] of [
      ['/to-metadata', /never connects to|may not read/],
      ['/to-network', /may not read|own network/],
      ['/to-elsewhere', /not-approved\.example, which this page may not read from/],
    ] as const) {
      const result = await fetchLive(`${base}${path}`, reach());
      expect(result, path).toMatchObject({ ok: false, reason: 'refused' });
      expect(result.ok ? '' : result.message, path).toMatch(words);
    }
    // Even when the page may read from there, metadata and your network stay closed.
    const anywhere = reach({ hosts: new Set([host, '169.254.169.254', '10.0.0.1']) });
    expect(await fetchLive(`${base}/to-metadata`, anywhere)).toMatchObject({
      ok: false,
      reason: 'refused',
      message: expect.stringMatching(/never connects to/),
    });
    expect(await fetchLive(`${base}/to-network`, anywhere)).toMatchObject({
      ok: false,
      reason: 'refused',
      message: expect.stringMatching(/own network/),
    });
  });

  it('checks every address a name resolves to, as it connects', async () => {
    const resolve = vi.fn(async (name: string) =>
      name === 'rebind.example'
        ? [
            { address: '93.184.216.34', family: 4 },
            { address: '10.0.0.7', family: 4 },
          ]
        : name === 'metadata.example'
          ? [{ address: '169.254.169.254', family: 4 }]
          : [{ address: '127.0.0.1', family: 4 }],
    );
    for (const name of ['rebind.example', 'metadata.example', 'sneaky.example']) {
      const result = await fetchLive(
        `https://${name}/x`,
        { local: false, gatewayPort: 4317, hosts: new Set([name]) },
        { resolve },
      );
      expect(result, name).toMatchObject({ ok: false, reason: 'refused' });
    }
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(hits.some((h) => h.includes('/x'))).toBe(false);
  });

  it('stops what’s too big, too slow, or not data', async () => {
    expect(await fetchLive(`${base}/big`, reach())).toMatchObject({ ok: false, reason: 'too-big' });
    expect(await fetchLive(`${base}/endless`, reach())).toMatchObject({
      ok: false,
      reason: 'too-big',
    });
    expect(await fetchLive(`${base}/binary`, reach())).toMatchObject({
      ok: false,
      reason: 'refused',
      message: expect.stringMatching(/a file, not data/),
    });
    expect(await fetchLive(`${base}/slow`, reach(), { timeoutMs: 200 })).toMatchObject({
      ok: false,
      reason: 'timeout',
    });
  });

  it('asks for an address it wasn’t given', async () => {
    expect(await fetchLive(`${base}/weather`, reach({ hosts: new Set() }))).toMatchObject({
      ok: false,
      reason: 'needs-approval',
    });
  });
});

describe('a page’s live data, with your OK', () => {
  async function setup(html: string, fetch = vi.fn()) {
    const home = await mkdtemp(join(tmpdir(), 'conch-live-'));
    const access = new LiveDataAccess(home);
    const content = { html };
    let now = 1_000_000;
    fetch.mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      type: 'application/json',
      body: JSON.stringify({ url }),
      at: now,
    }));
    const live = new LiveData({
      access,
      page: async () => ({ html: content.html, title: 'Weather' }),
      tainted: async () => 'This chat read evil.example, which could be trying to steer me.',
      gatewayPort: 4317,
      fetch,
      now: () => now,
    });
    return { live, access, fetch, content, home, tick: (ms: number) => (now += ms) };
  }
  const weather = page({
    weather: {
      url: 'https://api.example.com/now?city={city}',
      params: { city: { choices: ['berlin', 'lisbon'] } },
      every: 600,
    },
  });

  it('reads nothing from a host you haven’t allowed; then only what you saw', async () => {
    const { live, fetch, content } = await setup(weather);
    expect(await live.info('a_1', 1)).toMatchObject({
      sources: [{ name: 'weather', host: 'api.example.com', allowed: false, changed: false }],
      tainted: expect.stringMatching(/evil\.example/),
    });
    expect(
      await live.read('a_1', 1, { source: 'weather', params: { city: 'berlin' } }),
    ).toMatchObject({
      ok: false,
      reason: 'needs-approval',
      host: 'api.example.com',
    });
    expect(fetch).not.toHaveBeenCalled();

    await live.approve('a_1', 1, 'api.example.com');
    const read = await live.read('a_1', 1, { source: 'weather', params: { city: 'berlin' } });
    expect(read).toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/now?city=berlin', {
      local: false,
      gatewayPort: 4317,
      hosts: new Set(['api.example.com']),
    });

    // A new version that reads a different address on the same host asks again.
    content.html = page({
      weather: { url: 'https://api.example.com/now?city=berlin&d=everything-you-said' },
    });
    expect(await live.read('a_1', 2, { source: 'weather' })).toMatchObject({
      ok: false,
      reason: 'needs-approval',
      message: expect.stringMatching(/different address on api\.example\.com/),
    });
    expect((await live.info('a_1', 2)).sources[0]).toMatchObject({ allowed: false, changed: true });
    // An undeclared source, or another page, gets nothing.
    expect(await live.read('a_1', 2, { source: 'other' })).toMatchObject({ reason: 'refused' });
    content.html = weather;
    expect(
      await live.read('a_2', 1, { source: 'weather', params: { city: 'berlin' } }),
    ).toMatchObject({
      reason: 'needs-approval',
    });
  });

  it('is taken back, and a page that’s gone keeps nothing', async () => {
    const { live, access } = await setup(weather);
    await live.approve('a_1', 1, 'api.example.com');
    await access.revoke('a_1', 'api.example.com');
    expect(
      await live.read('a_1', 1, { source: 'weather', params: { city: 'berlin' } }),
    ).toMatchObject({
      reason: 'needs-approval',
    });
    await live.approve('a_1', 1, 'api.example.com');
    await live.forget('a_1');
    expect(await access.list()).toEqual([]);
  });

  it('asks separately for this computer, and won’t allow a host the page doesn’t read', async () => {
    const { live } = await setup(page({ dev: { url: 'http://localhost:3000/status' } }));
    await expect(live.approve('a_1', 1, 'localhost:3000')).rejects.toThrow(/on this computer/);
    await expect(live.approve('a_1', 1, 'evil.example', true)).rejects.toThrow(
      /doesn’t read from there/,
    );
    await live.approve('a_1', 1, 'localhost:3000', true);
    expect((await live.info('a_1', 1)).sources[0]).toMatchObject({ allowed: true, local: true });
  });

  it('reads the same address once in a while, and only so many an hour', async () => {
    const many = page({
      n: { url: 'https://api.example.com/n/{n}', params: { n: { min: 0, max: 100 } } },
    });
    const { live, fetch, tick } = await setup(many);
    await live.approve('a_1', 1, 'api.example.com');
    await live.read('a_1', 1, { source: 'n', params: { n: 1 } });
    await live.read('a_1', 1, { source: 'n', params: { n: 1 } });
    expect(fetch).toHaveBeenCalledTimes(1);
    tick(LIVE_DATA.reuseMs + 1);
    await live.read('a_1', 1, { source: 'n', params: { n: 1 } });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (let n = 2; n <= LIVE_DATA.perHour; n++)
      expect(await live.read('a_1', 1, { source: 'n', params: { n } })).toMatchObject({ ok: true });
    // Spelling something out one choice at a time runs out quickly.
    expect(await live.read('a_1', 1, { source: 'n', params: { n: 99 } })).toMatchObject({
      ok: false,
      reason: 'busy',
    });
    tick(3_600_001);
    expect(await live.read('a_1', 1, { source: 'n', params: { n: 99 } })).toMatchObject({
      ok: true,
    });
  });

  it('a damaged list is set aside, and pages ask again', async () => {
    const { live, access, home } = await setup(weather);
    await live.approve('a_1', 1, 'api.example.com');
    await writeFile(join(home, 'artifacts', 'access.json'), '{ damaged');
    expect(await access.list()).toEqual([]);
    expect((await live.info('a_1', 1)).sources[0]?.allowed).toBe(false);
  });
});
