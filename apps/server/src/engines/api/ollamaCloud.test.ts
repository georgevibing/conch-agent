import type { LoginState } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { OllamaClient } from '../../local/ollama';
import { dataFrames, failure, fakeFetch, jsonResponse, sseResponse } from './fake';
import type { OllamaLink } from './ollama';
import { cloudName, localAccount, ollamaCloudVariant } from './ollamaCloud';
import type { WireEvent } from './types';

function link(fetch: typeof globalThis.fetch, running = true): OllamaLink {
  return {
    client: new OllamaClient(() => 'http://127.0.0.1:11434', fetch),
    models: async () => [],
    contextFor: () => 8192,
    ensureRunning: async () => running,
    loaded: async () => true,
    engineStatus: async () => {
      throw new Error('not used');
    },
  };
}

const SIGNIN = 'https://ollama.com/connect?name=desk&key=abc';

describe('a cloud model’s name through the Ollama app', () => {
  it.each([
    ['gpt-oss:120b', 'gpt-oss:120b-cloud'],
    ['gemma4', 'gemma4:cloud'],
    ['kimi-k3:cloud', 'kimi-k3:cloud'],
  ])('%s → %s', (model, name) => {
    expect(cloudName(model)).toBe(name);
  });
});

describe('the Ollama app’s own sign-in', () => {
  it('reads the account it’s signed in to, or the page that signs it in', async () => {
    const signedIn = fakeFetch(() => jsonResponse({ name: 'ada', email: 'ada@example.com', plan: 'pro' }));
    expect(await localAccount(link(signedIn.fetch))).toEqual({ signedIn: true, name: 'ada', plan: 'pro' });
    expect(signedIn.calls[0]).toMatchObject({ url: 'http://127.0.0.1:11434/api/me', method: 'POST' });

    const out = fakeFetch(() => jsonResponse({ error: 'unauthorized', signin_url: SIGNIN }, 401));
    expect(await localAccount(link(out.fetch))).toEqual({ signedIn: false, url: SIGNIN });

    // A sign-in page that isn't Ollama's own is never passed on.
    const odd = fakeFetch(() => jsonResponse({ signin_url: 'https://evil.example/connect' }, 401));
    expect(await localAccount(link(odd.fetch))).toEqual({ signedIn: false });
  });

  it('connects through the app with no key, and sends chats there under their cloud names', async () => {
    const fetch = fakeFetch((call) => {
      if (call.url.endsWith('/api/me')) return jsonResponse({ name: 'ada', plan: 'pro' });
      if (call.url === 'http://127.0.0.1:11434/v1/chat/completions')
        return sseResponse(dataFrames(JSON.stringify({ choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }] }), '[DONE]'));
      return new Response('', { status: 404 });
    });
    const variant = ollamaCloudVariant(link(fetch.fetch));
    expect(await variant.wire.check({ key: '' })).toEqual({ description: 'Through the Ollama app · ada · Pro plan' });
    const events: WireEvent[] = [];
    for await (const event of variant.wire.stream({
      key: '',
      model: 'gpt-oss:120b',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      effort: 'auto',
      signal: new AbortController().signal,
    }))
      events.push(event);
    expect(events.at(-1)).toMatchObject({ type: 'end', message: { content: 'Hi' } });
    const chat = fetch.calls.find((c) => c.url.endsWith('/v1/chat/completions'));
    expect(chat?.body).toMatchObject({ model: 'gpt-oss:120b-cloud' });
    expect(chat?.headers.authorization).toBeUndefined();
  });

  it('asks for a sign-in or a key when neither is there', async () => {
    const fetch = fakeFetch(() => jsonResponse({ signin_url: SIGNIN }, 401));
    const error = await failure(ollamaCloudVariant(link(fetch.fetch)).wire.check({ key: '' }));
    expect(error).toMatchObject({ kind: 'auth', message: expect.stringContaining('Sign in to Ollama') });
    const none = await failure(ollamaCloudVariant(link(fetch.fetch, false)).wire.check({ key: '' }));
    expect(none.message).toContain('install the Ollama app');
  });

  it('shows Ollama’s page, waits for the sign-in, and finishes by itself', async () => {
    vi.useFakeTimers();
    try {
      let signedIn = false;
      const fetch = fakeFetch(() =>
        signedIn ? jsonResponse({ name: 'ada' }) : jsonResponse({ signin_url: SIGNIN }, 401),
      );
      const variant = ollamaCloudVariant(link(fetch.fetch));
      const states: LoginState[] = [];
      variant.login?.((state) => states.push(state));
      await vi.advanceTimersByTimeAsync(10);
      expect(states.at(-1)).toMatchObject({ phase: 'waiting-for-browser', url: SIGNIN });
      signedIn = true;
      await vi.advanceTimersByTimeAsync(2_500);
      expect(states.at(-1)).toMatchObject({ phase: 'done' });
    } finally {
      vi.useRealTimers();
    }
  });
});
