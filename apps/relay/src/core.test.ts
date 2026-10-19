import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { Relay, type Delivery, type RelayLimits } from './core.ts';
import {
  b64url,
  generateKeyPair,
  hookTag,
  keyId,
  open,
  RELAY_INFO,
  relayAad,
  sha256,
  type KeyPair,
} from './envelope.ts';
import { FileStore, serve } from './node.ts';
import { KeyValueStore, MemoryStore, type KeyValue, type RelayStore } from './store.ts';

const HOOK = 'h'.repeat(43);
const TOKEN = 'relay-token-' + 'x'.repeat(32);
const BASE = 'https://relay.example';

interface Wire {
  items: { id: string; receivedAt: number; enc: string; ct: string }[];
  depth: number;
}

async function make(
  options: { limits?: Partial<RelayLimits>; store?: RelayStore; clock?: () => number } = {},
) {
  const keys = await generateKeyPair();
  const store = options.store ?? new MemoryStore();
  const relay = new Relay(
    { publicKey: keys.publicKey, tokenHash: await sha256(new TextEncoder().encode(TOKEN)) },
    store,
    { replyWaitMs: 200, ...options.limits },
    options.clock,
  );
  const auth = { authorization: `Bearer ${TOKEN}` };
  const gateway = (path: string, init: RequestInit = {}) =>
    relay.fetch(
      new Request(`${BASE}/relay/v1/${path}`, {
        ...init,
        headers: { ...auth, 'content-type': 'application/json', ...init.headers },
      }),
    );
  await gateway('hooks', { method: 'PUT', body: JSON.stringify({ tags: [await hookTag(HOOK)] }) });
  const post = (body: string, headers: Record<string, string> = {}, hook = HOOK) =>
    relay.fetch(
      new Request(`${BASE}/hooks/${hook}?x=1`, {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', ...headers },
      }),
    );
  const next = async (wait = 0) => (await (await gateway(`next?wait=${wait}`)).json()) as Wire;
  const ack = (acks: unknown[]) =>
    gateway('ack', { method: 'POST', body: JSON.stringify({ acks }) });
  return { relay, keys, store, gateway, post, next, ack };
}

function one<T>(items: T[]): T {
  const [item] = items;
  if (!item) throw new Error('Nothing there.');
  return item;
}

async function unseal(keys: KeyPair, item: Wire['items'][number]): Promise<Delivery> {
  const plain = await open(
    keys.privateKey,
    { enc: b64url.decode(item.enc), ct: b64url.decode(item.ct) },
    { info: RELAY_INFO, aad: relayAad(item.id, item.receivedAt) },
  );
  return JSON.parse(new TextDecoder().decode(plain)) as Delivery;
}

