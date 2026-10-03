import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EngineId } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { fakeFetch, jsonResponse } from '../engines/api/fake';
import { serverEngine } from '../engines/registry';
import type { Engine } from '../engines/types';
import { SettingsStore } from '../settings/store';
import { ProviderKeys } from './keys';
import { ProviderService } from './service';

const LLAMA = { object: 'list', data: [{ id: 'qwen3-4b', owned_by: 'llamacpp' }] };

async function harness(
  options: { env?: NodeJS.ProcessEnv; answers?: (url: string, auth?: string) => Response } = {},
) {
  const home = await mkdtemp(join(tmpdir(), 'conch-servers-'));
  const settings = new SettingsStore(home);
  const keys = new ProviderKeys(settings);
  const fetch = fakeFetch(
    (call) =>
      options.answers?.(call.url, call.headers.authorization) ??
      (call.url.startsWith('http://localhost:8080') || call.url.startsWith('http://127.0.0.1:8080')
        ? new Response(JSON.stringify(LLAMA), {
            headers: { 'content-type': 'application/json', server: 'llama.cpp' },
          })
        : (() => {
            throw new TypeError('fetch failed');
          })()),
  );
  const engines = new Map<EngineId, Engine>();
  const deps = { settings, keys, home, fetch: fetch.fetch };
  const providers = new ProviderService({
    engines,
    settings,
    keys,
    fetch: fetch.fetch,
    makeServer: (config) => serverEngine(config, deps),
    lookAround: { env: options.env ?? {} },
    emit: () => undefined,
  });
  return { home, settings, keys, engines, providers, fetch };
}

describe('servers you run yourself', () => {
  it('adds a server after looking at it, names it after what it is, and lists it as a provider', async () => {
    const { providers, settings, engines } = await harness();
    const { id, list } = await providers.addServer({ url: 'localhost:8080' });

    expect(id).toMatch(/^server-[a-z0-9]{8}$/);
    const card = list.providers.find((p) => p.id === id);
    expect(card).toMatchObject({
      name: 'llama.cpp',
      tagline: 'llama.cpp · localhost:8080',
      group: 'server',
      brand: 'server',
      local: true,
      ready: true,
      server: { url: 'http://localhost:8080/v1', kind: 'llama.cpp' },
    });
    expect(engines.has(id)).toBe(true);
    expect((await settings.get()).servers).toHaveLength(1);
    // Its models join the picker like any provider's.
    const catalog = await providers.models();
    expect(catalog.providers.find((p) => p.engine === id)?.models.map((m) => m.id)).toEqual([
      'qwen3-4b',
    ]);
  });

  it('refuses an address where nothing answers, and keeps nothing', async () => {
    const { providers, settings } = await harness();
    await expect(providers.addServer({ url: 'localhost:9999' })).rejects.toThrow(
      /Nothing answered/,
    );
    expect((await settings.get()).servers).toEqual([]);
  });

  it('keeps a server’s key like every provider key, and sends it only to that server', async () => {
    const { providers, keys, fetch } = await harness({
      answers: (url, auth) =>
        url.startsWith('http://10.0.0.5:8000')
          ? auth === 'Bearer vllm-secret-key'
            ? jsonResponse({ data: [{ id: 'llama', owned_by: 'vllm' }] })
            : jsonResponse({ error: 'unauthorized' }, 401)
          : (() => {
              throw new TypeError('fetch failed');
            })(),
    });
    await expect(providers.addServer({ url: '10.0.0.5:8000' })).rejects.toThrow(
      'This server asks for a key.',
    );
    const { id, list } = await providers.addServer({
      url: '10.0.0.5:8000',
      name: 'The GPU box',
      key: 'vllm-secret-key',
    });
    expect(list.providers.find((p) => p.id === id)).toMatchObject({
      name: 'The GPU box',
      ready: true,
      local: false,
    });
    expect(await keys.value(id)).toBe('vllm-secret-key');
    expect(
      fetch.calls
        .filter((c) => c.headers.authorization)
        .every((c) => c.url.startsWith('http://10.0.0.5:8000/')),
    ).toBe(true);
  });

  it('gives two servers with the same name different names', async () => {
    const { providers } = await harness();
    const first = await providers.addServer({ url: 'localhost:8080', name: 'Home' });
    const second = await providers.addServer({ url: '127.0.0.1:8080', name: 'Home' });
    const names = second.list.providers.filter((p) => p.group === 'server').map((p) => p.name);
    expect(names).toEqual(['Home', 'Home 2']);
    expect(first.id).not.toBe(second.id);
  });

  it('renames a server, and takes one away with its key', async () => {
    const { providers, keys, engines, settings } = await harness();
    const { id } = await providers.addServer({ url: 'localhost:8080', key: 'optional-key-1234' });
    const renamed = await providers.updateServer(id, { name: 'Kitchen laptop' });
    expect(renamed.providers.find((p) => p.id === id)?.name).toBe('Kitchen laptop');

    const after = await providers.removeServer(id);
    expect(after.providers.some((p) => p.id === id)).toBe(false);
    expect(engines.has(id)).toBe(false);
    expect(await keys.has(id)).toBe(false);
    expect((await settings.get()).servers).toEqual([]);
  });

  it('builds the servers saved before, at start-up', async () => {
    const { providers, settings, home } = await harness();
    const { id } = await providers.addServer({ url: 'localhost:8080' });
    const again = await harness();
    // A new service on the same settings finds the server again.
    const fresh = new ProviderService({
      engines: new Map(),
      settings,
      keys: new ProviderKeys(settings),
      fetch: again.fetch.fetch,
      makeServer: (config) =>
        serverEngine(config, {
          settings,
          keys: new ProviderKeys(settings),
          home,
          fetch: again.fetch.fetch,
        }),
      emit: () => undefined,
    });
    await fresh.loadServers();
    expect((await fresh.list()).providers.some((p) => p.id === id)).toBe(true);
  });
});

describe('what Conch finds on this computer', () => {
  it('offers a running server and a key in the environment, and uses each with one press', async () => {
    const { providers } = await harness({ env: { GROQ_API_KEY: 'gsk_0123456789abcdefghij' } });
    const list = await providers.list();
    expect(list.found).toEqual([
      expect.objectContaining({
        kind: 'key',
        provider: 'groq',
        detail: 'GROQ_API_KEY · ends ghij',
      }),
      expect.objectContaining({
        kind: 'server',
        name: 'llama.cpp',
        url: 'http://127.0.0.1:8080/v1',
      }),
    ]);
    // The key itself never travels to the page.
    expect(JSON.stringify(list)).not.toContain('gsk_0123456789abcdefghij');

    const server = list.found.find((f) => f.kind === 'server');
    const after = await providers.useFound(server?.id ?? '');
    expect(after.providers.filter((p) => p.group === 'server').map((p) => p.name)).toEqual([
      'llama.cpp',
    ]);
    // Added servers aren't offered again.
    expect(after.found.some((f) => f.kind === 'server')).toBe(false);
  });

  it('looks at nothing when it isn’t asked to', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-servers-'));
    const settings = new SettingsStore(home);
    const fetch = fakeFetch(() => {
      throw new Error('should not be called');
    });
    const quiet = new ProviderService({
      engines: new Map(),
      settings,
      keys: new ProviderKeys(settings),
      fetch: fetch.fetch,
      emit: () => undefined,
    });
    expect((await quiet.list()).found).toEqual([]);
    expect(fetch.calls).toHaveLength(0);
  });
});
