import { describe, expect, it } from 'vitest';

import { checkReach, checkThrough } from './reach';

const failing = (code: string) =>
  (async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code } });
  }) as typeof fetch;

describe('checkReach', () => {
  it('says yes only when this Conch’s own answer comes back', async () => {
    const checks = new Map<string, string>();
    const fetcher = (async (url: string) => {
      const nonce = url.split('/').at(-1) ?? '';
      expect(url).toMatch(/^http:\/\/conch\.example\.com\/\.well-known\/conch-check\//);
      return new Response(checks.get(nonce) ?? 'nope');
    }) as unknown as typeof fetch;
    expect(await checkReach('conch.example.com', { checks, fetch: fetcher })).toEqual({ ok: true });
    // The answer is taken back afterwards.
    expect(checks.size).toBe(0);
  });

  it('knows another server answering', async () => {
    const fetcher = (async () => new Response('<html>nginx</html>')) as unknown as typeof fetch;
    const result = await checkReach('conch.example.com', { checks: new Map(), fetch: fetcher });
    expect(result).toMatchObject({ ok: false, why: 'elsewhere', problem: { kind: 'dns' } });
  });

  it.each([
    ['ENOTFOUND', 'dns', /can’t be found yet/],
    ['ECONNREFUSED', 'refused', /refused the connection on port 80/],
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout', /Nothing answered.*provider’s/],
  ])('%s → %s', async (code, why, message) => {
    const result = await checkReach('conch.example.com', {
      checks: new Map(),
      fetch: failing(code),
    });
    expect(result).toMatchObject({
      ok: false,
      why,
      problem: { message: expect.stringMatching(message) },
    });
  });

  it('asks on another port when the listener isn’t on 80', async () => {
    let asked = '';
    const fetcher = (async (url: string) => {
      asked = url;
      return new Response('');
    }) as unknown as typeof fetch;
    await checkReach('conch.example.com', { checks: new Map(), fetch: fetcher, port: 5002 });
    expect(asked).toMatch(/^http:\/\/conch\.example\.com:5002\//);
  });
});

describe('checkThrough (a tunnel or web server of your own)', () => {
  const target = 'http://127.0.0.1:4317';
  const answering = (status: number, body = '') =>
    (async () => new Response(body, { status })) as unknown as typeof fetch;

  it('says yes only when this Conch’s own answer comes back, over HTTPS', async () => {
    const checks = new Map<string, string>();
    const fetcher = (async (url: string) => {
      expect(url).toMatch(/^https:\/\/conch\.example\.com\/\.well-known\/conch-check\//);
      return new Response(checks.get(url.split('/').at(-1) ?? '') ?? 'nope');
    }) as unknown as typeof fetch;
    expect(await checkThrough('conch.example.com', { checks, target, fetch: fetcher })).toEqual({
      ok: true,
      guarded: false,
    });
    expect(checks.size).toBe(0);
  });

  it.each([302, 401, 403])('a sign-in in front (%s) is a lock, not a problem', async (status) => {
    const result = await checkThrough('conch.example.com', {
      checks: new Map(),
      target,
      fetch: answering(status),
    });
    expect(result).toEqual({ ok: true, guarded: true });
  });

  it.each([502, 504, 530])('the proxy answered but couldn’t reach Conch (%s)', async (status) => {
    const result = await checkThrough('conch.example.com', {
      checks: new Map(),
      target,
      fetch: answering(status),
    });
    expect(result).toMatchObject({
      ok: false,
      why: 'no-conch',
      problem: { kind: 'unreachable', message: expect.stringContaining(target) },
    });
  });

  it('knows a proxy that doesn’t pass on the name people typed', async () => {
    const result = await checkThrough('conch.example.com', {
      checks: new Map(),
      target,
      fetch: answering(200, 'wrong-host'),
    });
    expect(result).toMatchObject({
      ok: false,
      why: 'host',
      problem: { message: expect.stringContaining('proxy_set_header Host $host') },
    });
  });

  it('knows something else answering there', async () => {
    const result = await checkThrough('conch.example.com', {
      checks: new Map(),
      target,
      fetch: answering(200, '<html>nginx</html>'),
    });
    expect(result).toMatchObject({ ok: false, why: 'elsewhere', problem: { kind: 'dns' } });
  });

  it.each([
    ['ENOTFOUND', 'dns', /can’t be found yet/],
    ['ECONNREFUSED', 'unreachable', /Nothing answered at https:\/\/conch\.example\.com/],
  ])('%s → %s', async (code, why, message) => {
    const result = await checkThrough('conch.example.com', {
      checks: new Map(),
      target,
      fetch: failing(code),
    });
    expect(result).toMatchObject({
      ok: false,
      why,
      problem: { message: expect.stringMatching(message) },
    });
  });
});
