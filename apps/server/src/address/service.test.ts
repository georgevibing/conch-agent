import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AcmeClient } from './acme';
import { AddressProblemError } from './problems';
import type { ReachResult } from './reach';
import { AddressService, type AddressServiceDeps, type ListenersLike } from './service';
import { AddressError, AddressStore } from './store';
import { fakeAcme, leafFor } from './testing';

const NAME = 'conch.example.com';
const DAY = 86_400_000;

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'conch-address-service-'));
});
afterEach(async () => {
  // status.json may still be being written by a test that didn’t stop its service.
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function fakeListeners(fail?: { http?: AddressProblemError; https?: AddressProblemError }) {
  const listeners = {
    startHttp: vi.fn(async () => {
      if (fail?.http) throw fail.http;
    }),
    startHttps: vi.fn(async () => {
      if (fail?.https) throw fail.https;
    }),
    updateCertificate: vi.fn(),
    stop: vi.fn(async () => undefined),
    listening: { http: true, https: true },
  };
  return listeners as typeof listeners & ListenersLike;
}

async function setup(
  options: {
    reach?: ReachResult;
    listeners?: ReturnType<typeof fakeListeners>;
    acme?: Partial<Parameters<typeof fakeAcme>[0]>;
    now?: () => number;
    deps?: Partial<AddressServiceDeps>;
  } = {},
) {
  const box: { service?: AddressService } = {};
  const acme = await fakeAcme({
    answer: async (token) => box.service?.challenges.get(token),
    ...options.acme,
  });
  const listeners = options.listeners ?? fakeListeners();
  const scheduled: number[] = [];
  const heal = vi.fn();
  const reach = vi.fn(async () => options.reach ?? ({ ok: true } as const));
  const service = new AddressService({
    home,
    config: { CONCH_HTTPS_PORT: 443, CONCH_HTTP_PORT: 80, CONCH_ACME_DIRECTORY: acme.directoryUrl },
    gateway: () => ({}) as Server,
    acme: (accountKey) =>
      new AcmeClient({
        directoryUrl: acme.directoryUrl,
        accountKey,
        fetch: acme.fetch,
        sleep: async () => undefined,
      }),
    listeners: () => listeners,
    reach,
    privilege: async () =>
      'sudo setcap cap_net_bind_service=+ep /home/me/.conch/runtime/node/bin/node',
    schedule: (ms) => {
      scheduled.push(ms);
      return () => undefined;
    },
    heal,
    ...(options.now && { now: options.now }),
    ...options.deps,
  });
  box.service = service;
  return { service, acme, listeners, scheduled, heal, reach, store: new AddressStore(home) };
}

describe('AddressService', () => {
  it('checks the way in, gets a certificate and answers at https://<name>', async () => {
    const { service, acme, listeners, scheduled, store } = await setup();
    const seen: string[] = [];
    service.onChange((s) => seen.push(s.state));
    const status = await service.set('https://Conch.Example.com/');
    expect(status).toMatchObject({
      state: 'ready',
      name: NAME,
      url: `https://${NAME}`,
      certificate: { issuer: 'Pretend Encrypt' },
    });
    expect(status.certificate?.notAfter).toBeGreaterThan(Date.now() + 80 * DAY);
    // "checking" at once (whoever asked sees it start), then as each step begins.
    expect(seen).toEqual([
      'checking',
      'checking',
      'checking',
      'getting-certificate',
      'ready',
      'ready',
    ]);
    expect(listeners.startHttp).toHaveBeenCalled();
    expect(listeners.startHttps).toHaveBeenCalledTimes(1);
    expect(acme.orders()).toBe(1);
    expect(await store.certificate()).toBeDefined();
    expect((await store.read()).setOn).toBe(await store.machine());
    expect(service.name()).toBe(NAME);
    // It looks again within half a day, for the authority's advice.
    expect(scheduled.at(-1)).toBeLessThanOrEqual(12 * 60 * 60 * 1000);
    // Challenges don't outlive the order.
    expect(service.challenges.size).toBe(0);
  });

  it('refuses a name that isn’t one, before anything is written', async () => {
    const { service, store } = await setup();
    await expect(service.set('203.0.113.4')).rejects.toThrow(AddressError);
    expect((await store.read()).name).toBeUndefined();
  });

  it('never asks Let’s Encrypt when the name leads elsewhere, and looks again soon', async () => {
    const { service, acme, scheduled, store } = await setup({
      reach: {
        ok: false,
        why: 'refused',
        problem: {
          kind: 'unreachable',
          message: 'conch.example.com refused the connection on port 80.',
        },
      },
    });
    const status = await service.set(NAME);
    expect(status).toMatchObject({ state: 'problem', problem: { kind: 'unreachable' } });
    expect(acme.orders()).toBe(0);
    expect(scheduled.at(-1)).toBe(5 * 60_000);
    expect((await store.state()).failures).toBe(1);
  });

  it('still asks Let’s Encrypt when only this server couldn’t reach itself', async () => {
    const { service, acme } = await setup({
      reach: {
        ok: false,
        why: 'timeout',
        problem: { kind: 'unreachable', message: 'Nothing answered.' },
      },
    });
    expect((await service.set(NAME)).state).toBe('ready');
    expect(acme.orders()).toBe(1);
  });

  it('backs off for an hour when Let’s Encrypt couldn’t reach port 80', async () => {
    const ctx = await setup({ acme: { answer: async () => undefined } });
    const service = ctx.service;
    const status = await service.set(NAME);
    expect(status).toMatchObject({ state: 'problem', problem: { kind: 'unreachable' } });
    expect(ctx.scheduled.at(-1)).toBe(60 * 60_000);
    // A restart doesn't try again before then.
    const again = await service.start();
    expect(again.state).toBe('problem');
    expect(ctx.acme.orders()).toBe(1);
  });

  it('waits as long as a rate limit says', async () => {
    const { service, scheduled } = await setup({
      acme: {
        orderProblem: { status: 429, type: 'rateLimited', detail: 'no', retryAfter: '7200' },
      },
    });
    const status = await service.set(NAME);
    expect(status.problem?.kind).toBe('rate-limited');
    expect(scheduled.at(-1)).toBeGreaterThan(7_000_000);
    // Repair everything doesn't push past it either.
    expect((await service.renew()).problem?.kind).toBe('rate-limited');
  });

  it('gives the one command when Conch may not answer on port 80', async () => {
    const listeners = fakeListeners({
      http: new AddressProblemError({
        kind: 'ports-privilege',
        message: 'Conch isn’t allowed to answer on port 80 yet.',
      }),
    });
    const { service } = await setup({ listeners });
    expect(await service.set(NAME)).toMatchObject({
      state: 'problem',
      problem: { kind: 'ports-privilege', command: expect.stringMatching(/^sudo setcap/) },
    });
  });

  it('serves the certificate it has on start, without asking for another', async () => {
    const { service, acme, listeners, store } = await setup();
    await store.write({ version: 1, name: NAME, setOn: await store.machine() });
    await store.saveCertificate(await leafFor(NAME, { ca: acme.ca }));
    const status = await service.start();
    expect(status).toMatchObject({ state: 'ready', certificate: { renewsAt: expect.any(Number) } });
    expect(listeners.startHttps).toHaveBeenCalledTimes(1);
    expect(acme.orders()).toBe(0);
  });

  it('renews when a third of the lifetime is left, replacing the old one', async () => {
    const { service, acme, store, heal } = await setup();
    await store.write({ version: 1, name: NAME, setOn: await store.machine() });
    await store.saveCertificate(
      await leafFor(NAME, {
        ca: acme.ca,
        notBefore: new Date(Date.now() - 80 * DAY),
        notAfter: new Date(Date.now() + 10 * DAY),
      }),
    );
    const status = await service.start();
    expect(status.state).toBe('ready');
    expect(status.certificate?.notAfter).toBeGreaterThan(Date.now() + 80 * DAY);
    expect(acme.orders()).toBe(1);
    expect(acme.state.replaces).toBeUndefined(); // the pretend CA offers no renewal info
    expect(heal).toHaveBeenCalledWith('gateway', `Conch renewed the certificate for ${NAME}.`);
  });

  it('keeps serving the old certificate while renewing fails', async () => {
    const { service, acme, store } = await setup({ acme: { answer: async () => undefined } });
    await store.write({ version: 1, name: NAME, setOn: await store.machine() });
    await store.saveCertificate(
      await leafFor(NAME, {
        ca: acme.ca,
        notBefore: new Date(Date.now() - 80 * DAY),
        notAfter: new Date(Date.now() + 10 * DAY),
      }),
    );
    const status = await service.start();
    expect(status).toMatchObject({ state: 'ready', problem: { kind: 'unreachable' } });
    expect(status.certificate?.notAfter).toBeLessThan(Date.now() + 11 * DAY);
  });

  it('opens nothing for an address set up on another computer, until it’s turned on here', async () => {
    const { service, listeners, store } = await setup();
    await store.write({ version: 1, name: NAME, setOn: 'f'.repeat(32) });
    const status = await service.start();
    expect(status).toMatchObject({ state: 'problem', problem: { kind: 'another-computer' } });
    expect(service.name()).toBeUndefined();
    expect(listeners.startHttp).not.toHaveBeenCalled();
    expect((await service.turnOnHere()).state).toBe('ready');
    expect((await store.read()).setOn).toBe(await store.machine());
  });

  it('forgets the address, its certificate and its listeners', async () => {
    const { service, listeners, store } = await setup();
    await service.set(NAME);
    expect(await service.remove()).toEqual({ state: 'off' });
    expect(listeners.stop).toHaveBeenCalled();
    expect(await store.certificate()).toBeUndefined();
    expect((await store.read()).name).toBeUndefined();
  });

  it('says where a name points, and what to add', async () => {
    const { service } = await setup({
      deps: {
        mine: async () => ({ v4: '95.217.10.20' }),
        lookup: async () => ({ v4: [], v6: [] }),
      },
    });
    expect(await service.dns('conch.example.com')).toMatchObject({
      pointing: 'missing',
      advice: [{ type: 'A', host: 'conch', value: '95.217.10.20' }],
    });
  });

  it('runs one change at a time', async () => {
    const { service, acme } = await setup();
    const [a, b] = await Promise.all([service.set(NAME), service.set(NAME)]);
    expect(a.state).toBe('ready');
    expect(b.state).toBe('ready');
    // The second found the certificate the first got.
    expect(acme.orders()).toBe(1);
  });
});

describe('what review found (ADR 0064)', () => {
  it('says “checking” at once, before anything is read or written', async () => {
    const { service } = await setup();
    const pending = service.set(NAME);
    expect(service.status()).toMatchObject({ state: 'checking', name: NAME });
    await pending;
  });

  it('turns a dropped connection into a problem to retry, never a crash', async () => {
    const tasks: (() => void)[] = [];
    const { service } = await setup({
      deps: {
        acme: () => ({
          issue: async () => {
            throw new TypeError('terminated');
          },
          renewalWindow: async () => undefined,
        }),
        schedule: (_ms, fn) => {
          tasks.push(fn);
          return () => undefined;
        },
      },
    });
    const status = await service.set(NAME);
    expect(status).toMatchObject({ state: 'problem', problem: { kind: 'ca-unavailable' } });
    expect(status.problem?.message).toContain('terminated');
    // The retry it scheduled runs into the same, and still doesn't throw.
    tasks.at(-1)?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.status().state).toBe('problem');
  });

  it('keeps an unexpected error out of the gateway, and keeps trying', async () => {
    const { service } = await setup({
      listeners: Object.assign(fakeListeners(), {
        startHttp: vi.fn(async () => {
          throw new Error('disk full');
        }),
      }),
    });
    const status = await service.set(NAME);
    expect(status).toMatchObject({ state: 'problem', problem: { kind: 'other' } });
    expect(status.problem?.message).toContain('disk full');
  });

  it('never brings back an address that was turned off meanwhile', async () => {
    const tasks: (() => void)[] = [];
    const { service, acme, store } = await setup({
      reach: {
        ok: false,
        why: 'refused',
        problem: { kind: 'unreachable', message: 'Port 80 is shut.' },
      },
      deps: {
        schedule: (_ms, fn) => {
          tasks.push(fn);
          return () => undefined;
        },
      },
    });
    await service.set(NAME);
    await service.remove();
    for (const task of tasks) task();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.status().state).toBe('off');
    expect((await store.read()).name).toBeUndefined();
    expect(acme.orders()).toBe(0);
  });
});

