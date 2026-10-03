import { describe, expect, it } from 'vitest';

import { dataFrames, failure, fakeFetch, jsonResponse, sseResponse } from './fake';
import {
  mapChatError,
  OpenAiWire,
  pickModels,
  prettyModel,
  readFacts,
  type ChatPreset,
  type EndpointMemory,
} from './openai';
import { PRESETS } from './presets';
import type { WireEvent, WireRequest } from './types';

const preset = (id: string) => PRESETS.find((p) => p.id === id) as ChatPreset;

async function drain(events: AsyncIterable<WireEvent>): Promise<WireEvent[]> {
  const out: WireEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

function request(overrides: Partial<WireRequest> = {}): WireRequest {
  return {
    key: 'sk-test-0123456789abcdef',
    model: 'gpt-5.1-mini',
    system: 'You are Pearl.',
    messages: [{ role: 'user', content: 'Hello' }],
    tools: [{ name: 'remember', description: 'Save a fact.', schema: { type: 'object' } }],
    effort: 'auto',
    signal: new AbortController().signal,
    ...overrides,
  };
}

const answer = (text = 'Hi there') =>
  sseResponse(
    dataFrames(
      JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }),
      '[DONE]',
    ),
  );

function memory(start?: string): EndpointMemory & { value?: string } {
  const box: EndpointMemory & { value?: string } = {
    value: start,
    get: () => box.value,
    set: (v) => {
      box.value = v;
    },
  };
  return box;
}

describe('reading what a model list says', () => {
  it('finds the same facts under every provider’s field names', () => {
    expect(
      readFacts({
        id: 'mistral-large-latest',
        name: 'Mistral Large',
        max_context_length: 131072,
        capabilities: { completion_chat: true, function_calling: true, vision: false },
      }),
    ).toMatchObject({
      id: 'mistral-large-latest',
      name: 'Mistral Large',
      context: 131072,
      tools: true,
      images: false,
    });
    expect(
      readFacts({
        id: 'kimi-k3',
        context_length: 1_000_000,
        supports_image_in: true,
        supports_reasoning: true,
      }),
    ).toMatchObject({
      context: 1_000_000,
      images: true,
      thinking: true,
    });
    expect(
      readFacts({ id: 'grok-4.7', capabilities: { reasoning_effort: ['low', 'high'] } }),
    ).toMatchObject({
      efforts: ['low', 'high'],
      thinking: true,
    });
    expect(
      readFacts({
        key: 'google/gemma-4',
        display_name: 'Gemma 4',
        type: 'llm',
        capabilities: { vision: true, trained_for_tool_use: true },
      }),
    ).toMatchObject({
      id: 'google/gemma-4',
      name: 'Gemma 4',
      chat: true,
      images: true,
      tools: true,
    });
    expect(readFacts({ id: 'text-embedding-nomic', type: 'embeddings' })?.chat).toBe(false);
    expect(readFacts({ id: 'mistral-embed', capabilities: { completion_chat: false } })?.chat).toBe(
      false,
    );
    expect(readFacts({ id: 'old', shutdown_date: '2020-01-01' })?.retired).toBe(true);
  });
});

describe('choosing which models a picker shows', () => {
  const openai = preset('openai');

  it('leaves out what can’t chat, folds dated copies, and puts the newest first', () => {
    const picked = pickModels(
      [
        { id: 'gpt-4.1', created: 100 },
        { id: 'gpt-4.1-2025-04-14', created: 100 },
        { id: 'gpt-5.1', created: 300 },
        { id: 'gpt-5.1-mini', created: 300 },
        { id: 'text-embedding-3-large', created: 400 },
        { id: 'whisper-1', created: 400 },
        { id: 'gpt-image-1', created: 400 },
        { id: 'tts-1-hd', created: 400 },
        { id: 'o4-deep-research', created: 400 },
        { id: 'gpt-5-codex', created: 400 },
        { id: 'o3', created: 200 },
      ],
      openai,
    ).map((m) => m.id);
    expect(picked).toEqual(['gpt-5.1', 'gpt-5.1-mini', 'o3', 'gpt-4.1']);
  });

  it('keeps one name for a model listed under two', () => {
    const picked = pickModels(
      [
        { id: 'mistral-large-latest', aliases: ['mistral-large-2411'] },
        { id: 'mistral-large-2411', aliases: ['mistral-large-latest'] },
      ],
      preset('mistral'),
    ).map((m) => m.id);
    expect(picked).toEqual(['mistral-large-latest']);
  });
});

