import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { dataFrames, fakeFetch, jsonResponse, sseResponse } from './fake';
import { lmStudioHome, lmStudioPort, lmStudioVariant } from './lmstudio';
import type { WireEvent } from './types';

async function lmHome(options: { port?: number; installed?: boolean } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'conch-lms-'));
  await mkdir(join(home, '.internal'), { recursive: true });
  if (options.port)
    await writeFile(
      join(home, '.internal', 'http-server-config.json'),
      JSON.stringify({ port: options.port }),
    );
  if (options.installed) {
    const app = join(home, 'LM Studio.exe');
    await writeFile(app, '');
    await writeFile(
      join(home, '.internal', 'app-install-location.json'),
      JSON.stringify({ path: app, argv: [], cwd: home }),
    );
  }
  return home;
}

const MODELS = {
  models: [
    {
      type: 'llm',
      key: 'google/gemma-4-26b-a4b',
      display_name: 'Gemma 4 26B A4B',
      max_context_length: 262144,
      loaded_instances: [{ id: 'google/gemma-4-26b-a4b', config: { context_length: 8192 } }],
      capabilities: {
        vision: true,
        trained_for_tool_use: true,
        reasoning: { allowed_options: ['off', 'on'] },
      },
    },
    {
      type: 'llm',
      key: 'qwen/qwen3-8b',
      display_name: 'Qwen3 8B',
      max_context_length: 32768,
      loaded_instances: [],
    },
    { type: 'embedding', key: 'nomic-embed', display_name: 'Nomic Embed', loaded_instances: [] },
  ],
};

function server(port: number, options: { auth?: boolean } = {}) {
  return fakeFetch((call) => {
    const url = new URL(call.url);
    if (url.port !== String(port)) throw new TypeError('fetch failed');
    if (url.pathname === '/lmstudio-greeting') return jsonResponse({ lmstudio: true });
    if (options.auth && call.headers.authorization !== 'Bearer sk-lm-abcdefgh:01234567890123456789')
      return jsonResponse({ error: 'unauthorized' }, 401);
    if (url.pathname === '/api/v1/models') return jsonResponse(MODELS);
    if (url.pathname === '/v1/models') return jsonResponse({ data: [] });
    if (url.pathname === '/v1/chat/completions')
      return sseResponse(
        dataFrames(
          JSON.stringify({
            choices: [{ delta: { content: 'Hello from LM Studio' }, finish_reason: 'stop' }],
          }),
          '[DONE]',
        ),
      );
    return new Response('', { status: 404 });
  });
}

describe('finding LM Studio', () => {
  it('follows the home pointer, and reads the port its server last used', async () => {
    const user = await mkdtemp(join(tmpdir(), 'conch-user-'));
    const elsewhere = await lmHome({ port: 4321 });
    await writeFile(join(user, '.lmstudio-home-pointer'), `${elsewhere}\n`);
    expect(await lmStudioHome(user)).toBe(elsewhere);
    expect(await lmStudioPort(elsewhere)).toBe(4321);
    expect(await lmStudioPort(await lmHome())).toBe(1234);
  });
});

describe('LM Studio as a provider', () => {
  it('is ready with the models it has, on the port it uses, and leaves out embeddings', async () => {
    const lmHomeDir = await lmHome({ port: 4321, installed: true });
    const fetch = server(4321);
    const variant = lmStudioVariant({ fetch: fetch.fetch, lmHome: lmHomeDir });
    const status = await variant.status?.();
    expect(status).toMatchObject({
      state: 'ready',
      auth: { description: 'Gemma 4 26B A4B and 1 more · works offline' },
    });
    const models = await variant.wire.models({});
    expect(models.map((m) => [m.info.id, m.info.label, m.tools, m.info.images])).toEqual([
      ['google/gemma-4-26b-a4b', 'Gemma 4 26B A4B', true, true],
      ['qwen/qwen3-8b', 'Qwen3 8B', true, false],
    ]);
    // A loaded model reads what it was loaded with, not what it could (ADR 0055).
    expect(models.map((m) => m.info.context)).toEqual([8192, 32768]);
    expect(variant.local).toBe(true);
    expect(fetch.calls.every((c) => c.url.startsWith('http://127.0.0.1:4321/'))).toBe(true);
  });

  it('says a model is loading before a cold one answers', async () => {
    const fetch = server(1234);
    const variant = lmStudioVariant({
      fetch: fetch.fetch,
      lmHome: await lmHome({ installed: true }),
    });
    await variant.status?.();
    const events: WireEvent[] = [];
    for await (const event of variant.wire.stream({
      key: '',
      model: 'qwen/qwen3-8b',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      effort: 'auto',
      signal: new AbortController().signal,
    }))
      events.push(event);
    expect(events[0]).toMatchObject({
      type: 'notice',
      code: 'loading',
      message: expect.stringContaining('Qwen3 8B'),
    });
    expect(events.at(-1)).toMatchObject({
      type: 'end',
      message: { content: 'Hello from LM Studio' },
    });
  });

  it('starts LM Studio’s server itself when it’s off, and says so quietly', async () => {
    let started = false;
    const fetch = fakeFetch((call) => {
      if (!started) throw new TypeError('fetch failed');
      return server(1234).fetch(call.url, { method: call.method, headers: call.headers });
    });
    const healed: string[] = [];
    const variant = lmStudioVariant({
      fetch: fetch.fetch,
      lmHome: await lmHome({ installed: true }),
      startServer: async () => {
        started = true;
        return true;
      },
      heal: (message) => healed.push(message),
    });
    expect(await variant.status?.()).toMatchObject({ state: 'ready' });
    expect(healed).toEqual(['Started LM Studio’s server']);
  });

  it('says where to turn the server on when it can’t start it', async () => {
    const fetch = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    const variant = lmStudioVariant({
      fetch: fetch.fetch,
      lmHome: await lmHome({ installed: true }),
      startServer: async () => false,
    });
    expect(await variant.status?.()).toMatchObject({
      state: 'error',
      message: expect.stringContaining('Developer tab'),
    });
  });

  it('offers to install LM Studio when it isn’t here', async () => {
    const fetch = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    const variant = lmStudioVariant({
      fetch: fetch.fetch,
      lmHome: await lmHome(),
      startServer: async () => false,
    });
    expect(await variant.status?.()).toMatchObject({
      state: 'not-installed',
      fix: { need: 'lm-studio', kind: 'install' },
    });
  });

  it('asks for a key when LM Studio requires one, and uses it once given', async () => {
    const fetch = server(1234, { auth: true });
    const variant = lmStudioVariant({
      fetch: fetch.fetch,
      lmHome: await lmHome({ installed: true }),
    });
    expect(await variant.status?.()).toMatchObject({
      state: 'signed-out',
      message: expect.stringContaining('Manage Tokens'),
    });
    expect(await variant.status?.('sk-lm-abcdefgh:01234567890123456789')).toMatchObject({
      state: 'ready',
    });
  });
});
