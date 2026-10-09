/**
 * A provider a Conch app declares or writes (ADR 0122), as the engine's
 * wire: a declared one streams through the shared chat adapters at its own
 * address, with its key the way it said and its spend at its own price; one
 * in code streams from its sealed `provider.chat`, tool calls and all, in a
 * shape the transcript keeps.
 */
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConchAppManifest } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { createRuntime, type SealedRuntime } from '../conchapps/runtime';
import type { FetchLike, WireEvent } from '../engines/api/types';
import { partVariant, partWire } from './provider';
import { codeError } from './sealed-wire';

const running: SealedRuntime[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((r) => r.stop()));
});

const manifest = (provider: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ConchAppManifest.parse({
    conch: 1,
    id: 'example',
    name: 'Example AI',
    tagline: 'Example models',
    version: '1.0.0',
    icon: { glyph: 'zap', color: 'blue' },
    reaches: ['api.example.com'],
    provider,
    ...extra,
  }) as ConchAppManifest & { provider: NonNullable<ConchAppManifest['provider']> };

/** A pretend company: what was asked, and a streamed answer. */
function company() {
  const asked: { url: string; headers: Headers; body: unknown }[] = [];
  const fetch: FetchLike = async (input, init) => {
    const request = new Request(input, init);
    asked.push({
      url: request.url,
      headers: request.headers,
      body: request.method === 'POST' ? await request.json() : undefined,
    });
    if (request.url.endsWith('/messages'))
      return new Response(
        [
          'event: message_start\ndata: {"type":"message_start","message":{"id":"m","role":"assistant","content":[],"usage":{"input_tokens":9,"output_tokens":0}}}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi from Messages"}}\n\n',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ].join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    if (request.url.endsWith('/models'))
      return Response.json({ data: [{ id: 'open-1' }, { id: 'open-2' }] });
    const frames = [
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ' there' } }] },
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      },
    ];
    return new Response(
      `${frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')}data: [DONE]\n\n`,
      {
        headers: { 'content-type': 'text/event-stream' },
      },
    );
  };
  return { fetch, asked };
}

