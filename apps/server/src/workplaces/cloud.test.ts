import { describe, expect, it } from 'vitest';

import { CloudSandboxes, DAYTONA_API, daytonaUrl, LIFETIME } from './cloud';
import { PlaceUnavailable } from './types';

const KEY = 'dtn_' + 'a1b2c3d4e5f6a7b8c9d0';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A pretend Daytona: one sandbox, asleep at first. */
function daytona(options: { state?: string; proxy?: string; status?: number[] } = {}) {
  const calls: Call[] = [];
  let state = options.state ?? 'stopped';
  const statuses = [...(options.status ?? [])];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const box = () => ({
    id: 'sb1',
    state,
    toolboxProxyUrl: options.proxy ?? 'https://proxy.app.daytona.io/toolbox',
  });
  const fetch = async (url: string, init?: RequestInit) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      ...(typeof init?.body === 'string' && { body: init.body }),
    });
    const next = statuses.shift();
    if (next) return json({ message: 'busy' }, next);
    if (url.startsWith(`${DAYTONA_API}/sandbox?labels=`)) return json([]);
    if (url === `${DAYTONA_API}/sandbox` && init?.method === 'POST') return json(box());
    if (url.endsWith('/toolbox-proxy-url')) return json({ url: options.proxy });
    if (url.endsWith('/start')) {
      state = 'started';
      return json({});
    }
    if (url === `${DAYTONA_API}/sandbox/sb1`) return json(box());
    if (url.includes('/process/execute')) return json({ exitCode: 0, result: 'hello\n' });
    if (url.includes('/files/')) return new Response(new Uint8Array(0));
    return json({ message: 'nope' }, 404);
  };
  return { fetch, calls };
}

const run = (cloud: CloudSandboxes) =>
  cloud.remote('c1').sh('echo hello', { timeoutMs: 5_000, signal: AbortSignal.timeout(10_000) });

describe('the cloud sandbox', () => {
  it('makes the chat’s sandbox, labelled, that sleeps when idle, wakes it, and runs there', async () => {
    const { fetch, calls } = daytona();
    const cloud = new CloudSandboxes({ key: async () => KEY, fetch, sleep: async () => undefined });
    const result = await run(cloud);
    expect(result).toMatchObject({ code: 0, output: 'hello\n' });
    const made = calls.find((c) => c.method === 'POST' && c.url === `${DAYTONA_API}/sandbox`);
    expect(JSON.parse(made?.body ?? '{}')).toMatchObject({
      labels: { 'conch-chat': 'c1' },
      ...LIFETIME,
    });
    expect(calls.some((c) => c.url.endsWith('/sb1/start'))).toBe(true);
    const ran = calls.find((c) => c.url.includes('/process/execute'));
    expect(ran?.url).toBe('https://proxy.app.daytona.io/toolbox/sb1/process/execute');
    // The script travels as base64, so nothing on the way can change it.
    expect(JSON.parse(ran?.body ?? '{}').command).toMatch(
      /^sh -c "echo [A-Za-z0-9+/=]+ \| base64 -d \| sh"$/,
    );
  });

  it('sends the key only to Daytona, only in a header', async () => {
    const { fetch, calls } = daytona({ state: 'started' });
    await run(new CloudSandboxes({ key: async () => KEY, fetch, sleep: async () => undefined }));
    for (const call of calls) {
      expect(
        daytonaUrl(call.url) ?? new URL(call.url).hostname.endsWith('daytona.io'),
      ).toBeTruthy();
      expect(call.url).not.toContain(KEY);
      expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
    }
  });

  it('won’t follow a toolbox address that isn’t Daytona’s own', async () => {
    const { fetch } = daytona({ state: 'started', proxy: 'https://attacker.example/toolbox' });
    const cloud = new CloudSandboxes({ key: async () => KEY, fetch, sleep: async () => undefined });
    await expect(run(cloud)).rejects.toThrow(/isn’t its own/);
    expect(daytonaUrl('http://proxy.app.daytona.io/x')).toBeUndefined();
    expect(daytonaUrl('https://daytona.io.evil.example/x')).toBeUndefined();
  });

  it('asks for the key in words, and again when Daytona refuses it', async () => {
    await expect(run(new CloudSandboxes({ key: async () => undefined }))).rejects.toThrow(
      /Daytona key first/,
    );
    const { fetch } = daytona({ status: [401] });
    await expect(run(new CloudSandboxes({ key: async () => KEY, fetch }))).rejects.toBeInstanceOf(
      PlaceUnavailable,
    );
  });

  it('tries again by itself when Daytona is busy for a moment', async () => {
    const { fetch } = daytona({ state: 'started', status: [503, 429] });
    const result = await run(
      new CloudSandboxes({ key: async () => KEY, fetch, sleep: async () => undefined }),
    );
    expect(result.code).toBe(0);
  });
});
