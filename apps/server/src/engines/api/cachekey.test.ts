/**
 * Every provider that routes its prompt cache by a chat's key is told which
 * chat a request belongs to, and no one else is (ADR 0085, 2026-10-09).
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { TurnInput } from '../types';
import { chatCacheKey, jobCacheKey, SALT_FILE } from './cachekey';
import { ApiEngine } from './engine';
import { collect, dataFrames, fakeFetch, fakeHome, jsonResponse, sseResponse } from './fake';
import { OpenAiWire, type ChatPreset } from './openai';
import { PRESETS } from './presets';
import { sessionsDir } from './session';
import type { WireEvent, WireRequest } from './types';

const preset = (id: string) => PRESETS.find((p) => p.id === id) as ChatPreset;

const answer = (text = 'Hi there') =>
  sseResponse(
    dataFrames(
      JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }),
      '[DONE]',
    ),
  );

async function drain(events: AsyncIterable<WireEvent>): Promise<WireEvent[]> {
  const out: WireEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

function request(overrides: Partial<WireRequest> = {}): WireRequest {
  return {
    key: 'k',
    model: 'some-model',
    system: 'You are Pearl.',
    messages: [{ role: 'user', content: 'Hello' }],
    tools: [],
    effort: 'auto',
    signal: new AbortController().signal,
    cacheKey: 'chat-key-0123456789',
    ...overrides,
  };
}

describe('a chat’s cache key', () => {
  it('is the same for one chat every time, different for another, and says nothing about either', async () => {
    const { home } = await fakeHome();
    const one = await chatCacheKey(home, 'c_holiday_with_anna');
    expect(await chatCacheKey(home, 'c_holiday_with_anna')).toBe(one);
    expect(await chatCacheKey(home, 'c_other')).not.toBe(one);
    expect(one).toMatch(/^[\w-]{32}$/);
    expect(one).not.toContain('holiday');
    expect(one).not.toContain('anna');
    // A job's key is per job, never a chat's.
    const title = await jobCacheKey(home, 'Name this chat in a few words.');
    expect(await jobCacheKey(home, 'Name this chat in a few words.')).toBe(title);
    expect(await jobCacheKey(home, 'Summarise the chat.')).not.toBe(title);
    expect(title).not.toBe(one);
  });

  it('is salted once per install, kept beside the transcripts, readable only by Conch', async () => {
    const { home } = await fakeHome();
    const key = await chatCacheKey(home, 'c_same');
    const path = join(sessionsDir(home), SALT_FILE);
    expect((await readFile(path)).length).toBe(32);
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
    // Another install has another salt, so the same chat id has another key.
    const other = await fakeHome();
    expect(await chatCacheKey(other.home, 'c_same')).not.toBe(key);
  });
});

describe('who is told', () => {
  it.each(PRESETS.map((p) => [p.id, p.cacheKey] as const))(
    '%s gets the key only the way it documents',
    async (id, declared) => {
      const api = fakeFetch(() => answer());
      const wire = new OpenAiWire(preset(id), api.fetch);
      await drain(wire.stream(request()));
      await wire.complete({
        key: 'k',
        model: 'some-model',
        system: 'Name it',
        prompt: 'Hello',
        maxTokens: 16,
        signal: new AbortController().signal,
        cacheKey: 'job-key-0123456789',
      });
      const [chat, job] = api.calls;
      const body = chat?.body as Record<string, unknown>;
      const jobBody = job?.body as Record<string, unknown>;
      if (declared && 'body' in declared) {
        expect(body[declared.body]).toBe('chat-key-0123456789');
        expect(jobBody[declared.body]).toBe('job-key-0123456789');
      } else expect(JSON.stringify([body, jobBody])).not.toContain('key-0123456789');
      if (declared && 'header' in declared) {
        expect(chat?.headers[declared.header]).toBe('chat-key-0123456789');
        expect(job?.headers[declared.header]).toBe('job-key-0123456789');
      } else expect(JSON.stringify([chat?.headers, job?.headers])).not.toContain('key-0123456789');
    },
  );

  it('OpenAI, Mistral and Cerebras by `prompt_cache_key`; xAI by its conversation header', () => {
    const declared = Object.fromEntries(PRESETS.map((p) => [p.id, p.cacheKey]));
    expect(declared.openai).toEqual({ body: 'prompt_cache_key' });
    expect(declared.mistral).toEqual({ body: 'prompt_cache_key' });
    expect(declared.cerebras).toEqual({ body: 'prompt_cache_key' });
    expect(declared.xai).toEqual({ header: 'x-grok-conv-id' });
    // Your own server isn't sent a field it may not know.
    const own: ChatPreset = { id: 'custom', label: 'My server', endpoints: [] };
    expect(own.cacheKey).toBeUndefined();
  });

  it('asks again without the key when a server refuses the field, and stops sending it', async () => {
    let refused = 0;
    const api = fakeFetch((call) => {
      if ((call.body as Record<string, unknown>).prompt_cache_key) {
        refused++;
        return jsonResponse(
          {
            detail: [
              {
                type: 'extra_forbidden',
                loc: ['body', 'prompt_cache_key'],
                msg: 'Extra inputs are not permitted',
              },
            ],
          },
          422,
        );
      }
      return answer();
    });
    const wire = new OpenAiWire(preset('mistral'), api.fetch);
    const events = await drain(wire.stream(request()));
    expect(events.at(-1)).toMatchObject({ type: 'end', message: { content: 'Hi there' } });
    await drain(wire.stream(request()));
    const done = await wire.complete({
      key: 'k',
      model: 'some-model',
      system: 'Name it',
      prompt: 'Hello',
      maxTokens: 16,
      signal: new AbortController().signal,
      cacheKey: 'job-key',
    });
    expect(done.text).toBe('Hi there');
    expect(refused).toBe(1);
    expect(api.calls).toHaveLength(4);
  });
});

describe('a chat on a provider that caches by prefix', () => {
  async function chatOn(id: 'openai' | 'xai') {
    const { home, settings, keys } = await fakeHome();
    await keys.save(id, 'a-fake-key-0123456789');
    const api = fakeFetch((call) =>
      call.url.endsWith('/models')
        ? jsonResponse({ data: [{ id: 'gpt-5.1', created: 1 }] })
        : answer(`Answer ${api.calls.length}`),
    );
    const engine = new ApiEngine(
      {
        id,
        label: id,
        docsUrl: '',
        keyUrl: '',
        canSignIn: false,
        wire: new OpenAiWire(preset(id), api.fetch),
        home,
      },
      settings,
      keys,
    );
    const turn = async (conversationId: string, prompt: string, resumeId?: string) => {
      const input: TurnInput = {
        conversationId,
        prompt,
        ...(resumeId && { resumeId }),
        systemAppend: '# Who you are\nYou are Pearl.',
        cwd: process.cwd(),
        tools: [],
        requestPermission: async () => 'allow',
        signal: new AbortController().signal,
        options: { model: 'gpt-5.1', effort: 'auto', fastMode: false, permissionMode: 'default' },
      };
      const events = await collect(engine.runTurn(input));
      const session = events.find((e) => e.type === 'session');
      return session && 'resumeId' in session ? session.resumeId : resumeId;
    };
    const chats = () =>
      api.calls
        .filter((c) => c.url.endsWith('/chat/completions'))
        .map((c) => ({ body: c.body as Record<string, unknown>, headers: c.headers }));
    return { turn, chats };
  }

  it('sends one key for every turn of a chat, another for the next chat, and a prefix that only grows', async () => {
    const { turn, chats } = await chatOn('openai');
    const resume = await turn('c_one', 'First question');
    await turn('c_one', 'Second question', resume);
    await turn('c_two', 'Something else');
    const [first, second, other] = chats();
    if (!first || !second || !other) throw new Error('three requests');
    expect(first.body.prompt_cache_key).toEqual(expect.any(String));
    expect(second.body.prompt_cache_key).toBe(first.body.prompt_cache_key);
    expect(other.body.prompt_cache_key).not.toBe(first.body.prompt_cache_key);
    expect(String(first.body.prompt_cache_key)).not.toContain('c_one');

    // Everything the first turn sent is the start of what the second sends, byte for byte.
    const { messages: before, ...restBefore } = first.body as { messages: unknown[] };
    const { messages: after, ...restAfter } = second.body as { messages: unknown[] };
    expect(JSON.stringify(restAfter)).toBe(JSON.stringify(restBefore));
    const prefix = JSON.stringify(before).slice(0, -1);
    expect(JSON.stringify(after).startsWith(prefix)).toBe(true);
    expect(after.length).toBe(before.length + 2);
  });

  it('tells xAI in its header, and nothing in the body', async () => {
    const { turn, chats } = await chatOn('xai');
    const resume = await turn('c_one', 'First question');
    await turn('c_one', 'Second question', resume);
    const [first, second] = chats();
    expect(first?.headers['x-grok-conv-id']).toEqual(expect.any(String));
    expect(second?.headers['x-grok-conv-id']).toBe(first?.headers['x-grok-conv-id']);
    expect(first?.body.prompt_cache_key).toBeUndefined();
  });
});
