import { describe, expect, it } from 'vitest';

import { checkReach } from './reach';

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
