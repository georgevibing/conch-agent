import { createHmac } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Relay } from '@conch/relay/core';
import { generateKeyPair, parseSetupCode } from '@conch/relay/envelope';
import { MemoryStore } from '@conch/relay/store';
import { afterEach, describe, expect, it } from 'vitest';

import { ChannelDoorService, type HookRequest } from '../channels/door';
import { HookSecrets, hookSource, newHookId } from '../routines/triggers/hook';
import type { Happening } from '../routines/triggers/types';
import { relayCheck } from './doctor';
import { RelayService } from './service';

const START = Date.UTC(2026, 9, 18, 9);
const RELAY = 'https://relay.test';
const HOUR = 60 * 60_000;

/** Sign as a Standard Webhooks sender does. */
function standard(secret: string, id: string, body: string, at: number) {
  const stamp = Math.floor(at / 1000);
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${stamp}.${body}`).digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': String(stamp), 'webhook-signature': `v1,${sig}` };
}

const doors: ChannelDoorService[] = [];
afterEach(() => {
  for (const door of doors.splice(0)) door.stop();
});

const noTailscale = {
  funnelStatus: () => Promise.resolve({ state: 'off' as const, busy: [] }),
  funnel: () => Promise.resolve({ state: 'off' as const, busy: [] }),
  unfunnel: () => Promise.resolve(),
};

/**
 * A Conch with its door, the relay service and a routine that listens for
 * signed webhooks; and "the internet": a relay deployed with the setup code
 * Conch showed, which the gateway reaches over `fetch`.
 */
interface Shared {
  home: string;
  hookId: string;
  clock: { now: () => number; set: (t: number) => void };
  deployed: () => Relay | undefined;
}

async function make(options: { host?: string; again?: Shared } = {}) {
  const home = options.again?.home ?? (await mkdtemp(join(tmpdir(), 'conch-relay-')));
  let now = START;
  /** How far the relay's clock is from this computer's. */
  let skew = 0;
  const clock = options.again?.clock ?? { now: () => now, set: (t: number) => (now = t) };
  const relayClock = () => clock.now() + skew;
  let deployed: Relay | undefined = options.again?.deployed();
  const internet = (url: string | URL | Request, init?: RequestInit) => {
    if (!deployed) return Promise.reject(new Error('Nothing answers there.'));
    return deployed.fetch(new Request(String(url), init));
  };
  const late: { relay?: RelayService } = {};
  const door = new ChannelDoorService({
    home,
    port: 0,
    tailscale: noTailscale,
    relay: (url) => (late.relay as RelayService).probe(url),
  });
  doors.push(door);
  const relay = new RelayService({
    home,
    door,
    fetch: internet as typeof fetch,
    now: clock.now,
    host: () => options.host ?? 'my-mac',
    version: '0.1.0-alpha.15',
    loop: false,
  });
  late.relay = relay;
  const service = relay;

  // A routine that starts when another app sends a signed message.
  const secrets = new HookSecrets(home);
  const hookId = options.again?.hookId ?? newHookId();
  const secret = (await secrets.get(hookId)) ?? (await secrets.create(hookId));
  const arrived: Happening[] = [];
  const watch = hookSource({
    door: {
      mount: (id, handler) => door.mount(id, undefined, handler),
      url: (id) => door.hookUrl(id),
      ready: () => door.status().state === 'ready',
      onChange: (l) => door.onChange(() => l()),
    },
    secrets,
    now: clock.now,
  }).watch?.(
    { routineId: 'r1', title: 'Orders', trigger: { kind: 'hook', hookId }, since: 0, state: {} },
    (h) => arrived.push(...h),
    () => undefined,
  );

  /** Deploy the relay as the person would: with the code, nothing else. */
  const deploy = async (code?: string) => {
    const view = await service.pair();
    deployed = new Relay(
      parseSetupCode(code ?? view.setup?.code ?? ''),
      new MemoryStore(),
      {},
      relayClock,
    );
    return deployed;
  };
  /** Another app sends to the address Conch gave it. */
  const send = (body: string, at = clock.now(), headers?: Record<string, string>) => {
    const url = door.hookUrl(hookId);
    if (!url || !deployed) throw new Error('No address.');
    return deployed.fetch(
      new Request(url, {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          ...(headers ?? standard(secret, `msg_${Math.random()}`, body, at)),
        },
      }),
    );
  };
  return {
    home,
    door,
    relay: service,
    clock,
    hookId,
    secret,
    arrived,
    deploy,
    send,
    stop: () => watch?.stop(),
    deployed: () => deployed,
    skew: (ms: number) => (skew = ms),
  };
}

describe('the always-on relay, from the gateway', () => {
  it('pairs with a setup code that holds no secret, and hands out the relay’s addresses', async () => {
    const c = await make();
    expect((await c.relay.view()).state).toBe('off');
    const view = await c.relay.pair();
    expect(view.state).toBe('pairing');
    expect(view.setup?.code).toMatch(/^conch-relay-1\./);
    expect(view.setup?.node).toContain('/v0.1.0-alpha.15/apps/relay/install.sh');
    expect(view.setup?.worker).toContain('wrangler');
    // The token and the private key stay sealed in their own file; the code has neither.
    const secrets = await readFile(join(c.home, 'relay.secrets.json'), 'utf8');
    const { token, privateKey } = JSON.parse(secrets) as { token: string; privateKey: string };
    expect(view.setup?.code).not.toContain(token);
    expect(view.setup?.code).not.toContain(privateKey);
    expect(JSON.stringify(view)).not.toContain(token);
    // Pressing it again shows the same setup.
    expect((await c.relay.pair()).setup?.code).toBe(view.setup?.code);

    await c.deploy();
    await expect(c.relay.connect('http://relay.test')).rejects.toThrow(/HTTPS/);
    const ready = await c.relay.connect(RELAY);
    expect(ready.state).toBe('ready');
    expect(c.door.status()).toMatchObject({ state: 'ready', via: 'relay', url: RELAY });
    expect(c.door.hookUrl(c.hookId)).toBe(`${RELAY}/hooks/${c.hookId}`);
  });

  it('refuses a relay deployed for another key', async () => {
    const c = await make();
    await c.relay.pair();
    const stranger = await generateKeyPair();
    const { setupCode } = await import('@conch/relay/envelope');
    const own = parseSetupCode((await c.relay.view()).setup?.code ?? '');
    await c.deploy(setupCode({ publicKey: stranger.publicKey, tokenHash: own.tokenHash }));
    await expect(c.relay.connect(RELAY)).rejects.toThrow(/another key/);
  });

  it('drains what came while it was off through the same handler, which re-checks the signature', async () => {
    const c = await make();
    await c.deploy();
    await c.relay.connect(RELAY);
    // Conch is off: three things arrive over a morning. One is forged.
    expect((await c.send('{"order":1}')).status).toBe(200);
    c.clock.set(START + HOUR);
    expect((await c.send('{"order":2}')).status).toBe(200);
    await c.send('{"order":"forged"}', c.clock.now(), {
      ...standard(
        'whsec_' + Buffer.from('not the secret').toString('base64'),
        'msg_x',
        '{}',
        c.clock.now(),
      ),
    });
    // Back on, three hours later: far past the five minutes a signature is fresh for.
    c.clock.set(START + 4 * HOUR);
    expect(await c.relay.pull()).toBe(3);
    expect(c.arrived.map((h) => JSON.parse(h.detail) as unknown)).toEqual([
      { order: 1 },
      { order: 2 },
    ]);
    // Acknowledged once handled: nothing is left, and nothing comes twice.
    expect(await c.relay.pull()).toBe(0);
    const status = await c.deployed()?.fetch(
      new Request(`${RELAY}/relay/v1/status`, {
        headers: { authorization: `Bearer ${await tokenOf(c.home)}` },
      }),
    );
    expect(((await status?.json()) as { depth: number }).depth).toBe(0);
  });

  it('takes a replayed delivery once, whatever new id or time the relay gives it', async () => {
    const c = await make();
    await c.deploy();
    await c.relay.connect(RELAY);
    const headers = standard(c.secret, 'msg_same', '{"pay":10}', START);
    await c.send('{"pay":10}', START, headers);
    await c.relay.pull();
    expect(c.arrived).toHaveLength(1);
    // The same signed message again, an hour later: a new delivery as far as the relay knows.
    c.clock.set(START + 2 * 60_000);
    await c.send('{"pay":10}', START, headers);
    // After a restart: a new service, and the routine's own memory of ids is gone too.
    c.stop();
    c.door.stop();
    const again = await make({ again: c });
    await again.relay.connect(RELAY);
    expect(await again.relay.pull()).toBe(1);
    expect(again.arrived).toHaveLength(0);
    expect(c.arrived).toHaveLength(1);
  });

  it('keeps a delivery for an address that isn’t served yet, and lets it go when that address is gone', async () => {
    const c = await make();
    await c.deploy();
    await c.relay.connect(RELAY);
    await c.send('{"early":true}');
    // The routine hasn't mounted its address yet (channels and routines start after the door).
    c.stop();
    expect(await c.relay.pull()).toBe(1);
    c.clock.set(START + 2 * 60_000);
    // Handed out again once the lease is over: still kept.
    expect(await c.relay.pull()).toBe(1);
    c.clock.set(START + 15 * 60_000);
    expect(await c.relay.pull()).toBe(1);
    // Ten minutes after starting with nothing serving it: let go.
    c.clock.set(START + 17 * 60_000);
    expect(await c.relay.pull()).toBe(0);
  });

  it('refuses what a relay claims arrived more than a week ago', async () => {
    const c = await make();
    await c.deploy();
    await c.relay.connect(RELAY);
    // A relay whose clock says it's eight days ago (or one that lies about when it got it):
    // no amount of keeping explains that, so it's refused here, signed or not.
    c.skew(-8 * 24 * HOUR);
    await c.send('{"old":true}', START - 8 * 24 * HOUR);
    expect(await c.relay.pull()).toBe(1);
    expect(c.arrived).toHaveLength(0);
    // And acknowledged: it doesn't come back.
    c.clock.set(START + 2 * 60_000);
    expect(await c.relay.pull()).toBe(0);
  });

  it('passes the time it reached the relay to handlers that measure freshness', async () => {
    const c = await make();
    await c.deploy();
    await c.relay.connect(RELAY);
    const seen: HookRequest[] = [];
    const extra = 'e'.repeat(43);
    c.door.mount(extra, 'sms', (request) => {
      seen.push(request);
      return Promise.resolve({ status: 200, body: '<Response/>', type: 'text/xml' });
    });
    // The relay was told the new address (by hash) when it was mounted.
    await c.relay.repair();
    const res = await c
      .deployed()
      ?.fetch(new Request(`${RELAY}/hooks/${extra}`, { method: 'POST', body: 'Body=hi' }));
    expect(res?.status).toBe(200);
    c.clock.set(START + 2 * HOUR);
    await c.relay.pull();
    expect(seen[0]).toMatchObject({ method: 'POST', body: 'Body=hi', receivedAt: START });
  });

  it('is in Repair everything: reachable, how much waits, and a key that doesn’t match', async () => {
    const c = await make();
    const check = relayCheck(c.relay);
    const run = (repair = false) => check.run({ repair, signal: AbortSignal.timeout(5_000) });
    expect(await run()).toEqual([]);
    await c.deploy();
    expect((await run())[0]).toMatchObject({ state: 'info', action: { label: 'Finish setup' } });
    await c.relay.connect(RELAY);
    await c.send('{"waiting":1}');
    expect((await run())[0]).toMatchObject({
      state: 'ok',
      message: expect.stringContaining('1 waiting'),
    });
    // Repair brings it in.
    expect((await run(true))[0]?.message).toContain('Nothing waiting');
    expect(c.arrived).toHaveLength(1);
  });

  it('pulls nothing on another computer a backup was restored to', async () => {
    const c = await make();
    await c.deploy();
    await c.relay.connect(RELAY);
    const elsewhere = await make({ again: c, host: 'another-pc' });
    const problem = await elsewhere.relay.probe(RELAY);
    expect(problem).toMatchObject({
      needsYou: true,
      message: expect.stringContaining('another computer'),
    });
  });
});

async function tokenOf(home: string) {
  return (JSON.parse(await readFile(join(home, 'relay.secrets.json'), 'utf8')) as { token: string })
    .token;
}
