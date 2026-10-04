import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FunnelStatus } from '../network/tailscale';
import { funnelOf } from '../network/tailscale';
import { ChannelDoorService, DOOR_PATH, doorCheck, ownAddress, pickPort } from './door';

let door: ChannelDoorService | undefined;
afterEach(() => {
  door?.stop();
  door = undefined;
});

/** A pretend Tailscale whose Funnel can be on, off, or forgotten. */
function tailscale(name = 'mac.tail1.ts.net', busy: number[] = []) {
  const state = { on: undefined as number | undefined, opened: 0, name };
  return {
    state,
    funnelStatus: async (): Promise<FunnelStatus> => ({
      state: state.on ? 'on' : 'off',
      name: state.name,
      ...(state.on && { port: state.on }),
      busy,
    }),
    funnel: async (port: number): Promise<FunnelStatus> => {
      state.on = port;
      state.opened++;
      return { state: 'on', name: state.name, port, busy };
    },
    unfunnel: async () => {
      state.on = undefined;
    },
  };
}

async function make(ts = tailscale(), home?: string) {
  const dir = home ?? (await mkdtemp(join(tmpdir(), 'conch-door-')));
  // The internet, here, is this computer: the public address reaches the door.
  const service: ChannelDoorService = new ChannelDoorService({
    home: dir,
    port: 0,
    tailscale: ts,
    fetch: (url, init) => fetch(service.localFor(String(url)), init),
  });
  door = service;
  return { door: service, ts, home: dir };
}

describe('the public door', () => {
  it('serves only the addresses mounted on it, and nothing of Conch', async () => {
    const { door } = await make();
    const off = door.mount('abcdefghijklmnopqrstuvwx', 'microsoftteams', async (r) => ({
      status: 200,
      body: `${r.method} ${r.body}`,
    }));
    await door.useTailscale();
    const local = door.local ?? '';
    const post = (path: string) => fetch(`${local}${path}`, { method: 'POST', body: 'hi' });
    expect(await (await post('/hooks/abcdefghijklmnopqrstuvwx')).text()).toBe('POST hi');
    // Tailscale may pass the mount path on, or not.
    expect((await post(`${DOOR_PATH}/hooks/abcdefghijklmnopqrstuvwx`)).status).toBe(200);
    for (const path of [
      '/hooks/somebodyelse0000000000',
      '/api/health',
      '/',
      '/api/channels',
      '/hooks/',
    ])
      expect((await fetch(`${local}${path}`)).status, path).toBe(404);
    off();
    expect((await post('/hooks/abcdefghijklmnopqrstuvwx')).status).toBe(404);
  });

  it('turns on with Tailscale on 443, or 8443 when the phone’s private address has 443', async () => {
    expect(pickPort([])).toBe(443);
    expect(pickPort([443])).toBe(8443);
    expect(pickPort([443, 8443, 10000])).toBeUndefined();
    const { door } = await make(tailscale('mac.tail1.ts.net', [443]));
    const on = await door.useTailscale();
    expect(on).toMatchObject({
      state: 'ready',
      via: 'tailscale',
      url: 'https://mac.tail1.ts.net:8443/conch',
    });
    // Checked from the outside, with a proof only this door can make.
    expect(on.checkedAt).toBeDefined();
    expect(door.hookUrl('abc')).toBe('https://mac.tail1.ts.net:8443/conch/hooks/abc');
  });

  it('uses Conch’s own address in one press, and stops offering it once it does (ADR 0064)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conch-door-'));
    // Conch’s own address, as Services would say it: none yet, then ready.
    const conch: { address?: string } = {};
    const service: ChannelDoorService = new ChannelDoorService({
      home: dir,
      port: 0,
      tailscale: tailscale(),
      // Conch's own listener sends https://<name>/conch/… to the door, prefix and all.
      fetch: (url, init) => fetch(service.localFor(String(url)), init),
      conchAddress: () => conch.address,
    });
    door = service;
    expect(service.status().address).toBeUndefined();
    await expect(service.useConchAddress()).rejects.toThrow('doesn’t answer');
    const told = vi.fn();
    service.onChange(told);
    conch.address = 'https://conch.example.com';
    service.addressChanged();
    expect(told).toHaveBeenLastCalledWith(
      expect.objectContaining({ address: 'https://conch.example.com' }),
    );
    const on = await service.useConchAddress();
    expect(on).toMatchObject({
      state: 'ready',
      via: 'own',
      url: 'https://conch.example.com/conch',
    });
    expect(on.address).toBeUndefined();
    expect(service.hookUrl('abc')).toBe('https://conch.example.com/conch/hooks/abc');
  });

  it('won’t claim an address that leads somewhere else', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conch-door-'));
    const service = new ChannelDoorService({
      home: dir,
      port: 0,
      tailscale: tailscale(),
      // Some other server answers at that address.
      fetch: async () => new Response('conch-door-looking-text'),
    });
    door = service;
    const own = await service.useOwn('conch.example.org');
    expect(own).toMatchObject({ state: 'error', via: 'own', url: 'https://conch.example.org' });
    expect(own.message).toMatch(/doesn’t reach Conch/);
  });

  it('puts a Funnel Tailscale forgot back, but only on the computer it was turned on for', async () => {
    const { door, ts, home } = await make();
    await door.useTailscale();
    ts.state.on = undefined;
    expect((await door.check()).state).toBe('ready');
    expect(ts.state.opened).toBe(2);
    door.stop();
    // The same door.json, restored on another computer.
    const elsewhere = tailscale('other.tail9.ts.net');
    const { door: restored } = await make(elsewhere, home);
    const now = await restored.check();
    expect(now.state).toBe('needs-you');
    expect(now.problem?.message).toMatch(/another computer/);
    expect(elsewhere.state.opened).toBe(0);
  });

  it('accepts only a plain HTTPS address of your own', () => {
    expect(ownAddress('conch.example.org/')).toBe('https://conch.example.org');
    for (const bad of [
      'http://conch.example.org',
      'https://a:b@x.org',
      'https://x.org/?a=1',
      'https://x.org/#k',
    ])
      expect(() => ownAddress(bad), bad).toThrow();
  });

  it('is in Repair everything once something uses it', async () => {
    const { door } = await make();
    const check = doorCheck(door);
    const signal = new AbortController().signal;
    expect(await check.run({ repair: false, signal })).toEqual([]);
    door.mount('abcdefghijklmnopqrstuvwx', 'wechat', async () => ({ status: 200 }));
    expect((await check.run({ repair: false, signal }))[0]).toMatchObject({
      state: 'needs-you',
      action: { kind: 'open', place: 'channels' },
    });
    await door.useTailscale();
    expect((await check.run({ repair: true, signal }))[0]).toMatchObject({ state: 'ok' });
  });

  it('reads which port Funnel has the door on, and which are taken', () => {
    const json = JSON.stringify({
      Web: {
        'mac.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:4317' } } },
        'mac.ts.net:8443': { Handlers: { '/conch': { Proxy: 'http://127.0.0.1:4319' } } },
      },
      AllowFunnel: { 'mac.ts.net:8443': true },
    });
    expect(funnelOf(json, '/conch', 'http://127.0.0.1:4319')).toEqual({ port: 8443, busy: [443] });
    // Not public: it isn't the door's address.
    expect(
      funnelOf(
        json.replace('"AllowFunnel":{"mac.ts.net:8443":true}', '"AllowFunnel":{}'),
        '/conch',
        'http://127.0.0.1:4319',
      ).port,
    ).toBeUndefined();
  });
});
