/**
 * A provider's and a chat app's code (ADR 0119), run for real in the sealed
 * runtime's child process: what they're handed is only what's theirs (the
 * keys typed for them, this call only), their answers stream only while a
 * provider answers, they reach only the hosts on their card, and a chat
 * app's code has nothing it could read a chat or call a tool with.
 */
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConchAppManifest } from '@conch/protocol';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createRuntime, type SealedRuntime } from '../conchapps/runtime';
import type { AppFetcher, AppFetchRequest } from '../conchapps/types';
import { createFetcher } from '../conchapps/fetcher';
import type { PartEvent } from '../conchapps/runtime';

const running: SealedRuntime[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((r) => r.stop()));
});

let root = '';
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'conch parts ')));
});

let count = 0;
async function app(code: string, extra: Record<string, unknown> = {}) {
  const base = join(root, `app ${++count}`);
  const appDir = join(base, 'files');
  const dataDir = join(base, 'data');
  await mkdir(appDir, { recursive: true });
  await writeFile(join(appDir, 'part.mjs'), code);
  const asked: AppFetchRequest[] = [];
  const fetcher: AppFetcher = async (_app, request) => {
    asked.push(request);
    return {
      ok: true,
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"id":"bot","name":"Bot"}',
    };
  };
  const runtime = createRuntime({
    appDir,
    dataDir,
    manifest: ConchAppManifest.parse({
      conch: 1,
      id: 'example',
      name: 'Example',
      tagline: 'An example',
      version: '1.0.0',
      icon: { glyph: 'zap', color: 'blue' },
      tools: 'part.mjs',
      reaches: ['chat.example.com'],
      ...extra,
    }),
    // The app's own settings: a chat app's code never gets them as its keys.
    settings: async () => ({ other: 'settings-' + 'secret-0001' }),
    fetcher,
  });
  running.push(runtime);
  return { runtime, asked };
}

describe('a provider’s code, sealed', () => {
  it('streams its answer, and returns how it ended', async () => {
    const { runtime } = await app(`export const provider = {
      async chat({ model, messages }, app) {
        app.emit({ type: 'thinking', delta: 'Hmm.' });
        for (const word of ['Hello', ' from', ' ' + model]) app.emit({ type: 'text', delta: word });
        return { usage: { input: messages.length, output: 3 } };
      },
    };`);
    expect(await runtime.parts()).toEqual(['provider.chat']);
    const events: PartEvent[] = [];
    const outcome = await runtime.callPart(
      'provider.chat',
      { model: 'm1', messages: [{ role: 'user', content: 'hi' }] },
      { keys: { key: 'k' }, onEvent: (event) => events.push(event) },
    );
    expect(outcome).toMatchObject({ ok: true, json: { usage: { input: 1, output: 3 } } });
    expect(events).toEqual([
      { type: 'thinking', delta: 'Hmm.' },
      { type: 'text', delta: 'Hello' },
      { type: 'text', delta: ' from' },
      { type: 'text', delta: ' m1' },
    ]);
  });

  it('gets the key typed for it, this call only, and nothing else of anyone’s', async () => {
    const { runtime } = await app(`export const provider = {
      async chat(_input, app) {
        return {
          keys: { ...app.keys },
          settings: { ...app.settings },
          env: { ...process.env },
          own: Object.keys(app).sort(),
        };
      },
      async models(app) {
        return { keys: { ...app.keys }, emit: typeof app.emit };
      },
    };`);
    const chat = await runtime.callPart('provider.chat', {}, { keys: { key: 'mine' } });
    expect(chat.json).toMatchObject({
      keys: { key: 'mine' },
      env: {},
      own: ['data', 'emit', 'fetch', 'keys', 'log', 'now', 'settings'],
    });
    // A second call with no key carries none from the first.
    const models = await runtime.callPart('provider.models', {}, { keys: {} });
    expect(models.json).toEqual({ keys: {}, emit: 'undefined' });
  });

  it('can’t stream outside an answer, or say something the gateway doesn’t take', async () => {
    const { runtime } = await app(`let later;
    export const provider = {
      async chat(_input, app) {
        later = app.emit;
        app.emit({ type: 'tool', delta: 'x' });
      },
      async models() {
        later?.({ type: 'text', delta: 'sneaky' });
        return [];
      },
    };`);
    const events: PartEvent[] = [];
    const chat = await runtime.callPart(
      'provider.chat',
      {},
      { keys: {}, onEvent: (e) => events.push(e) },
    );
    expect(chat).toMatchObject({ ok: false, text: expect.stringMatching(/app\.emit takes/) });
    // Kept and called later, its emit reaches no answer of anyone's.
    await runtime.callPart('provider.models', {}, { keys: {} });
    expect(events).toEqual([]);
  });

  it('reaches only through app.fetch, to the hosts on its card', async () => {
    const real = createFetcher({ gatewayPort: 1 });
    const base = join(root, `app ${++count}`);
    await mkdir(join(base, 'files'), { recursive: true });
    await writeFile(
      join(base, 'files', 'part.mjs'),
      `export const provider = {
        async chat(_input, app) {
          const tries = {};
          try { await fetch('https://evil.example.net'); } catch (e) { tries.global = e.message; }
          try { await app.fetch('https://evil.example.net/x'); } catch (e) { tries.other = e.message; }
          try { await app.fetch('http://chat.example.com/x'); } catch (e) { tries.plain = e.message; }
          return tries;
        },
      };`,
    );
    const runtime = createRuntime({
      appDir: join(base, 'files'),
      dataDir: join(base, 'data'),
      manifest: ConchAppManifest.parse({
        conch: 1,
        id: 'example',
        name: 'Example',
        tagline: 'An example',
        version: '1.0.0',
        icon: { glyph: 'zap', color: 'blue' },
        tools: 'part.mjs',
        reaches: ['chat.example.com'],
      }),
      settings: async () => ({}),
      fetcher: real,
    });
    running.push(runtime);
    const outcome = await runtime.callPart('provider.chat', {}, { keys: { key: 'k' } });
    expect(outcome.json).toEqual({
      global: expect.stringMatching(/Use app\.fetch/),
      other: expect.stringMatching(/may only reach chat\.example\.com, not evil\.example\.net/),
      plain: expect.stringMatching(/isn’t a secure \(https\) address/),
    });
  });
});

