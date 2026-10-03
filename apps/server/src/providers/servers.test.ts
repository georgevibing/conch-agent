import { describe, expect, it } from 'vitest';

import { fakeFetch, jsonResponse } from '../engines/api/fake';
import { isPrivateUrl } from '../local/host';
import { environmentKeys, foundKeyValue } from './found';
import {
  candidates,
  keyCheckFor,
  localServers,
  newServerId,
  probeServer,
  reachable,
} from './servers';

describe('reading an address the way a person types it', () => {
  it.each([
    ['localhost:8080', ['http://localhost:8080/v1', 'http://localhost:8080']],
    ['127.0.0.1:8000/v1', ['http://127.0.0.1:8000/v1']],
    ['gpu-box:8000', ['http://gpu-box:8000/v1', 'http://gpu-box:8000']],
    ['192.168.1.20:1234/', ['http://192.168.1.20:1234/v1', 'http://192.168.1.20:1234']],
    ['api.together.ai/v1/chat/completions', ['https://api.together.ai/v1']],
    ['https://api.fireworks.ai/inference/v1/models', ['https://api.fireworks.ai/inference/v1']],
    ['https://router.huggingface.co/v1?x=1#y', ['https://router.huggingface.co/v1']],
    ['  ', []],
    ['ftp://example.com', []],
  ])('%s', (typed, expected) => {
    expect(candidates(typed)).toEqual(expected);
  });

  it('allows plain http only where it stays off the internet', () => {
    expect(reachable('http://localhost:8080/v1')).toBe(true);
    expect(reachable('http://10.0.0.5:8000/v1')).toBe(true);
    expect(reachable('http://100.101.102.103:8000/v1')).toBe(true);
    expect(reachable('http://nas.local:8000/v1')).toBe(true);
    expect(reachable('http://gpu-box:8000/v1')).toBe(true);
    expect(reachable('http://[fd12::1]:8000/v1')).toBe(true);
    expect(reachable('https://api.together.ai/v1')).toBe(true);
    expect(reachable('http://api.together.ai/v1')).toBe(false);
    expect(reachable('http://8.8.8.8/v1')).toBe(false);
    expect(reachable('http://user:pass@localhost:8080/v1')).toBe(false);
    expect(isPrivateUrl('http://172.32.0.1/')).toBe(false);
    expect(isPrivateUrl('http://172.20.0.1/')).toBe(true);
  });

  it('makes server ids the protocol accepts', () => {
    const id = newServerId();
    expect(id).toMatch(/^server-[a-z0-9]{8}$/);
    expect(newServerId()).not.toBe(id);
  });

  it('knows which services need a page other than their list to prove a key', () => {
    expect(keyCheckFor('https://router.huggingface.co/v1')).toBe(
      'https://huggingface.co/api/whoami-v2',
    );
    expect(keyCheckFor('https://api.venice.ai/api/v1')).toBe(
      'https://api.venice.ai/api/v1/api_keys/rate_limits',
    );
    expect(keyCheckFor('http://127.0.0.1:8080/v1')).toBeUndefined();
  });
});

