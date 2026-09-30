import { describe, expect, it } from 'vitest';

import { AnthropicWire, anthropicApiVariant } from './anthropic';
import { fakeFetch, jsonResponse, namedFrames, sseResponse, failure } from './fake';
import type { WireEvent, WireRequest } from './types';

// Deliberately not key-shaped: a test fixture shouldn't read like a credential
// to a person or a secret scanner. What we assert is that it never leaves the
// Authorization header.
const KEY = 'a-fake-anthropic-key';

function wire(handler: Parameters<typeof fakeFetch>[0]) {
  const fetch = fakeFetch(handler);
  return { wire: new AnthropicWire(fetch.fetch), calls: fetch.calls };
}

const MODELS = {
  data: [
    {
      type: 'model',
      id: 'claude-opus-5-20260401',
      display_name: 'Claude Opus 5',
      created_at: '2026-04-01T00:00:00Z',
      max_input_tokens: 200_000,
      max_tokens: 64_000,
      capabilities: {
        thinking: { types: { adaptive: {} } },
        effort: { low: {}, medium: {}, high: {}, xhigh: {} },
        image_input: true,
      },
    },
    {
      type: 'model',
      id: 'claude-haiku-4-5-20251001',
      display_name: 'Claude Haiku 4.5',
      created_at: '2025-10-01T00:00:00Z',
      max_input_tokens: 200_000,
      max_tokens: 8_192,
      capabilities: {},
    },
  ],
  has_more: false,
  last_id: 'claude-haiku-4-5-20251001',
};

