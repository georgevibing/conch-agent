/**
 * The door other apps knock on (ADR 0073), attacked the ways it could be:
 * an app nobody paired, a web page (CSRF), a rebinding name, a request from
 * elsewhere, a guessed key, a replayed proof, a scope it doesn't have, and
 * an app that was removed.
 */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';
import { onThisComputer } from '../test/here';
import { proofFor } from './endpoint';

vi.setConfig({ testTimeout: 30_000 });

const PASSWORD = 'purple otters juggle at dawn';
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await close?.();
  close = undefined;
});

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-mcp-door-'));
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
      CONCH_ALLOWED_HOSTS: 'conch.example',
    }),
  );
  const app = onThisComputer(await buildApp(services), services);
  close = () => app.close();
  await services.memory.add({ content: 'Ada takes her tea black', source: 'user' });
  const pair = async (payload: Record<string, unknown>) => {
    const res = await app.inject({ method: 'POST', url: '/api/mcp/clients', payload });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as {
      client: { id: string; name: string };
      setup?: { key?: string; command: string; args: string[] };
    };
  };
  return { home, services, app, pair };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  },
};
const LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
const call = (name: string, args: Record<string, unknown>) => ({
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: { name, arguments: args },
});

const rpc = (app: App, body: unknown, headers: Record<string, string> = {}, extra = {}) =>
  app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      ...headers,
    },
    payload: JSON.stringify(body),
    ...extra,
  });

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Through a proxy on this computer that says it relayed HTTPS: your own address. */
const viaAddress = {
  host: 'conch.example',
  'x-forwarded-for': '203.0.113.20',
  'x-forwarded-proto': 'https',
};

async function session(app: App, client: string, key: string): Promise<string> {
  const hello = await app.inject({ method: 'POST', url: '/mcp/hello', payload: { client } });
  const { nonce } = hello.json() as { nonce: string };
  const opened = await app.inject({
    method: 'POST',
    url: '/mcp/session',
    payload: { client, nonce, proof: proofFor(key, client, nonce) },
  });
  expect(opened.statusCode, opened.body).toBe(200);
  return (opened.json() as { token: string }).token;
}

describe('an app nobody paired', () => {
  it('is told how to pair, and gets nothing else', async () => {
    const { app } = await setup();
    const none = await rpc(app, LIST);
    expect(none.statusCode).toBe(401);
    expect(none.json()).toMatchObject({
      error: 'not-paired',
      message: expect.stringMatching(/Other apps/),
    });
    const guessed = await rpc(app, LIST, bearer(`cmcp.mcpc_${'a'.repeat(12)}.${'b'.repeat(43)}`));
    expect(guessed.statusCode).toBe(401);
  });

  it('guessing keys is slowed down, like guessing a password', async () => {
    const { app } = await setup();
    let last = 0;
    for (let i = 0; i < 7; i++)
      last = (await rpc(app, LIST, bearer(`cmcp.x.guess${i}`))).statusCode;
    expect(last).toBe(429);
  });
});

describe('a web page', () => {
  it('can’t use an app’s key from a browser (CSRF), even one that names this host', async () => {
    const { app, pair } = await setup();
    const { setup: given } = await pair({ app: 'other', scopes: ['memory.read'], http: true });
    const key = given?.key ?? '';
    for (const origin of ['https://evil.example', 'http://localhost:80', 'null']) {
      const res = await rpc(app, LIST, { ...bearer(key), origin });
      expect(res.statusCode, origin).toBe(403);
    }
    expect(
      (await rpc(app, LIST, { ...bearer(key), 'sec-fetch-site': 'cross-site' })).statusCode,
    ).toBe(403);
    expect(
      (await rpc(app, LIST, { ...bearer(key), 'sec-fetch-site': 'same-site' })).statusCode,
    ).toBe(403);
    // A form can post text/plain without asking first: it isn't read at all.
    const form = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'text/plain', ...bearer(key) },
      payload: JSON.stringify(LIST),
    });
    expect(form.statusCode).toBe(415);
  });

  it('can’t reach it under a rebinding name', async () => {
    const { app, pair } = await setup();
    const { setup: given } = await pair({ app: 'other', scopes: ['memory.read'], http: true });
    const res = await rpc(app, LIST, {
      ...bearer(given?.key ?? ''),
      host: 'attacker.example:4317',
    });
    expect(res.statusCode).toBe(421);
  });
});

