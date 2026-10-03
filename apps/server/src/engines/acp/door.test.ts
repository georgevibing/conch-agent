import { request } from 'node:http';

import { describe, expect, it } from 'vitest';

import type { Callable } from '../api/engine';
import { openDoor } from './door';

function tool(name: string): Callable {
  return {
    spec: { name, description: 'A tool.', schema: { type: 'object', properties: {} } },
    display: name,
    run: async () => ({ text: 'done', isError: false }),
  };
}

/** A raw request, so headers a browser would add can be added on purpose. */
function knock(url: string, headers: Record<string, string>, body = '{}') {
  return new Promise<number>((resolve, reject) => {
    const target = new URL(url);
    const req = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...headers,
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const list = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

describe('the door Conch opens for an agent’s turn', () => {
  it('only opens to this computer, with the turn’s key', async () => {
    const stop = new AbortController();
    const door = await openDoor(new Map([['a', tool('a')]]), { start() {}, end() {} }, stop.signal);
    const key = Object.fromEntries(door.headers.map((h) => [h.name, h.value]));
    try {
      expect(door.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      // No key, or a wrong one: not in.
      expect(await knock(door.url, {}, list)).toBe(401);
      expect(await knock(door.url, { authorization: 'Bearer nope' }, list)).toBe(401);
      // A web page always says where it's from: never in, key or not.
      expect(await knock(door.url, { ...key, origin: 'https://evil.example' }, list)).toBe(403);
      // A name that points here but isn't this address (DNS rebinding): not in.
      expect(await knock(door.url, { ...key, host: 'rebind.example:80' }, list)).toBe(403);
      // The agent, with the key: in.
      expect(await knock(door.url, key, list)).toBe(200);
    } finally {
      stop.abort();
      await door.close();
    }
  });

  it('closes when the turn ends', async () => {
    const stop = new AbortController();
    const door = await openDoor(new Map(), { start() {}, end() {} }, stop.signal);
    const key = Object.fromEntries(door.headers.map((h) => [h.name, h.value]));
    await door.close();
    await expect(knock(door.url, key, list)).rejects.toThrow();
  });
});
