import { describe, expect, it } from 'vitest';

import { dataFrames, fakeFetch, jsonResponse, sseResponse, failure } from './fake';
import { OpenRouterWire, openrouterVariant } from './openrouter';
import { ApiError, type WireEvent, type WireRequest } from './types';

const KEY = 'sk-or-v1-secret-key-value';

function wire(handler: Parameters<typeof fakeFetch>[0]) {
  const fetch = fakeFetch(handler);
  return { wire: new OpenRouterWire(fetch.fetch), calls: fetch.calls };
}

const KEY_INFO = {
  data: {
    label: 'Conch on my laptop',
    limit: 25,
    limit_remaining: 12.4,
    usage: 12.6,
    is_free_tier: false,
  },
};

const MODELS = {
  data: [
    {
      id: 'anthropic/claude-sonnet-4.6',
      name: 'Anthropic: Claude Sonnet 4.6',
      context_length: 200_000,
      pricing: { prompt: '0.000003', completion: '0.000015' },
      supported_parameters: ['tools', 'reasoning'],
      reasoning: { mandatory: false, supported_efforts: ['low', 'medium', 'high', 'ludicrous'] },
    },
    {
      id: 'anthropic/claude-haiku-4.5',
      name: 'Anthropic: Claude Haiku 4.5',
      context_length: 200_000,
      pricing: { prompt: '0.0000008', completion: '0.000004' },
      supported_parameters: ['tools'],
    },
    {
      id: 'some/text-only',
      name: 'Text only',
      context_length: 8192,
      pricing: { prompt: '0', completion: '0' },
      supported_parameters: ['temperature'],
    },
  ],
};