describe('from elsewhere', () => {
  it('is closed: another computer on the network gets nothing, with a key or without', async () => {
    const { app, pair } = await setup();
    const { setup: given } = await pair({ app: 'other', scopes: ['memory.read'], http: true });
    const res = await rpc(app, LIST, bearer(given?.key ?? ''), { remoteAddress: '192.168.1.20' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'not-here' });
  });

  it('through your own address, only when you turned it on, and only for an app you marked', async () => {
    const { app, pair } = await setup();
    const marked = await pair({ app: 'other', scopes: ['memory.read'], http: true, remote: true });
    const unmarked = await pair({ app: 'other', scopes: ['memory.read'], http: true });
    const ask = (key: string) => rpc(app, LIST, { ...bearer(key), ...viaAddress });
    expect((await ask(marked.setup?.key ?? '')).statusCode).toBe(403);
    const on = await app.inject({ method: 'PUT', url: '/api/mcp/remote', payload: { on: true } });
    expect(on.statusCode, on.body).toBe(200);
    expect((await ask(marked.setup?.key ?? '')).statusCode).toBe(200);
    expect((await ask(unmarked.setup?.key ?? '')).statusCode).toBe(401);
    // Plain HTTP from elsewhere never, switch or not.
    const plain = await rpc(app, LIST, bearer(marked.setup?.key ?? ''), {
      remoteAddress: '203.0.113.20',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        host: 'conch.example',
        ...bearer(marked.setup?.key ?? ''),
      },
    });
    expect(plain.statusCode).toBe(403);
  });
});