describe('a model’s name when the list gives none', () => {
  it.each([
    ['gpt-5.1-mini', 'GPT-5.1 mini'],
    ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
    ['models/gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview'],
    ['deepseek-chat', 'DeepSeek Chat'],
    ['glm-4.6', 'GLM-4.6'],
    ['grok-4-fast-reasoning', 'Grok 4 Fast Reasoning'],
    ['meta-llama/llama-3.3-70b-instruct', 'Llama 3.3 70B Instruct'],
    ['qwen3-coder', 'Qwen3 Coder'],
  ])('%s → %s', (id, words) => {
    expect(prettyModel(id)).toBe(words);
  });
});

describe('reading a failure the way each provider means it', () => {
  const label = { label: 'Lab' };
  it.each([
    ['a 401', 401, { message: 'nope' }, 'auth'],
    [
      'xAI’s 400 for a bad key',
      400,
      { message: 'Incorrect API key provided.', code: 'invalid-argument' },
      'auth',
    ],
    [
      'Gemini’s 400 for a bad key',
      400,
      { message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' },
      'auth',
    ],
    ['NVIDIA’s 403', 403, { message: 'Authorization failed' }, 'auth'],
    [
      'OpenAI’s 429 for spent credit',
      429,
      {
        message: 'You exceeded your quota',
        code: 'credit_balance_exhausted',
        type: 'insufficient_quota',
      },
      'payment',
    ],
    [
      'Kimi’s 429 for spent credit',
      429,
      { message: 'quota', type: 'exceeded_current_quota_error' },
      'payment',
    ],
    ['Z.ai’s 1113', 429, { message: 'Insufficient balance', code: '1113' }, 'payment'],
    ['Alibaba’s arrears', 403, { message: 'Access denied', code: 'Arrearage' }, 'payment'],
    ['DeepSeek’s 402', 402, { message: 'Insufficient Balance' }, 'payment'],
    [
      'a rate limit',
      429,
      { message: 'Rate limit reached', type: 'rate_limit_error' },
      'rate-limit',
    ],
    ['an overload', 503, { message: 'server_is_overloaded' }, 'overloaded'],
    [
      'Together’s 403 for a long chat',
      403,
      { message: 'Input token count + max_tokens exceeds the limit' },
      'context',
    ],
    [
      'a long chat',
      400,
      {
        message: "This model's maximum context length is 128000 tokens",
        code: 'context_length_exceeded',
      },
      'context',
    ],
    ['a model that’s gone', 410, { message: 'reached its end of life' }, 'not-found'],
    [
      'Fireworks’ unknown model',
      404,
      { message: 'Model not found, inaccessible, and/or not deployed', code: 'NOT_FOUND' },
      'not-found',
    ],
  ] as const)('%s', (_name, status, error, kind) => {
    expect(mapChatError(status, error, undefined, label).kind).toBe(kind);
  });

  it('retries a rate limit only when told how long to wait', () => {
    expect(mapChatError(429, { message: 'slow down' }, 3000, label)).toMatchObject({
      retryable: true,
      retryAfterMs: 3000,
    });
    expect(mapChatError(429, { message: 'slow down' }, undefined, label).retryable).toBe(false);
  });

  it('never repeats a key back', () => {
    const error = mapChatError(
      400,
      { message: 'bad request for sk-secret-abcdefgh1234' },
      undefined,
      label,
      'sk-secret-abcdefgh1234',
    );
    expect(error.message).not.toContain('sk-secret-abcdefgh1234');
  });
});

describe('a key and its company’s regions', () => {
  it('tries each of the company’s own addresses, keeps the one that took the key, and starts there next time', async () => {
    const fetch = fakeFetch((call) =>
      call.url.startsWith('https://api.moonshot.ai')
        ? jsonResponse(
            { error: { message: 'Invalid Authentication', type: 'invalid_authentication_error' } },
            401,
          )
        : jsonResponse({ data: [{ id: 'kimi-k3', context_length: 1_000_000 }] }),
    );
    const remembered = memory();
    const wire = new OpenAiWire(preset('moonshot'), fetch.fetch, remembered);

    expect(await wire.check({ key: 'sk-kimi' })).toEqual({ description: 'Kimi · China' });
    expect(remembered.value).toBe('cn');
    expect(fetch.calls.map((c) => new URL(c.url).host)).toEqual([
      'api.moonshot.ai',
      'api.moonshot.cn',
    ]);
    // Never anyone else's address.
    expect(fetch.calls.every((c) => /moonshot\.(ai|cn)$/.test(new URL(c.url).host))).toBe(true);

    fetch.calls.length = 0;
    await wire.check({ key: 'sk-kimi' });
    expect(fetch.calls.map((c) => new URL(c.url).host)).toEqual(['api.moonshot.cn']);
  });

  it('says the key may be for the other site when every address refuses it', async () => {
    const fetch = fakeFetch(() =>
      jsonResponse({ error: { code: '401', message: 'token expired or incorrect' } }, 401),
    );
    const error = await failure(
      new OpenAiWire(preset('zai'), fetch.fetch).check({ key: 'abc.def' }),
    );
    expect(error.kind).toBe('auth');
    expect(error.message).toMatch(/Z\.ai refused your key \(or it’s from Z\.ai’s other site/);
  });

  it('starts at the address remembered from before', async () => {
    const fetch = fakeFetch(() => jsonResponse({ data: [] }));
    const wire = new OpenAiWire(preset('qwen'), fetch.fetch, memory('cn'));
    expect(wire.endpoint.id).toBe('cn');
    await wire.check({ key: 'sk-ws-abc' });
    expect(fetch.calls[0]?.url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/models');
  });
});

describe('a turn with a preset provider', () => {
  it('streams an answer and asks for usage in the last frame', async () => {
    const fetch = fakeFetch(() => answer());
    const wire = new OpenAiWire(preset('openai'), fetch.fetch);
    const events = await drain(wire.stream(request()));
    expect(events.at(-1)).toMatchObject({
      type: 'end',
      message: { content: 'Hi there' },
      usage: { inputTokens: 12, outputTokens: 3 },
    });
    const body = fetch.calls[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gpt-5.1-mini',
      stream: true,
      stream_options: { include_usage: true },
      tool_choice: 'auto',
    });
    expect(fetch.calls[0]?.headers.authorization).toBe('Bearer sk-test-0123456789abcdef');
  });

  it('asks again without tools when a model can’t use them, says so, and remembers', async () => {
    let calls = 0;
    const fetch = fakeFetch(() =>
      ++calls === 1
        ? jsonResponse(
            {
              error: {
                message: 'This model does not support tools',
                type: 'invalid_request_error',
              },
            },
            400,
          )
        : answer(),
    );
    const wire = new OpenAiWire(preset('groq'), fetch.fetch);
    const events = await drain(wire.stream(request({ model: 'tiny-model' })));
    expect(events[0]).toMatchObject({ type: 'notice', code: 'no-tools' });
    expect((fetch.calls[1]?.body as Record<string, unknown>).tools).toBeUndefined();
    expect(wire.toolsFor('tiny-model')).toBe(false);
  });

  it('only asks for thinking where the model takes that level', async () => {
    const fetch = fakeFetch((call) =>
      call.url.endsWith('/models')
        ? jsonResponse({
            data: [
              { id: 'gpt-5.1', created: 1 },
              { id: 'gpt-4.1', created: 1 },
            ],
          })
        : answer(),
    );
    const wire = new OpenAiWire(preset('openai'), fetch.fetch);
    await wire.models({ key: 'k' });
    await drain(wire.stream(request({ model: 'gpt-5.1', effort: 'high' })));
    await drain(wire.stream(request({ model: 'gpt-4.1', effort: 'high' })));
    expect((fetch.calls[1]?.body as Record<string, unknown>).reasoning_effort).toBe('high');
    expect((fetch.calls[2]?.body as Record<string, unknown>).reasoning_effort).toBeUndefined();
  });

  it('says a model can’t use tools before it’s asked, when the provider has said so', async () => {
    const fetch = fakeFetch(() =>
      jsonResponse({
        data: [
          { id: 'gpt-6-astra', created: 2 },
          { id: 'gpt-6-luna', created: 1 },
        ],
      }),
    );
    const wire = new OpenAiWire(preset('openai'), fetch.fetch);
    const models = await wire.models({ key: 'k' });
    expect(models.find((m) => m.info.id === 'gpt-6-astra')?.tools).toBe(false);
    expect(models.find((m) => m.info.id === 'gpt-6-luna')?.tools).toBe(true);
  });

  it('answers a short request from a stream, with OpenAI’s own token field', async () => {
    const fetch = fakeFetch(() => answer('A title'));
    const wire = new OpenAiWire(preset('openai'), fetch.fetch);
    const done = await wire.complete({
      key: 'k',
      model: 'gpt-5.1-mini',
      system: 'Name it',
      prompt: 'Hello',
      maxTokens: 64,
      signal: new AbortController().signal,
    });
    expect(done.text).toBe('A title');
    expect(fetch.calls[0]?.body).toMatchObject({ stream: true, max_completion_tokens: 1024 });
  });
});

describe('providers whose list lives elsewhere', () => {
  it('reads Gemini’s own list with its own header, never a Bearer token', async () => {
    const fetch = fakeFetch(() =>
      jsonResponse({
        models: [
          {
            name: 'models/gemini-3.1-pro',
            displayName: 'Gemini 3.1 Pro',
            inputTokenLimit: 1_000_000,
            supportedGenerationMethods: ['generateContent'],
            thinking: true,
          },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          {
            name: 'models/gemma-3-27b-it',
            displayName: 'Gemma 3 27B',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      }),
    );
    const wire = new OpenAiWire(preset('gemini'), fetch.fetch);
    const models = await wire.models({ key: 'AIza-test' });
    expect(fetch.calls[0]?.url).toContain(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    );
    expect(fetch.calls[0]?.headers['x-goog-api-key']).toBe('AIza-test');
    expect(fetch.calls[0]?.headers.authorization).toBeUndefined();
    expect(models.map((m) => [m.info.id, m.info.label, m.tools])).toEqual([
      ['gemini-3.1-pro', 'Gemini 3.1 Pro', true],
      ['gemma-3-27b-it', 'Gemma 3 27B', false],
    ]);
    expect(models[0]?.info).toMatchObject({
      description: '1000k context',
      images: true,
      efforts: ['low', 'medium', 'high'],
    });
  });

  it('lists Cerebras from its public list, and proves the key on the authorised one', async () => {
    const fetch = fakeFetch((call) =>
      call.url.includes('/public/')
        ? jsonResponse({
            data: [
              {
                id: 'gpt-oss-120b',
                capabilities: { function_calling: true, vision: false },
                limits: { max_context_length: 131072 },
              },
            ],
          })
        : jsonResponse({ data: [{ id: 'gpt-oss-120b' }] }),
    );
    const wire = new OpenAiWire(preset('cerebras'), fetch.fetch);
    await wire.check({ key: 'csk-abc' });
    expect(fetch.calls[0]?.url).toBe('https://api.cerebras.ai/v1/models');
    const models = await wire.models({ key: 'csk-abc' });
    expect(models[0]?.info).toMatchObject({ id: 'gpt-oss-120b', description: '131k context' });
  });

  it('asks Ollama’s cloud what each model can do', async () => {
    const fetch = fakeFetch((call) =>
      call.url.endsWith('/api/tags')
        ? jsonResponse({ models: [{ name: 'gpt-oss:120b' }, { name: 'gemma4:31b' }] })
        : jsonResponse(
            (call.body as { model: string }).model === 'gpt-oss:120b'
              ? {
                  capabilities: ['completion', 'tools', 'thinking'],
                  model_info: { 'general.architecture': 'gptoss', 'gptoss.context_length': 131072 },
                  thinking: { values: ['low', 'medium', 'high'] },
                }
              : {
                  capabilities: ['completion', 'vision'],
                  model_info: { 'general.architecture': 'gemma4', 'gemma4.context_length': 262144 },
                  thinking: { values: [false, true] },
                },
          ),
    );
    const wire = new OpenAiWire(preset('ollama-cloud'), fetch.fetch);
    const models = await wire.models({});
    const gpt = models.find((m) => m.info.id === 'gpt-oss:120b');
    const gemma = models.find((m) => m.info.id === 'gemma4:31b');
    expect(gpt).toMatchObject({
      tools: true,
      info: { efforts: ['low', 'medium', 'high'], description: '131k context' },
    });
    expect(gemma).toMatchObject({ tools: false, info: { images: true, efforts: [] } });
    // Reading the cloud's list needs no key, so none is sent.
    expect(fetch.calls.every((c) => !c.headers.authorization)).toBe(true);
  });

  it('proves an Ollama key on a page that refuses a bad one', async () => {
    const fetch = fakeFetch(() => jsonResponse({ error: 'invalid credentials' }, 401));
    const error = await failure(
      new OpenAiWire(preset('ollama-cloud'), fetch.fetch).check({ key: 'bad' }),
    );
    expect(error.kind).toBe('auth');
    expect(fetch.calls[0]?.url).toBe('https://ollama.com/api/usage');
  });
});
