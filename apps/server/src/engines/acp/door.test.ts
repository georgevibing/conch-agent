import { spawn } from 'node:child_process';
import { request } from 'node:http';

import { describe, expect, it } from 'vitest';

import type { Callable } from '../api/engine';
import { openDoor } from './door';
import { SHIM_SCRIPT } from './engine';

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
  it('sends resource guidance beside the result while keeping events and failures unchanged', async () => {
    const raw = '{"status":"stopped"}';
    const ended: unknown[] = [];
    const stop = new AbortController();
    const item = { ...tool('observe'), run: async () => ({ text: raw, isError: true }) };
    const door = await openDoor(
      new Map([['observe', item]]),
      {
        start() {},
        end(event) {
          ended.push(event);
        },
      },
      stop.signal,
      { resourceFeedback: () => '[Conch resource update: wait]' },
    );
    try {
      const key = Object.fromEntries(door.headers.map((h) => [h.name, h.value]));
      expect(await call(door.url, key, 'observe')).toMatchObject({
        result: {
          isError: true,
          content: [
            { type: 'text', text: raw },
            { type: 'text', text: '[Conch resource update: wait]' },
          ],
        },
      });
      expect(ended).toContainEqual(expect.objectContaining({ status: 'error', output: raw }));
    } finally {
      stop.abort();
      await door.close();
    }
  });
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

describe('the stdio door (shim.mjs)', () => {
  const run = (env: Record<string, string>) =>
    new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, [SHIM_SCRIPT], { env, stdio: 'ignore' });
      child.on('close', resolve);
    });

  it('relays only to a door on this computer, and only with a key', async () => {
    expect(await run({ CONCH_DOOR_URL: 'http://evil.example:80/mcp', CONCH_DOOR_KEY: 'k' })).toBe(
      2,
    );
    expect(await run({ CONCH_DOOR_URL: 'http://127.0.0.1:1/other', CONCH_DOOR_KEY: 'k' })).toBe(2);
    expect(await run({ CONCH_DOOR_URL: 'http://127.0.0.1:4317/mcp', CONCH_DOOR_KEY: '' })).toBe(2);
  });

  it('gets nothing from the door with the wrong key', async () => {
    const door = await openDoor(
      new Map([['x', tool('x')]]),
      { start() {}, end() {} },
      new AbortController().signal,
    );
    const child = spawn(process.execPath, [SHIM_SCRIPT], {
      env: { CONCH_DOOR_URL: door.url, CONCH_DOOR_KEY: 'not-the-key' },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const answer = new Promise<string>((resolve) =>
      child.stdout.once('data', (d: Buffer) => resolve(d.toString())),
    );
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' })}\n`);
    expect(JSON.parse(await answer)).toMatchObject({ id: 7, error: { code: -32603 } });
    child.kill();
    await door.close();
  });
});

/** A tool call through the door, read back as the agent would. */
function call(url: string, headers: Record<string, string>, name: string) {
  return new Promise<unknown>((resolve, reject) => {
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
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('end', () => resolve(JSON.parse(body)));
      },
    );
    req.on('error', reject);
    req.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name, arguments: {} },
      }),
    );
  });
}

describe('a tool’s pictures through the door (ADR 0070)', () => {
  it('go back as MCP images after the words', async () => {
    const stop = new AbortController();
    const shot: Callable = {
      ...tool('browser_screenshot'),
      run: async () => ({
        text: 'Screenshot of “Shop”.',
        isError: false,
        images: [{ data: '/9j/AAAA', mimeType: 'image/jpeg' }],
      }),
    };
    const ended: { output: string }[] = [];
    const door = await openDoor(
      new Map([['browser_screenshot', shot]]),
      { start() {}, end: (e) => void ended.push(e) },
      stop.signal,
    );
    const key = Object.fromEntries(door.headers.map((h) => [h.name, h.value]));
    try {
      const reply = (await call(door.url, key, 'browser_screenshot')) as {
        result: { content: unknown[] };
      };
      expect(reply.result.content).toEqual([
        { type: 'text', text: 'Screenshot of “Shop”.' },
        { type: 'image', data: '/9j/AAAA', mimeType: 'image/jpeg' },
      ]);
      // The person's row shows the words, never the bytes.
      expect(ended[0]?.output).toBe('Screenshot of “Shop”.');
    } finally {
      stop.abort();
      await door.close();
    }
  });
});