describe('looking at an address before adding it', () => {
  it('finds the version path, counts the models, and says what the server is', async () => {
    const fetch = fakeFetch((call) => {
      if (call.url === 'http://localhost:8080/v1/models')
        return new Response(
          JSON.stringify({ object: 'list', data: [{ id: 'qwen3', owned_by: 'llamacpp' }] }),
          {
            headers: { 'content-type': 'application/json', server: 'llama.cpp' },
          },
        );
      return new Response('not found', { status: 404 });
    });
    expect(await probeServer(fetch.fetch, 'localhost:8080')).toEqual({
      ok: true,
      url: 'http://localhost:8080/v1',
      models: 1,
      kind: 'llama.cpp',
    });
  });

  it('reads a bare list (Together) and a server under its own path', async () => {
    const fetch = fakeFetch(() =>
      jsonResponse([
        { id: 'a', type: 'chat' },
        { id: 'b', type: 'chat' },
      ]),
    );
    expect(
      await probeServer(fetch.fetch, 'https://api.together.ai/v1', 'tgp_v1_key'),
    ).toMatchObject({
      ok: true,
      url: 'https://api.together.ai/v1',
      models: 2,
    });
    expect(fetch.calls[0]?.headers.authorization).toBe('Bearer tgp_v1_key');
  });

  it('says a server wants a key, or that the key was wrong', async () => {
    const fetch = fakeFetch(() => jsonResponse({ error: { message: 'Invalid API Key' } }, 401));
    expect(await probeServer(fetch.fetch, 'http://127.0.0.1:8000/v1')).toMatchObject({
      ok: false,
      needsKey: true,
      message: 'This server asks for a key.',
    });
    expect(await probeServer(fetch.fetch, 'http://127.0.0.1:8000/v1', 'bad')).toMatchObject({
      ok: false,
      needsKey: true,
      message: 'That key wasn’t accepted.',
    });
  });

  it('checks a key on the page that proves it, when the model list is public', async () => {
    const fetch = fakeFetch((call) =>
      call.url.startsWith('https://huggingface.co/')
        ? jsonResponse({ error: 'Invalid username or password.' }, 401)
        : jsonResponse({ data: [{ id: 'openai/gpt-oss-120b' }] }),
    );
    expect(
      await probeServer(fetch.fetch, 'https://router.huggingface.co/v1', 'hf_bad'),
    ).toMatchObject({
      ok: false,
      needsKey: true,
    });
  });

  it('sends Ollama and LM Studio to their own cards', async () => {
    const ollama = fakeFetch((call) =>
      call.url === 'http://127.0.0.1:11434/'
        ? new Response('Ollama is running')
        : new Response('', { status: 404 }),
    );
    expect(await probeServer(ollama.fetch, '127.0.0.1:11434')).toMatchObject({
      ok: false,
      kind: 'Ollama',
    });
    const lm = fakeFetch((call) =>
      call.url.endsWith('/lmstudio-greeting')
        ? jsonResponse({ lmstudio: true })
        : new Response('', { status: 404 }),
    );
    expect(await probeServer(lm.fetch, 'localhost:1234')).toMatchObject({
      ok: false,
      kind: 'LM Studio',
    });
  });

  it('refuses plain http across the internet before sending anything', async () => {
    const fetch = fakeFetch(() => jsonResponse({ data: [] }));
    expect(await probeServer(fetch.fetch, 'http://api.example.com/v1')).toMatchObject({
      ok: false,
      message: expect.stringContaining('https'),
    });
    expect(fetch.calls).toHaveLength(0);
  });

  it('says plainly when nothing answers', async () => {
    const fetch = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    expect(await probeServer(fetch.fetch, 'localhost:9999')).toMatchObject({
      ok: false,
      message: expect.stringContaining('Nothing answered'),
    });
  });
});

describe('servers already running on this computer', () => {
  it('finds them on the usual ports, and names only what says what it is', async () => {
    const fetch = fakeFetch((call) => {
      if (call.url === 'http://127.0.0.1:8000/v1/models')
        return jsonResponse({
          data: [
            { id: 'm', owned_by: 'vllm' },
            { id: 'n', owned_by: 'vllm' },
          ],
        });
      if (call.url === 'http://127.0.0.1:1337/v1/models')
        return jsonResponse({ data: [{ id: 'j' }] });
      throw new TypeError('fetch failed');
    });
    const found = await localServers(fetch.fetch);
    expect(found).toEqual([
      { url: 'http://127.0.0.1:8000/v1', port: 8000, models: 2, kind: 'vLLM' },
      { url: 'http://127.0.0.1:1337/v1', port: 1337, models: 1 },
    ]);
    // Only this computer is looked at.
    expect(fetch.calls.every((c) => c.url.startsWith('http://127.0.0.1:'))).toBe(true);
  });
});

describe('keys already in the environment', () => {
  const env = {
    GROQ_API_KEY: 'gsk_0123456789abcdefghijklmnop',
    OPENAI_API_KEY: 'not-an-openai-key-at-all-xx',
    GEMINI_API_KEY: '',
    XAI_API_KEY: 'xai-abcdefghijklmnopqrstuvwxyz',
  };

  it('offers a key shaped like its provider’s, by its variable and last four, never the value', () => {
    const found = environmentKeys(new Set(), env);
    expect(found.map((f) => [f.provider, f.detail])).toEqual([
      ['xai', 'XAI_API_KEY · ends wxyz'],
      ['groq', 'GROQ_API_KEY · ends mnop'],
    ]);
    expect(JSON.stringify(found.map(({ key: _key, ...f }) => f))).not.toContain('gsk_0123456789');
  });

  it('leaves out providers that are already connected', () => {
    expect(environmentKeys(new Set(['groq', 'xai']), env)).toEqual([]);
  });

  it('reads a found key only from the provider’s own variables', () => {
    expect(foundKeyValue({ provider: 'groq', variable: 'GROQ_API_KEY' }, env)).toBe(
      env.GROQ_API_KEY,
    );
    expect(foundKeyValue({ provider: 'groq', variable: 'XAI_API_KEY' }, env)).toBeUndefined();
  });
});