async function collect(stream: AsyncIterable<WireEvent>) {
  const events: WireEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const request = {
  key: 'k-1',
  system: 'Be brief.',
  messages: [{ role: 'user', content: 'hi' }],
  tools: [],
  effort: 'auto' as const,
  signal: new AbortController().signal,
};

describe('a declared provider (OpenAI’s chat)', () => {
  it('streams a reply from its own address, and counts it at its declared price', async () => {
    const { fetch, asked } = company();
    const wire = partWire({
      engineId: 'app-example',
      manifest: manifest({
        speaks: 'openai',
        address: 'https://api.example.com/v1',
        key: { label: 'Example key' },
        models: [{ id: 'ex-1', name: 'Example One', price: { input: 2, output: 10 } }],
      }),
      runtime: () => Promise.reject(new Error('no code')),
      fetch,
    });
    const events = await collect(wire.stream({ ...request, model: 'ex-1' }));
    expect(
      events.filter((e) => e.type === 'text').map((e) => e.type === 'text' && e.delta),
    ).toEqual(['Hello', ' there']);
    const end = events.at(-1);
    // 1,000 in at $2 a million and 500 out at $10: a cent's worth.
    expect(end).toMatchObject({ type: 'end', stop: 'end', usage: { costUsd: 0.007 } });
    expect(asked.at(-1)?.url).toBe('https://api.example.com/v1/chat/completions');
    expect(asked.at(-1)?.headers.get('authorization')).toBe('Bearer k-1');
  });

  it('lists the models it declared, or reads them live from its address', async () => {
    const declared = partWire({
      engineId: 'app-example',
      manifest: manifest({
        speaks: 'openai',
        address: 'https://api.example.com/v1',
        auth: 'none',
        models: [{ id: 'ex-1', name: 'Example One', context: 64000, images: true }],
      }),
      runtime: () => Promise.reject(new Error('no code')),
      fetch: company().fetch,
    });
    expect(
      (await declared.models({})).map((m) => [m.info.id, m.info.label, m.info.context]),
    ).toEqual([['ex-1', 'Example One', 64000]]);
    expect(declared.seesFor?.('ex-1')).toBe(true);
    const live = partWire({
      engineId: 'app-example',
      manifest: manifest({ speaks: 'openai', address: 'https://api.example.com/v1', auth: 'none' }),
      runtime: () => Promise.reject(new Error('no code')),
      fetch: company().fetch,
    });
    expect((await live.models({})).map((m) => m.info.id).sort()).toEqual(['open-1', 'open-2']);
  });

  it('is a provider with no key when it says so, and one whose key is optional', () => {
    const variant = (provider: Record<string, unknown>) =>
      partVariant({
        engineId: 'app-example',
        manifest: manifest(provider),
        runtime: () => Promise.reject(new Error('no code')),
        fetch: company().fetch,
      });
    expect(
      variant({ speaks: 'openai', address: 'https://api.example.com/v1', auth: 'none' }),
    ).toMatchObject({
      keyless: true,
      label: 'Example AI',
    });
    expect(
      variant({
        speaks: 'openai',
        address: 'https://api.example.com/v1',
        key: { label: 'Key', optional: true, link: 'https://api.example.com/keys' },
      }),
    ).toMatchObject({ keyOptional: true, keyUrl: 'https://api.example.com/keys' });
  });
});

describe('a declared provider (Anthropic’s Messages)', () => {
  it('streams from its own address, with the Messages version and its key', async () => {
    const { fetch, asked } = company();
    const wire = partWire({
      engineId: 'app-example',
      manifest: manifest({
        speaks: 'anthropic',
        address: 'https://api.example.com',
        key: { label: 'Key' },
        models: [{ id: 'claude-like' }],
      }),
      runtime: () => Promise.reject(new Error('no code')),
      fetch,
    });
    const events = await collect(wire.stream({ ...request, model: 'claude-like' }));
    expect(
      events
        .filter((e) => e.type === 'text')
        .map((e) => e.type === 'text' && e.delta)
        .join(''),
    ).toBe('Hi from Messages');
    const sent = asked.find((a) => a.url.endsWith('/v1/messages'));
    expect(sent?.url).toBe('https://api.example.com/v1/messages');
    expect(sent?.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(sent?.headers.get('authorization')).toBe('Bearer k-1');
  });
});

describe('a provider in code', () => {
  async function coded(code: string) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'conch provider ')));
    await mkdir(join(root, 'files'), { recursive: true });
    await writeFile(join(root, 'files', 'provider.mjs'), code);
    const m = manifest(
      {
        speaks: 'code',
        key: { label: 'Key' },
        models: [{ id: 'c-1', name: 'Coded One', tools: true }],
      },
      { tools: 'provider.mjs' },
    );
    const runtime = createRuntime({
      appDir: join(root, 'files'),
      dataDir: join(root, 'data'),
      manifest: m,
      settings: async () => ({}),
      fetcher: async () => ({ ok: false, status: 0, headers: {}, body: '', refused: 'no' }),
    });
    running.push(runtime);
    return partWire({
      engineId: 'app-example',
      manifest: m,
      runtime: async () => runtime,
      fetch: company().fetch,
    });
  }

  it('streams its answer from the sealed process, and the transcript keeps OpenAI’s shape', async () => {
    const wire = await coded(`export const provider = {
      async chat({ model, messages, tools }, app) {
        app.emit({ type: 'text', delta: 'Hello from code (' + model + ', ' + (tools?.length ?? 0) + ' tools, key ' + app.keys.key + ')' });
        return { usage: { input: 12, output: 7 } };
      },
    };`);
    const events = await collect(
      wire.stream({
        ...request,
        model: 'c-1',
        tools: [{ name: 'read_file', description: 'Reads a file.', schema: { type: 'object' } }],
      }),
    );
    expect(events.map((e) => e.type)).toEqual(['text', 'end']);
    expect(events[0]).toEqual({ type: 'text', delta: 'Hello from code (c-1, 1 tools, key k-1)' });
    expect(events[1]).toMatchObject({
      type: 'end',
      stop: 'end',
      message: { role: 'assistant', content: 'Hello from code (c-1, 1 tools, key k-1)' },
      usage: { inputTokens: 12, outputTokens: 7 },
    });
  });

  it('asks for tools as OpenAI’s tool calls', async () => {
    const wire = await coded(`export const provider = {
      async chat() {
        return { toolCalls: [{ id: 'call_1', name: 'read_file', arguments: { path: 'notes.md' } }] };
      },
    };`);
    const end = (await collect(wire.stream({ ...request, model: 'c-1' }))).at(-1);
    expect(end).toMatchObject({
      type: 'end',
      stop: 'tools',
      toolCalls: [{ id: 'call_1', name: 'read_file', argumentsJson: '{"path":"notes.md"}' }],
      message: {
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"notes.md"}' },
          },
        ],
      },
    });
    expect(
      wire.toolResults([{ id: 'call_1', name: 'read_file', text: 'hi', isError: false }]),
    ).toEqual([{ role: 'tool', tool_call_id: 'call_1', content: 'hi' }]);
  });

  it('turns what its code threw into the failure the engine reacts to', async () => {
    const wire = await coded(`export const provider = {
      async chat() { throw new Error('Example AI said 401: invalid api key'); },
    };`);
    await expect(collect(wire.stream({ ...request, model: 'c-1' }))).rejects.toMatchObject({
      kind: 'auth',
    });
    expect(codeError('X', 'said 429').kind).toBe('rate-limit');
    expect(codeError('X', 'said 503: overloaded')).toMatchObject({
      kind: 'overloaded',
      retryable: true,
    });
    expect(codeError('X', 'something odd').message).toBe('X: something odd');
  });
});