function request(overrides: Partial<WireRequest> = {}): WireRequest {
  return {
    key: KEY,
    model: 'claude-opus-5-20260401',
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

describe('Anthropic keys', () => {
  it('checks a key by listing models, which spends nothing', async () => {
    const { wire: api, calls } = wire(() => jsonResponse(MODELS));

    expect(await api.check({ key: KEY })).toEqual({ description: 'Anthropic API key' });
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/models?limit=1');
    expect(calls[0]?.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(calls[0]?.headers['anthropic-version']).toBe('2023-06-01');
    expect(calls[0]?.url).not.toContain(KEY);
  });

  it('matches on the error type, not the message', async () => {
    const { wire: api } = wire(() =>
      jsonResponse(
        { type: 'error', error: { type: 'authentication_error', message: 'API key is invalid.' } },
        401,
      ),
    );

    const error = await failure(api.check({ key: KEY }));
    expect(error.kind).toBe('auth');
    expect(error.message).toBe('Anthropic API refused your key. Add a new one in Settings.');
  });
});

describe('Anthropic models', () => {
  it('maps the context window, the efforts and the newest first', async () => {
    const { wire: api } = wire(() => jsonResponse(MODELS));

    const models = await api.models({ key: KEY });

    expect(models.map((m) => m.info.id)).toEqual([
      'claude-opus-5-20260401',
      'claude-haiku-4-5-20251001',
    ]);
    expect(models[0]?.info).toEqual({
      id: 'claude-opus-5-20260401',
      label: 'Claude Opus 5',
      // `max_input_tokens` is the context window — there is no `context_window`.
      description: '200k context',
      efforts: ['low', 'medium', 'high', 'xhigh'],
      supportsFastMode: false,
      supportsAutoMode: false,
    });
    expect(models[0]?.thinking).toBe(true);
    expect(models[1]?.thinking).toBe(false);
    expect(models[1]?.info.efforts).toEqual([]);
  });

  it('follows the cursor when there is more than one page', async () => {
    const { wire: api, calls } = wire((call) =>
      call.url.includes('after_id')
        ? jsonResponse({ data: [MODELS.data[1]], has_more: false })
        : jsonResponse({
            data: [MODELS.data[0]],
            has_more: true,
            last_id: 'claude-opus-5-20260401',
          }),
    );

    expect((await api.models({ key: KEY })).length).toBe(2);
    expect(calls[1]?.url).toContain('after_id=claude-opus-5-20260401');
  });

  it('lists nothing without a key rather than guessing model names', async () => {
    const { wire: api, calls } = wire(() => jsonResponse(MODELS));
    expect(await api.models({})).toEqual([]);
    expect(calls.length).toBe(0);
  });

  it('resolves a small model from the list', async () => {
    const { wire: api } = wire(() => jsonResponse(MODELS));
    expect(api.smallModel()).toBeUndefined();
    await api.models({ key: KEY });
    expect(api.smallModel()).toBe('claude-haiku-4-5-20251001');
  });
});

describe('an Anthropic turn', () => {
  const STREAM = namedFrames(
    [
      'message_start',
      {
        type: 'message_start',
        message: { usage: { input_tokens: 500, output_tokens: 1, cache_read_input_tokens: 100 } },
      },
    ],
    ['ping', { type: 'ping' }],
    [
      'content_block_start',
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    ],
    [
      'content_block_delta',
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Let me ' },
      },
    ],
    [
      'content_block_delta',
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'check.' },
      },
    ],
    [
      'content_block_delta',
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sig-1' },
      },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'content_block_start',
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'redacted_thinking', data: 'opaque' },
      },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 1 }],
    [
      'content_block_start',
      { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
    ],
    [
      'content_block_delta',
      { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'One moment' } },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 2 }],
    [
      'content_block_start',
      {
        type: 'content_block_start',
        index: 3,
        content_block: {
          type: 'tool_use',
          id: 'toolu_01',
          name: 'mcp__conch__remember',
          input: {},
        },
      },
    ],
    [
      'content_block_delta',
      {
        type: 'content_block_delta',
        index: 3,
        delta: { type: 'input_json_delta', partial_json: '{"content":' },
      },
    ],
    [
      'content_block_delta',
      {
        type: 'content_block_delta',
        index: 3,
        delta: { type: 'input_json_delta', partial_json: '"tea"}' },
      },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 3 }],
    [
      'message_delta',
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 42 } },
    ],
    ['message_stop', { type: 'message_stop' }],
  );

  it('streams thinking and text, and keeps every block for replay', async () => {
    const { wire: api } = wire(() => sseResponse(STREAM, { chunk: 11 }));

    const events = await drain(api.stream(request()));

    expect(events.slice(0, 3)).toEqual([
      { type: 'thinking', delta: 'Let me ' },
      { type: 'thinking', delta: 'check.' },
      { type: 'text', delta: 'One moment' },
    ]);
    expect(events.at(-1)).toEqual({
      type: 'end',
      stop: 'tools',
      // input is the final count from message_start (cache reads included);
      // output is the last, cumulative message_delta.
      usage: { inputTokens: 600, outputTokens: 42 },
      toolCalls: [
        { id: 'toolu_01', name: 'mcp__conch__remember', argumentsJson: '{"content":"tea"}' },
      ],
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Let me check.', signature: 'sig-1' },
          // Filtering on type === 'thinking' would drop this and break the protocol.
          { type: 'redacted_thinking', data: 'opaque' },
          { type: 'text', text: 'One moment' },
          {
            type: 'tool_use',
            id: 'toolu_01',
            name: 'mcp__conch__remember',
            input: { content: 'tea' },
          },
        ],
      },
    });
  });

  it('sends the tools, and no sampling parameters at all', async () => {
    const { wire: api, calls } = wire(() =>
      sseResponse(namedFrames(['message_stop', { type: 'message_stop' }])),
    );

    await drain(api.stream(request()));

    const body = calls[0]?.body as Record<string, unknown>;
    expect(body['tools']).toEqual([
      {
        name: 'mcp__conch__remember',
        description: 'Save a fact.',
        input_schema: { type: 'object', properties: { content: { type: 'string' } } },
      },
    ]);
    expect(body['max_tokens']).toBe(16_384);
    expect(body['temperature']).toBeUndefined();
    expect(body['top_p']).toBeUndefined();
    expect(body['top_k']).toBeUndefined();
    expect(body['tool_choice']).toBeUndefined();
    expect(body['thinking']).toBeUndefined();
  });

  it('asks for adaptive thinking only where the model says it can', async () => {
    const { wire: api, calls } = wire((call) =>
      call.url.includes('/v1/models')
        ? jsonResponse(MODELS)
        : sseResponse(namedFrames(['message_stop', { type: 'message_stop' }])),
    );
    await api.models({ key: KEY });

    await drain(api.stream(request({ effort: 'high' })));
    expect((calls[1]?.body as Record<string, unknown>)['thinking']).toEqual({ type: 'adaptive' });
    expect((calls[1]?.body as Record<string, unknown>)['output_config']).toEqual({
      effort: 'high',
    });

    await drain(api.stream(request({ model: 'claude-haiku-4-5-20251001', effort: 'high' })));
    expect((calls[2]?.body as Record<string, unknown>)['thinking']).toBeUndefined();
    expect((calls[2]?.body as Record<string, unknown>)['output_config']).toBeUndefined();
  });

  it('reports an error that arrives mid-stream after a 200', async () => {
    const { wire: api } = wire(() =>
      sseResponse(
        namedFrames(
          ['message_start', { type: 'message_start', message: {} }],
          ['error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }],
        ),
      ),
    );

    const error = await failure(drain(api.stream(request())));
    expect(error.kind).toBe('overloaded');
    expect(error.retryable).toBe(true);
  });

  it('knows a spend-cap 429 will never succeed on retry', async () => {
    const capped = wire(() =>
      jsonResponse({ type: 'error', error: { type: 'rate_limit_error', message: 'cap' } }, 429),
    );
    const hard = await failure(drain(capped.wire.stream(request())));
    expect(hard.kind).toBe('payment');
    expect(hard.retryable).toBe(false);

    const limited = wire(() =>
      jsonResponse({ type: 'error', error: { type: 'rate_limit_error', message: 'slow' } }, 429, {
        'retry-after': '2',
      }),
    );
    const soft = await failure(drain(limited.wire.stream(request())));
    expect(soft.kind).toBe('rate-limit');
    expect(soft.retryable).toBe(true);
    expect(soft.retryAfterMs).toBe(2000);
  });

  it('answers a short prompt with the text blocks joined', async () => {
    const { wire: api, calls } = wire(() =>
      jsonResponse({
        type: 'message',
        content: [
          { type: 'text', text: 'Tea ' },
          { type: 'text', text: 'preferences' },
        ],
        usage: { input_tokens: 80, output_tokens: 4 },
      }),
    );

    expect(
      await api.complete({
        key: KEY,
        model: 'claude-haiku-4-5-20251001',
        system: 'Name chats.',
        prompt: 'Hello',
        maxTokens: 256,
        signal: new AbortController().signal,
      }),
    ).toEqual({ text: 'Tea preferences', usage: { inputTokens: 80, outputTokens: 4 } });
    expect((calls[0]?.body as Record<string, unknown>)['tools']).toBeUndefined();
  });

  it('sends every tool result back in one user message', () => {
    const { wire: api } = wire(() => jsonResponse({}));

    expect(
      api.toolResults([
        { id: 't1', name: 'a', text: 'ok', isError: false },
        { id: 't2', name: 'b', text: 'nope', isError: true },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
          { type: 'tool_result', tool_use_id: 't2', content: 'nope', is_error: true },
        ],
      },
    ]);
  });
});

describe('the Anthropic variant', () => {
  it('is paste-only and publishes no limits of its own', () => {
    const variant = anthropicApiVariant({ home: '/tmp/conch-home' });
    expect(variant.id).toBe('anthropic-api');
    expect(variant.canSignIn).toBe(false);
    // Anthropic publishes no balance, so Conch tracks spend itself.
    expect(variant.wire.usage).toBeUndefined();
  });
});

describe('Anthropic attachments', () => {
  it('sends images as base64 blocks before the words', () => {
    const { wire: api } = wire(() => jsonResponse({}));
    expect(api.userMessage('hi')).toEqual({ role: 'user', content: 'hi' });
    expect(
      api.userMessage('what is this?', [{ name: 'a.jpg', mimeType: 'image/jpeg', data: 'QUJD' }]),
    ).toEqual({
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
        { type: 'text', text: 'what is this?' },
      ],
    });
  });
});