function request(overrides: Partial<WireRequest> = {}): WireRequest {
  return {
    key: KEY,
    model: 'anthropic/claude-sonnet-4.6',
    system: 'You are Pearl.',
    messages: [{ role: 'user', content: 'Remember I like tea' }],
    tools: [
      {
        name: 'mcp__conch__remember',
        description: 'Save a fact.',
        schema: { type: 'object', properties: { content: { type: 'string' } } },
      },
    ],
    effort: 'auto',
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function drain(events: AsyncIterable<WireEvent>): Promise<WireEvent[]> {
  const out: WireEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('OpenRouter keys', () => {
  it('describes what’s left on the key', async () => {
    const { wire: or, calls } = wire(() => jsonResponse(KEY_INFO));

    expect(await or.check({ key: KEY })).toEqual({ description: 'OpenRouter · $12.40 left' });
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/key');
    // The key travels in a header and nowhere else.
    expect(calls[0]?.url).not.toContain('sk-or');
    expect(calls[0]?.headers['authorization']).toBe(`Bearer ${KEY}`);
  });

  it('falls back to the key’s label when there’s no limit to report', async () => {
    const { wire: or } = wire(() =>
      jsonResponse({ data: { label: 'Laptop key', limit: null, limit_remaining: null } }),
    );
    expect(await or.check({ key: KEY })).toEqual({ description: 'OpenRouter · Laptop key' });
  });

  it('says a refused key was refused, without quoting it', async () => {
    const { wire: or } = wire(() =>
      jsonResponse({ error: { code: 401, message: `No auth credentials found: ${KEY}` } }, 401),
    );

    const error = await failure(or.check({ key: KEY }));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('auth');
    expect(error.message).toBe('OpenRouter refused your key. Add a new one in Settings.');
    expect(error.message).not.toContain('sk-or');
  });

  it('says when the key runs out, once that’s soon', async () => {
    const now = Date.parse('2026-10-03T10:00:00Z');
    const at = (expires_at: string | null) => {
      const fetch = fakeFetch(() => jsonResponse({ data: { ...KEY_INFO.data, expires_at } }));
      return new OpenRouterWire(fetch.fetch, () => now).check({ key: KEY });
    };

    expect(await at('2026-10-06T09:00:00Z')).toEqual({
      description: 'OpenRouter · $12.40 left · key expires in 3 days',
    });
    expect(await at('2026-10-04T08:00:00Z')).toEqual({
      description: 'OpenRouter · $12.40 left · key expires tomorrow',
    });
    expect(await at('2026-10-03T18:00:00Z')).toEqual({
      description: 'OpenRouter · $12.40 left · key expires today',
    });
    // Far off, never, or something that isn't a date: nothing to say.
    expect(await at('2027-12-31T23:59:59Z')).toEqual({ description: 'OpenRouter · $12.40 left' });
    expect(await at(null)).toEqual({ description: 'OpenRouter · $12.40 left' });
    expect(await at('soon')).toEqual({ description: 'OpenRouter · $12.40 left' });
  });

  it('says a key OpenRouter no longer knows expired or was deleted', async () => {
    // What OpenRouter answers for an expired key, and for a deleted one.
    const { wire: or } = wire(() =>
      jsonResponse({ error: { code: 401, message: 'User not found.' } }, 401),
    );

    const error = await failure(or.check({ key: KEY }));
    expect(error.kind).toBe('auth');
    expect(error.message).toBe(
      'OpenRouter no longer knows this key: it expired, or was deleted at openrouter.ai. Add a new one in Settings.',
    );
  });

  it('turns an unreachable provider into a sentence, not a stack', async () => {
    const { wire: or } = wire(() => {
      throw new TypeError('fetch failed');
    });

    const error = await failure(or.check({ key: KEY }));
    expect(error.kind).toBe('network');
    expect(error.message).toBe('Conch couldn’t reach OpenRouter. Check your connection.');
  });
});

describe('OpenRouter models', () => {
  it('asks the account-scoped list and keeps only models that can call tools', async () => {
    const { wire: or, calls } = wire(() => jsonResponse(MODELS));

    const models = await or.models({ key: KEY });

    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/models/user');
    expect(models.map((m) => m.info.id)).toEqual([
      'anthropic/claude-sonnet-4.6',
      'anthropic/claude-haiku-4.5',
    ]);
    expect(models[0]?.info).toEqual({
      id: 'anthropic/claude-sonnet-4.6',
      label: 'Anthropic: Claude Sonnet 4.6',
      description: '200k context · $3.00/$15.00 per million tokens',
      context: 200_000,
      // 'ludicrous' isn't an effort Conch knows, so it isn't offered.
      efforts: ['low', 'medium', 'high'],
      supportsFastMode: false,
      supportsAutoMode: false,
    });
  });

  it('falls back to the public catalogue when the scoped list fails', async () => {
    const { wire: or, calls } = wire((call) =>
      call.url.endsWith('/models/user') ? jsonResponse({}, 500) : jsonResponse(MODELS),
    );

    expect((await or.models({ key: KEY })).length).toBe(2);
    expect(calls.map((c) => c.url)).toEqual([
      'https://openrouter.ai/api/v1/models/user',
      'https://openrouter.ai/api/v1/models',
    ]);
  });

  it('shows everything, with a note, rather than an empty picker', async () => {
    const { wire: or } = wire(() => jsonResponse({ data: [MODELS.data[2]] }));

    const models = await or.models({});
    expect(models.map((m) => m.info.id)).toEqual(['some/text-only']);
    // It says it can't use apps with the picker's badge (ADR 0050).
    expect(models[0]?.tools).toBe(false);
  });

  it('finds a small model in the list, and invents none when there isn’t one', async () => {
    const { wire: or } = wire(() => jsonResponse(MODELS));
    expect(or.smallModel()).toBeUndefined();

    await or.models({ key: KEY });
    expect(or.smallModel()).toBe('anthropic/claude-haiku-4.5');
  });
});

describe('an OpenRouter turn', () => {
  const STREAM = dataFrames(
    '{"choices":[{"delta":{"reasoning":"Let me think."}}]}',
    '{"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"Let me think.","signature":"sig"}]}}]}',
    '{"choices":[{"delta":{"content":"One moment"}}]}',
    '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"mcp__conch__remember","arguments":"{\\"con"}}]}}]}',
    '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"tent\\":\\"tea\\"}"}}]}}]}',
    '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
    '{"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":120,"completion_tokens":18,"cost":0.0012}}',
    '[DONE]',
  );

  it('streams thinking and text, then one end with the tool call and the cost', async () => {
    const { wire: or, calls } = wire(() => sseResponse(STREAM));

    const events = await drain(or.stream(request()));

    expect(events.slice(0, 2)).toEqual([
      { type: 'thinking', delta: 'Let me think.' },
      { type: 'text', delta: 'One moment' },
    ]);
    const end = events.at(-1);
    expect(events.filter((e) => e.type === 'end').length).toBe(1);
    expect(end).toEqual({
      type: 'end',
      stop: 'tools',
      // The usage frame is accounting, not a second end of turn.
      usage: { inputTokens: 120, outputTokens: 18, costUsd: 0.0012 },
      toolCalls: [
        {
          id: 'call_1',
          name: 'mcp__conch__remember',
          argumentsJson: '{"content":"tea"}',
        },
      ],
      message: {
        role: 'assistant',
        content: 'One moment',
        reasoning_details: [{ type: 'reasoning.text', text: 'Let me think.', signature: 'sig' }],
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'mcp__conch__remember', arguments: '{"content":"tea"}' },
          },
        ],
      },
    });

    const body = calls[0]?.body as Record<string, unknown>;
    expect(body['stream']).toBe(true);
    expect(body['tool_choice']).toBe('auto');
    // A Claude model is asked to cache: the system prompt, then the conversation by itself.
    expect(body['messages']).toEqual([
      {
        role: 'system',
        content: [{ type: 'text', text: 'You are Pearl.', cache_control: { type: 'ephemeral' } }],
      },
      { role: 'user', content: 'Remember I like tea' },
    ]);
    expect(body['cache_control']).toEqual({ type: 'ephemeral' });
    // Attribution, without claiming a public URL this install doesn't have.
    expect(calls[0]?.headers['x-openrouter-title']).toBe('Conch');
    expect(calls[0]?.headers['x-openrouter-app-visibility']).toBe('hidden');
    expect(calls[0]?.headers['http-referer']).toBeUndefined();
  });

  it('only asks for reasoning at a level the model listed', async () => {
    const { wire: or, calls } = wire((call) =>
      call.url.endsWith('/models/user') ? jsonResponse(MODELS) : sseResponse(dataFrames('[DONE]')),
    );
    await or.models({ key: KEY });

    await drain(or.stream(request({ effort: 'high' })));
    expect((calls[1]?.body as Record<string, unknown>)['reasoning']).toEqual({ effort: 'high' });

    await drain(or.stream(request({ effort: 'max' })));
    expect((calls[2]?.body as Record<string, unknown>)['reasoning']).toBeUndefined();
  });

  it('reports a failure that arrives mid-stream after a 200', async () => {
    const { wire: or } = wire(() =>
      sseResponse(
        dataFrames(
          '{"choices":[{"delta":{"content":"Thinking"}}]}',
          '{"error":{"code":429,"message":"upstream rate limit"},"choices":[{"delta":{},"finish_reason":"error"}]}',
        ),
      ),
    );

    const error = await failure(drain(or.stream(request())));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('rate-limit');
  });

  it('knows which 402s are worth retrying', async () => {
    const budget = wire(() =>
      jsonResponse(
        {
          error: {
            code: 402,
            message: 'in flight budget',
            metadata: {
              error_type: 'payment_required',
              limit_source: 'openrouter_in_flight_budget',
            },
          },
        },
        402,
        { 'retry-after': '3' },
      ),
    );
    const inFlight = await failure(drain(budget.wire.stream(request())));
    expect(inFlight.kind).toBe('rate-limit');
    expect(inFlight.retryable).toBe(true);
    expect(inFlight.retryAfterMs).toBe(3000);

    const broke = wire(() =>
      jsonResponse(
        {
          error: {
            code: 402,
            message: 'out of credits',
            metadata: { error_type: 'payment_required', limit_source: 'openrouter_credits' },
          },
        },
        402,
      ),
    );
    const credits = await failure(drain(broke.wire.stream(request())));
    expect(credits.kind).toBe('payment');
    expect(credits.retryable).toBe(false);
    expect(credits.message).toContain('credits have run out');
  });

  it('answers a short prompt without tools or streaming', async () => {
    const { wire: or, calls } = wire(() =>
      jsonResponse({
        choices: [{ message: { content: 'Tea preferences' } }],
        usage: { prompt_tokens: 90, completion_tokens: 3, cost: 0.0001 },
      }),
    );

    expect(
      await or.complete({
        key: KEY,
        model: 'anthropic/claude-haiku-4.5',
        system: 'Name chats.',
        prompt: 'Hello',
        maxTokens: 256,
        signal: new AbortController().signal,
      }),
    ).toEqual({
      text: 'Tea preferences',
      usage: { inputTokens: 90, outputTokens: 3, costUsd: 0.0001 },
    });
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body['tools']).toBeUndefined();
    expect(body['max_tokens']).toBe(256);
  });

  it('treats an error inside a 200 body as an error', async () => {
    const { wire: or } = wire(() =>
      jsonResponse({ error: { code: 400, message: 'bad model', metadata: {} } }),
    );

    await expect(
      or.complete({
        key: KEY,
        model: 'nope',
        system: '',
        prompt: 'x',
        maxTokens: 16,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('bad model');
  });
});

describe('OpenRouter usage', () => {
  it('reports spend against the key’s own limit', async () => {
    const { wire: or } = wire(() =>
      jsonResponse({
        data: {
          ...KEY_INFO.data,
          free_model_daily_requests: { used: 30, limit: 50, remaining: 20 },
        },
      }),
    );

    expect(await or.usage({ key: KEY })).toEqual({
      kind: 'metered',
      source: 'OpenRouter',
      windows: [
        {
          id: 'free-daily',
          label: 'Free models today',
          usedPercent: 60,
          severity: 'normal',
        },
      ],
      extra: { enabled: true, used: 12.6, limit: 25, currency: 'USD' },
    });
  });

  it('says plainly when the key has no limit set', async () => {
    const { wire: or } = wire(() => jsonResponse({ data: { label: 'k', limit: null } }));

    const usage = await or.usage({ key: KEY });
    expect(usage.extra).toBeUndefined();
    expect(usage.message).toBe('This key has no spending limit set at OpenRouter.');
  });
});

describe('the OpenRouter variant', () => {
  it('describes the provider Conch can sign in to', () => {
    const variant = openrouterVariant({ home: '/tmp/conch-home' });
    expect(variant.id).toBe('openrouter');
    expect(variant.canSignIn).toBe(true);
    expect(variant.home).toBe('/tmp/conch-home');
    expect(variant.wire.usage).toBeDefined();
  });
});

describe('OpenRouter attachments', () => {
  it('sends images as data URLs before the words, and knows which models can see', async () => {
    const { wire: or } = wire(() =>
      jsonResponse({
        data: [
          {
            id: 'a/vision',
            supported_parameters: ['tools'],
            architecture: { input_modalities: ['text', 'image'] },
          },
          {
            id: 'a/blind',
            supported_parameters: ['tools'],
            architecture: { input_modalities: ['text'] },
          },
          { id: 'a/unsaid', supported_parameters: ['tools'] },
        ],
      }),
    );
    const models = await or.models({ key: KEY });
    expect(models.map((m) => m.info.images)).toEqual([true, false, undefined]);

    expect(or.userMessage('hi')).toEqual({ role: 'user', content: 'hi' });
    expect(or.userMessage('what is this?', [{ mimeType: 'image/png', data: 'QUJD' }])).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
        { type: 'text', text: 'what is this?' },
      ],
    });
  });
});