describe('the launcher', () => {
  it('proves it holds the key without sending it, and gets the app’s tools', async () => {
    const { app, pair, home } = await setup();
    const { client } = await pair({ app: 'other', scopes: ['memory.read'] });
    const key = (await readFile(join(home, 'mcp', 'keys', `${client.id}.key`), 'utf8')).trim();
    // A launcher-only app's key isn't accepted as a bearer: it never travels.
    expect((await rpc(app, LIST, bearer(key))).statusCode).toBe(401);
    const token = await session(app, client.id, key);
    expect((await rpc(app, INIT, bearer(token))).json()).toMatchObject({
      result: { serverInfo: { name: 'conch' } },
    });
    const listed = (await rpc(app, LIST, bearer(token))).json() as {
      result: { tools: { name: string }[] };
    };
    expect(listed.result.tools.map((t) => t.name)).toEqual(['search_memory']);
    const found = (await rpc(app, call('search_memory', { query: 'tea' }), bearer(token))).json();
    expect(found.result).toMatchObject({
      isError: false,
      content: [{ type: 'text', text: expect.stringContaining('Ada takes her tea black') }],
    });
  });

  it('a proof answers once, only for its own app and nonce', async () => {
    const { app, pair, home } = await setup();
    const one = (await pair({ app: 'other', scopes: ['memory.read'] })).client.id;
    const two = (await pair({ app: 'other', scopes: ['browser'] })).client.id;
    const key = (await readFile(join(home, 'mcp', 'keys', `${one}.key`), 'utf8')).trim();
    const { nonce } = (
      await app.inject({ method: 'POST', url: '/mcp/hello', payload: { client: one } })
    ).json() as { nonce: string };
    const open = (client: string, proof: string) =>
      app.inject({ method: 'POST', url: '/mcp/session', payload: { client, nonce, proof } });
    // Claiming another app with this app's key, or with a made-up proof, opens nothing.
    expect((await open(two, proofFor(key, two, nonce))).statusCode).toBe(401);
    const fresh = (
      await app.inject({ method: 'POST', url: '/mcp/hello', payload: { client: one } })
    ).json() as { nonce: string };
    const good = proofFor(key, one, fresh.nonce);
    const first = await app.inject({
      method: 'POST',
      url: '/mcp/session',
      payload: { client: one, nonce: fresh.nonce, proof: good },
    });
    expect(first.statusCode).toBe(200);
    const replayed = await app.inject({
      method: 'POST',
      url: '/mcp/session',
      payload: { client: one, nonce: fresh.nonce, proof: good },
    });
    expect(replayed.statusCode).toBe(401);
  });

  it('a session works only on this computer', async () => {
    const { app, pair, home } = await setup();
    const { client } = await pair({ app: 'other', scopes: ['memory.read'] });
    const key = (await readFile(join(home, 'mcp', 'keys', `${client.id}.key`), 'utf8')).trim();
    const token = await session(app, client.id, key);
    await app.inject({ method: 'PUT', url: '/api/mcp/remote', payload: { on: true } });
    expect((await rpc(app, LIST, { ...bearer(token), ...viaAddress })).statusCode).toBe(401);
    const hello = await app.inject({
      method: 'POST',
      url: '/mcp/hello',
      payload: { client: client.id },
      headers: viaAddress,
    });
    expect(hello.statusCode).toBe(403);
  });

  it('removing the app ends what it had open, at once', async () => {
    const { app, pair, home } = await setup();
    const { client } = await pair({ app: 'other', scopes: ['memory.read'] });
    const key = (await readFile(join(home, 'mcp', 'keys', `${client.id}.key`), 'utf8')).trim();
    const token = await session(app, client.id, key);
    expect((await rpc(app, LIST, bearer(token))).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/mcp/clients/${client.id}` })).statusCode,
    ).toBe(200);
    expect((await rpc(app, LIST, bearer(token))).statusCode).toBe(401);
  });
});

describe('a scope over the door', () => {
  it('a call outside it is refused in words, and nothing outside it is listed', async () => {
    const { app, pair } = await setup();
    const { setup: given } = await pair({ app: 'other', scopes: ['memory.read'], http: true });
    const key = given?.key ?? '';
    const refused = (
      await rpc(app, call('browser_open', { url: 'https://example.com' }), bearer(key))
    ).json();
    expect(refused.result).toMatchObject({ isError: true });
    expect(refused.result.content[0].text).toMatch(/isn’t something .* may use/);
    const write = (await rpc(app, call('suggest_memory', { content: 'x' }), bearer(key))).json();
    expect(write.result.isError).toBe(true);
  });
});

describe('pairing, from Settings', () => {
  async function signedIn(app: App) {
    const set = await app.inject({
      method: 'PUT',
      url: '/api/access/password',
      payload: { username: 'ada', password: PASSWORD },
    });
    expect(set.statusCode, set.body).toBe(200);
    const raw = set.headers['set-cookie'];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw)).split(';')[0] ?? '';
  }

  it('needs the owner who just confirmed it’s them; removing one never does', async () => {
    const { app, pair } = await setup();
    const { client } = await pair({ app: 'other', scopes: ['memory.read'] });
    const cookie = await signedIn(app);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/mcp/clients',
      headers: { cookie },
      payload: { app: 'other', scopes: ['memory.read'] },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe('verify-required');
    // Asking for more needs it too; asking for less doesn't.
    const wider = await app.inject({
      method: 'PATCH',
      url: `/api/mcp/clients/${client.id}`,
      headers: { cookie },
      payload: { scopes: ['memory.read', 'browser'] },
    });
    expect(wider.statusCode).toBe(403);
    const remoteOn = await app.inject({
      method: 'PUT',
      url: '/api/mcp/remote',
      headers: { cookie },
      payload: { on: true },
    });
    expect(remoteOn.statusCode).toBe(403);
    const gone = await app.inject({
      method: 'DELETE',
      url: `/api/mcp/clients/${client.id}`,
      headers: { cookie },
    });
    expect(gone.statusCode).toBe(200);
  });

  it('only for things there are: an app that isn’t connected pairs nothing', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp/clients',
      payload: { app: 'other', scopes: ['app:not-connected'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('an access key (a script) can’t pair an app', async () => {
    const { app, services } = await setup();
    const { key } = await services.access.addKey('script');
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp/clients',
      headers: { authorization: `Bearer ${key}`, 'x-test-not-here': '1' },
      payload: { app: 'other', scopes: ['memory.read'] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('approver-only');
  });
});