describe('the relay', () => {
  it('keeps a delivery sealed: only the gateway’s key opens it', async () => {
    const { keys, post, next, store } = await make();
    const res = await post('{"secret":"the launch code"}', {
      'webhook-id': 'msg_1',
      cookie: 'a=b',
    });
    expect(res.status).toBe(200);
    // What the relay stored says nothing it could read.
    const stored = JSON.stringify(await store.load());
    expect(stored).not.toContain('launch code');
    expect(stored).not.toContain(HOOK);
    expect(stored).not.toContain('msg_1');
    const { items } = await next();
    expect(items).toHaveLength(1);
    const delivery = await unseal(keys, one(items));
    expect(delivery).toMatchObject({
      hookId: HOOK,
      method: 'POST',
      query: { x: '1' },
      search: 'x=1',
      body: '{"secret":"the launch code"}',
    });
    expect(delivery.headers['webhook-id']).toBe('msg_1');
    // Headers about the connection, and cookies, are never kept.
    expect(delivery.headers.cookie).toBeUndefined();
    // Another key (the relay's, an attacker's) opens nothing.
    const stranger = await generateKeyPair();
    await expect(unseal(stranger, one(items))).rejects.toThrow();
  });

  it('turns away addresses the gateway didn’t register, and the gateway’s side without the token', async () => {
    const { relay, post } = await make();
    expect((await post('{}', {}, 'z'.repeat(43))).status).toBe(404);
    for (const authorization of ['', 'Bearer wrong-token-wrong-token-1234', `Basic ${TOKEN}`]) {
      const res = await relay.fetch(
        new Request(`${BASE}/relay/v1/next`, { headers: { authorization } }),
      );
      expect(res.status).toBe(401);
    }
    // Never in the address.
    const res = await relay.fetch(new Request(`${BASE}/relay/v1/next?token=${TOKEN}`));
    expect(res.status).toBe(401);
  });

  it('says which key it seals to, and how much waits', async () => {
    const { keys, post, gateway } = await make();
    await post('{}');
    const status = (await (await gateway('status')).json()) as Record<string, unknown>;
    expect(status).toMatchObject({
      protocol: 1,
      depth: 1,
      hooks: 1,
      keyId: await keyId(keys.publicKey),
    });
  });

  it('hands a delivery out once per lease, again if it isn’t acknowledged, and forgets it on ack', async () => {
    let now = 1_000_000;
    const { post, next, ack } = await make({ clock: () => now });
    await post('{"n":1}');
    const first = await next();
    expect(first.items).toHaveLength(1);
    expect((await next()).items).toHaveLength(0);
    now += 61_000;
    const again = await next();
    expect(again.items.map((i) => i.id)).toEqual(first.items.map((i) => i.id));
    expect(await (await ack([{ id: one(again.items).id }])).json()).toEqual({ depth: 0 });
    // Acknowledging twice is fine (idempotent).
    expect((await ack([{ id: one(again.items).id }])).status).toBe(200);
    now += 61_000;
    expect((await next()).items).toHaveLength(0);
  });

  it('keeps a delivery a week at most', async () => {
    let now = 1_000_000;
    const { post, next } = await make({ clock: () => now });
    await post('{}');
    now += 7 * 24 * 60 * 60_000 + 61_000;
    expect(await next()).toEqual({ items: [], depth: 0 });
  });

  it('is bounded: all deliveries, each address, bytes and size', async () => {
    const { post } = await make({ limits: { maxItems: 3, perHook: 2, bodyLimit: 100 } });
    expect((await post('x'.repeat(101))).status).toBe(413);
    expect((await post('{}')).status).toBe(200);
    expect((await post('{}')).status).toBe(200);
    const full = await post('{}');
    expect(full.status).toBe(503);
    expect(full.headers.get('retry-after')).toBe('600');
    const small = await make({ limits: { maxBytes: 700 } });
    expect((await small.post('x'.repeat(300))).status).toBe(200);
    expect((await small.post('x'.repeat(300))).status).toBe(503);
  });

  it('limits how fast deliveries come, per address', async () => {
    const { post } = await make({ limits: { perHookPerMinute: 2 } });
    expect((await post('1')).status).toBe(200);
    expect((await post('2')).status).toBe(200);
    expect((await post('3')).status).toBe(429);
  });

  it('answers Twilio with empty TwiML while the gateway is away', async () => {
    const { post } = await make();
    const res = await post('Body=hi', { 'x-twilio-signature': 'abc' });
    expect(res.headers.get('content-type')).toBe('text/xml');
    expect(await res.text()).toContain('<Response>');
  });

  it('passes a delivery straight through while the gateway listens, with the gateway’s own answer', async () => {
    const { keys, post, next, ack } = await make({ limits: { replyWaitMs: 2_000 } });
    const polling = next(5);
    await new Promise((r) => setTimeout(r, 10));
    const sending = post('{"live":true}');
    const { items } = await polling;
    expect(items).toHaveLength(1);
    expect((await unseal(keys, one(items))).body).toBe('{"live":true}');
    await ack([
      { id: one(items).id, reply: { status: 202, body: 'Accepted.', type: 'text/plain' } },
    ]);
    const res = await sending;
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('Accepted.');
  });

  it('keeps the queue in a Durable Object’s storage too', async () => {
    const map = new Map<string, unknown>();
    const kv: KeyValue = {
      get: <T>(key: string) => Promise.resolve(map.get(key) as T | undefined),
      put: (key, value) => Promise.resolve(void map.set(key, structuredClone(value))),
      delete: (keys) => Promise.resolve(keys.map((k) => map.delete(k))),
      list: <T>({ prefix }: { prefix: string }) =>
        Promise.resolve(new Map([...map].filter(([k]) => k.startsWith(prefix)) as [string, T][])),
    };
    const first = await make({ store: new KeyValueStore(kv) });
    await first.post('{"kept":1}');
    // A new instance (the object woke up again) finds it.
    const relay = new Relay(
      { publicKey: first.keys.publicKey, tokenHash: await sha256(new TextEncoder().encode(TOKEN)) },
      new KeyValueStore(kv),
    );
    const res = await relay.fetch(
      new Request(`${BASE}/relay/v1/next`, { headers: { authorization: `Bearer ${TOKEN}` } }),
    );
    const { items } = (await res.json()) as Wire;
    expect((await unseal(first.keys, one(items))).body).toBe('{"kept":1}');
  });
});

describe('the relay on Node', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it('serves over HTTP and keeps the queue across a restart, as files only it can read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relay-'));
    dirs.push(dir);
    const first = await make({ store: new FileStore(dir) });
    const server = serve(first.relay);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/hooks/${HOOK}`, {
      method: 'POST',
      body: 'From=%2B15550001111&Body=hello',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.status).toBe(200);
    // Refused: a 413, or the connection closed under a sender that kept on sending.
    const big = await fetch(`http://127.0.0.1:${port}/hooks/${HOOK}`, {
      method: 'POST',
      body: 'x'.repeat(2 * 1024 * 1024),
    }).then(
      (r) => r.status,
      () => 413,
    );
    expect(big).toBe(413);
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));

    const files = await readdir(join(dir, 'items'));
    expect(files).toHaveLength(1);
    expect(await readFile(join(dir, 'items', one(files)), 'utf8')).not.toContain('hello');

    const again = new Relay(
      { publicKey: first.keys.publicKey, tokenHash: await sha256(new TextEncoder().encode(TOKEN)) },
      new FileStore(dir),
    );
    const next = await again.fetch(
      new Request(`${BASE}/relay/v1/next`, { headers: { authorization: `Bearer ${TOKEN}` } }),
    );
    const { items } = (await next.json()) as Wire;
    expect((await unseal(first.keys, one(items))).body).toBe('From=%2B15550001111&Body=hello');
  });
});