describe('a chat app’s code, sealed', () => {
  it('has nothing to read a chat or call a tool with: only its own few things', async () => {
    const { runtime } = await app(`export const channel = {
      async identify(app) {
        const found = [];
        for (const name of ['conch', 'tools', 'call', 'chats', 'conversations', 'send', 'ask'])
          if (name in app || name in globalThis) found.push(name);
        return { id: 'b', name: 'B', found: found.join(','), own: Object.keys(app).sort().join(','), keys: { ...app.keys }, settings: { ...app.settings } };
      },
      async poll() { return { messages: [] }; },
      async send() { return {}; },
    };`);
    expect(await runtime.parts()).toEqual(['channel.identify', 'channel.poll', 'channel.send']);
    const outcome = await runtime.callPart('channel.identify', {}, { keys: { token: 't' } });
    expect(outcome.json).toMatchObject({
      found: '',
      own: 'data,fetch,keys,log,now,settings',
      keys: { token: 't' },
    });
  });

  it('runs only the functions Conch calls, never one it names itself', async () => {
    const { runtime } = await app(`export const channel = {
      async identify() { return { id: 'b', name: 'B' }; },
      constructor: () => 'x',
    };`);
    // The gateway's own list: anything else is refused before the process is asked.
    const outcome = await runtime.callPart('channel.poll', { cursor: null }, { keys: {} });
    expect(outcome).toMatchObject({
      ok: false,
      text: expect.stringMatching(/doesn’t export channel\.poll/),
    });
  });

  it('is stopped when a call runs over, and starts again for the next', async () => {
    const { runtime } = await app(`export const channel = {
      async identify() { return { id: 'b', name: 'B' }; },
      async send() { await new Promise(() => {}); },
    };`);
    const signal = AbortSignal.timeout(300);
    const outcome = await runtime.callPart(
      'channel.send',
      { chatId: 'c', text: 'hi' },
      { keys: {}, signal },
    );
    expect(outcome).toMatchObject({ ok: false, text: 'Stopped.' });
    expect((await runtime.callPart('channel.identify', {}, { keys: {} })).ok).toBe(true);
  });
});