describe('conch setup and conch address, through the files (ADR 0063, 0064)', () => {
  const until = async (check: () => Promise<boolean> | boolean) => {
    for (let i = 0; i < 200 && !(await check()); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
  };

  it('takes up an address the CLI wrote, and says so in status.json', async () => {
    const { service, store } = await setup();
    await service.start();
    service.watch(10);
    const since = Date.now();
    // The CLI: another process, writing the same file.
    const cli = new AddressStore(home);
    await cli.write({ version: 1, name: NAME, since, setOn: await cli.machine() });
    await until(async () => {
      const said = await cli.status();
      return said?.since === since && (said.status as { state?: string }).state === 'ready';
    });
    expect(service.status()).toMatchObject({ state: 'ready', name: NAME });
    const said = await cli.status();
    expect(said).toMatchObject({ since, status: { state: 'ready', name: NAME } });
    expect(await store.certificate()).toBeDefined();
    await service.stop();
  });

  it('turns off when the CLI empties the file, and renews when it asks', async () => {
    const { service, acme, store } = await setup();
    await service.set(NAME);
    service.watch(10);
    const cli = new AddressStore(home);
    const at = Date.now();
    await cli.write({ ...(await cli.read()), ask: { action: 'renew', at } });
    await until(() => acme.orders() === 2);
    expect(acme.orders()).toBe(2);
    await until(async () => (await cli.status())?.ask === at);
    await cli.write({ version: 1 });
    await until(() => service.status().state === 'off');
    expect(service.status().state).toBe('off');
    expect(await store.certificate()).toBeUndefined();
    await service.stop();
  });

  it('never acts again on a change it made itself', async () => {
    const { service, acme } = await setup();
    await service.set(NAME);
    service.watch(10);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(acme.orders()).toBe(1);
    await service.stop();
  });
});
