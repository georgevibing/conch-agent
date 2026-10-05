import { afterEach, describe, expect, it, vi } from 'vitest';

import { MockMatrix } from './matrix';

let matrix: MockMatrix | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await matrix?.stop();
  matrix = undefined;
});

async function setup() {
  matrix = new MockMatrix();
  const base = await matrix.start();
  const login = await fetch(`${base}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: { user: MockMatrix.BOT }, password: MockMatrix.PASSWORD }),
  });
  const { access_token } = (await login.json()) as { access_token: string };
  return { matrix, base, headers: { authorization: `Bearer ${access_token}` } };
}

describe('Matrix fixture response and resource boundaries', () => {
  it('returns stored strings as inert text and ordinary objects as JSON', async () => {
    const { base, headers } = await setup();
    const url = `${base}/_matrix/client/v3/user/${encodeURIComponent(MockMatrix.BOT)}/account_data/example`;
    const text = '<script>alert(document.domain)</script>';
    const written = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'text/plain' },
      body: text,
    });
    expect(written.status).toBe(200);
    const read = await fetch(url, { headers });
    expect(read.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(read.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await read.text()).toBe(text);
    await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const object = await fetch(url, { headers });
    expect(object.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await object.json()).toEqual({ text });
  });

  it('keeps uploaded bytes downloadable while preventing document execution', async () => {
    const { base, headers } = await setup();
    const bytes = '<html><script>alert(1)</script></html>';
    const uploaded = await fetch(`${base}/_matrix/media/v3/upload`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'image/png' },
      body: bytes,
    });
    const { content_uri } = (await uploaded.json()) as { content_uri: string };
    const id = content_uri.split('/').at(-1);
    const response = await fetch(
      `${base}/_matrix/client/v1/media/download/${MockMatrix.SERVER}/${id}`,
      { headers },
    );
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(await response.text()).toBe(bytes);
  });

  it('never schedules an unbounded or non-finite sync delay', async () => {
    const { base, headers } = await setup();
    const timer = vi.spyOn(globalThis, 'setTimeout');
    for (const timeout of ['-1', 'NaN', 'Infinity', '99999999999999']) {
      const response = await fetch(
        `${base}/_matrix/client/v3/sync?since=999999&timeout=${timeout}`,
        { headers },
      );
      expect(response.status).toBe(200);
    }
    // Inspect only the long-poll callback, excluding fetch/server deadlines.
    const waits = timer.mock.calls
      .filter(([callback]) => callback.name === 'wake')
      .map(([, delay]) => delay);
    expect(waits).toEqual([1500]);
  });
});
