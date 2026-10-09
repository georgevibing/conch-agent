/**
 * Apps' tools that load when the model looks for them, on Anthropic (ADR 0072).
 *
 * With many apps connected, their tools go with `defer_loading: true` beside
 * Anthropic's tool search: sent whole every time, read only when found. These
 * tests hold the contract: only above a tenth of the window, never Conch's own
 * tools, the same bytes request after request, the cache breakpoints where the
 * API takes them, a model that refuses it asked again with every tool up front
 * (and remembered), and a found tool called through the same forgiving
 * arguments as any other.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { BridgedTool, EngineEvent, HostTool, TurnInput } from '../types';
import {
  AnthropicWire,
  cached,
  deferrable,
  knownReferences,
  SEARCH_NOTE,
  searchRefused,
  TOOL_SEARCH,
  withoutSearch,
} from './anthropic';
import { ApiEngine } from './engine';
import { collect, fakeFetch, fakeHome, jsonResponse, namedFrames, sseResponse } from './fake';
import type { FakeCall } from './fake';
import type { WireEvent, WireMessage, WireRequest } from './types';

const KEY = 'a-fake-anthropic-key';
const MODEL = 'claude-sonnet-5';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

interface Body {
  tools?: Record<string, unknown>[];
  system?: { text: string }[];
  messages: WireMessage[];
}

const spec = (name: string, description = `${name}.`) => ({
  name,
  description,
  schema: { type: 'object', properties: { query: { type: 'string' } } },
});

function request(overrides: Partial<WireRequest> = {}): WireRequest {
  return {
    key: KEY,
    model: MODEL,
    system: 'You are Pearl.',
    messages: [{ role: 'user', content: 'Find my notes' }],
    tools: [spec('mcp__conch__remember'), spec('mcp__notion__search'), spec('mcp__linear__find')],
    deferred: ['mcp__notion__search', 'mcp__linear__find'],
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

/** Every cache breakpoint in a body. */
function marks(body: Body): number {
  const all = [
    ...(body.tools ?? []),
    ...(body.system ?? []),
    ...body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])),
  ];
  return all.filter((b) => isRecord(b) && 'cache_control' in b).length;
}

const ENDED = namedFrames(
  [
    'content_block_start',
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  ],
  [
    'content_block_delta',
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } },
  ],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  [
    'message_delta',
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
  ],
  ['message_stop', { type: 'message_stop' }],
);

/** A reply that searches, finds `mcp__notion__search`, and calls it with a sloppy limit. */
const SEARCHED = namedFrames(
  [
    'message_start',
    { type: 'message_start', message: { usage: { input_tokens: 900, output_tokens: 1 } } },
  ],
  [
    'content_block_start',
    {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'server_tool_use',
        id: 'srvtoolu_1',
        name: 'tool_search_tool_regex',
        input: {},
      },
    },
  ],
  [
    'content_block_delta',
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"pattern":' },
    },
  ],
  [
    'content_block_delta',
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '"notion"}' },
    },
  ],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  [
    'content_block_start',
    {
      type: 'content_block_start',
      index: 1,
      content_block: {
        type: 'tool_search_tool_result',
        tool_use_id: 'srvtoolu_1',
        content: {
          type: 'tool_search_tool_search_result',
          tool_references: [{ type: 'tool_reference', tool_name: 'mcp__notion__search' }],
        },
      },
    },
  ],
  ['content_block_stop', { type: 'content_block_stop', index: 1 }],
  [
    'content_block_start',
    {
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'mcp__notion__search', input: {} },
    },
  ],
  [
    'content_block_delta',
    {
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'input_json_delta', partial_json: '{"query":"plans","limit":"3"}' },
    },
  ],
  ['content_block_stop', { type: 'content_block_stop', index: 2 }],
  [
    'message_delta',
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 40 } },
  ],
  ['message_stop', { type: 'message_stop' }],
);

describe('the tools block, with apps’ tools waiting to be searched for', () => {
  it('puts the search first, Conch’s own next with the breakpoint, and the apps’ last, deferred', () => {
    const body = cached(request(), new Set(request().deferred)) as Body;
    expect(body.tools?.[0]).toEqual(TOOL_SEARCH);
    expect(body.tools?.[1]).toMatchObject({
      name: 'mcp__conch__remember',
      cache_control: { type: 'ephemeral' },
    });
    expect(body.tools?.[1]).not.toHaveProperty('defer_loading');
    for (const tool of body.tools?.slice(2) ?? []) {
      expect(tool).toMatchObject({ defer_loading: true });
      // A deferred tool can't carry a breakpoint: the API refuses it.
      expect(tool).not.toHaveProperty('cache_control');
    }
    expect(body.system?.[0]?.text).toContain(SEARCH_NOTE);
    expect(marks(body)).toBeLessThanOrEqual(4);
  });

  it('is the plain list, exactly as before, when nothing waits', () => {
    const body = cached(request({ deferred: [] })) as Body;
    expect(body.tools?.map((t) => t.name)).toEqual([
      'mcp__conch__remember',
      'mcp__notion__search',
      'mcp__linear__find',
    ]);
    expect(JSON.stringify(body)).not.toContain('defer_loading');
    expect(body.tools?.at(-1)).toHaveProperty('cache_control');
    expect(body.system?.[0]?.text).toBe('You are Pearl.');
  });

  it('is the same bytes on every request of a chat, so the cached prefix holds', async () => {
    const api = fakeFetch(() => sseResponse(ENDED));
    const wire = new AnthropicWire(api.fetch);
    const history: WireMessage[] = [{ role: 'user', content: 'Find my notes' }];
    for (let i = 0; i < 3; i++) {
      await drain(wire.stream(request({ messages: [...history] })));
      history.push({ role: 'assistant', content: [{ type: 'text', text: 'Done.' }] });
      history.push({ role: 'user', content: `And again ${i}` });
    }
    const bodies = api.calls.map((c) => c.body as Body);
    const tools = bodies.map((b) => JSON.stringify(b.tools));
    const system = bodies.map((b) => JSON.stringify(b.system));
    expect(new Set(tools).size).toBe(1);
    expect(new Set(system).size).toBe(1);
    expect(tools[0]).toContain('defer_loading');
    for (const body of bodies) expect(marks(body)).toBeLessThanOrEqual(4);
  });

  it('keeps loaded a tool the chat called where its finding was summarised away', () => {
    const left = deferrable(
      request({
        messages: [
          { role: 'user', content: 'Earlier' },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 't', name: 'mcp__linear__find', input: {} }],
          },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] },
        ],
      }),
    );
    expect([...left]).toEqual(['mcp__notion__search']);
  });

  it('still defers a tool whose finding is in the chat', () => {
    const left = deferrable(
      request({
        messages: [
          { role: 'user', content: 'Earlier' },
          {
            role: 'assistant',
            content: [
              {
                type: 'server_tool_use',
                id: 's',
                name: 'tool_search_tool_regex',
                input: { pattern: 'linear' },
              },
              {
                type: 'tool_search_tool_result',
                tool_use_id: 's',
                content: {
                  type: 'tool_search_tool_search_result',
                  tool_references: [{ type: 'tool_reference', tool_name: 'mcp__linear__find' }],
                },
              },
              { type: 'tool_use', id: 't', name: 'mcp__linear__find', input: {} },
            ],
          },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] },
        ],
      }),
    );
    expect([...left].sort()).toEqual(['mcp__linear__find', 'mcp__notion__search']);
  });

  it('never defers every tool, nor one it wasn’t sent', () => {
    expect(
      deferrable(
        request({ tools: [spec('mcp__notion__search')], deferred: ['mcp__notion__search'] }),
      ).size,
    ).toBe(0);
    expect([
      ...deferrable(request({ deferred: ['mcp__nowhere__x', 'mcp__notion__search'] })),
    ]).toEqual(['mcp__notion__search']);
  });
});

describe('a reply that searched', () => {
  it('keeps the search’s blocks verbatim for replay, and hands back only the call Conch answers', async () => {
    const wire = new AnthropicWire(fakeFetch(() => sseResponse(SEARCHED, { chunk: 13 })).fetch);
    const end = (await drain(wire.stream(request()))).at(-1);
    if (end?.type !== 'end') throw new Error('no end');
    const content = end.message.content as Record<string, unknown>[];
    expect(content[0]).toEqual({
      type: 'server_tool_use',
      id: 'srvtoolu_1',
      name: 'tool_search_tool_regex',
      input: { pattern: 'notion' },
    });
    expect(content[1]).toMatchObject({
      type: 'tool_search_tool_result',
      tool_use_id: 'srvtoolu_1',
    });
    expect(end.toolCalls).toEqual([
      {
        id: 'toolu_1',
        name: 'mcp__notion__search',
        argumentsJson: '{"query":"plans","limit":"3"}',
      },
    ]);
    expect(end.stop).toBe('tools');
  });

  it('says a paused turn is paused, so the model is asked to carry on', async () => {
    const paused = namedFrames(
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'pause_turn' } }],
      ['message_stop', { type: 'message_stop' }],
    );
    const wire = new AnthropicWire(fakeFetch(() => sseResponse(paused)).fetch);
    expect((await drain(wire.stream(request()))).at(-1)).toMatchObject({
      type: 'end',
      stop: 'pause',
    });
  });
});

describe('a model that refuses tool search', () => {
  const refusal = () =>
    jsonResponse(
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: "tools.0: 'tool_search_tool_regex_20251119' is not supported for this model",
        },
      },
      400,
    );
  const searchedBefore: WireMessage[] = [
    { role: 'user', content: 'Find my notes' },
    {
      role: 'assistant',
      content: [
        {
          type: 'server_tool_use',
          id: 's',
          name: 'tool_search_tool_regex',
          input: { pattern: 'notion' },
        },
        {
          type: 'tool_search_tool_result',
          tool_use_id: 's',
          content: { type: 'tool_search_tool_search_result', tool_references: [] },
        },
        { type: 'text', text: 'Nothing found.' },
      ],
    },
    { role: 'user', content: 'Try again' },
  ];

  it('is asked again at once with every tool up front and no search blocks, and remembered', async () => {
    let refused = 0;
    const api = fakeFetch((call) => {
      if (JSON.stringify(call.body).includes('defer_loading')) {
        refused++;
        return refusal();
      }
      return sseResponse(ENDED);
    });
    const wire = new AnthropicWire(api.fetch);
    const events = await drain(wire.stream(request({ messages: searchedBefore })));
    expect(events.at(-1)).toMatchObject({ type: 'end', stop: 'end' });
    const healed = api.calls[1]?.body as Body;
    expect(healed.tools?.map((t) => t.name)).toEqual([
      'mcp__conch__remember',
      'mcp__notion__search',
      'mcp__linear__find',
    ]);
    expect(JSON.stringify(healed)).not.toMatch(/tool_search|defer_loading|server_tool_use/);
    expect(healed.messages[1]?.content).toEqual([{ type: 'text', text: 'Nothing found.' }]);
    // Remembered: the next request doesn't try again.
    expect(wire.defersTools(MODEL)).toBe(false);
    await drain(wire.stream(request()));
    expect(refused).toBe(1);
    expect(api.calls).toHaveLength(3);
  });

  it('says any other 400 as it is', async () => {
    const api = fakeFetch(() =>
      jsonResponse(
        { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: too big' } },
        400,
      ),
    );
    await expect(drain(new AnthropicWire(api.fetch).stream(request()))).rejects.toThrow(
      'max_tokens',
    );
    expect(api.calls).toHaveLength(1);
  });

  it('knows a 400 about tool search from one about something else', () => {
    expect(searchRefused('tool_search_tool_regex_20251119 is not supported')).toBe(true);
    expect(searchRefused('At least one tool must have defer_loading=false.')).toBe(true);
    expect(searchRefused("Tool reference 'x' not found in available tools")).toBe(true);
    expect(searchRefused('tool_reference blocks are not allowed')).toBe(true);
    expect(searchRefused('tools.3.input_schema: invalid')).toBe(false);
  });

  it('isn’t tried on models from before tool search, nor through Bedrock or Vertex', () => {
    const wire = new AnthropicWire(fakeFetch(() => sseResponse(ENDED)).fetch);
    expect(wire.defersTools('claude-opus-4-1-20250805')).toBe(false);
    expect(wire.defersTools('claude-sonnet-4-20250514')).toBe(false);
    expect(wire.defersTools('claude-3-5-haiku-20241022')).toBe(false);
    expect(wire.defersTools('claude-sonnet-4-5-20250929')).toBe(true);
    expect(wire.defersTools('claude-haiku-4-5')).toBe(true);
    expect(wire.defersTools('claude-opus-5-5')).toBe(true);
    const routed = new AnthropicWire(fakeFetch(() => sseResponse(ENDED)).fetch, {
      voice: { label: 'Bedrock', refused: '' },
      prepare: async ({ body }) => ({ url: 'https://example.com', headers: {}, body }),
      list: async () => [],
      check: async () => ({ description: '' }),
    });
    expect(routed.defersTools('claude-opus-5-5')).toBe(false);
  });

  it('forgets a finding whose tool is no longer sent (an app since disconnected)', () => {
    const found: WireMessage[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_search_tool_result',
            tool_use_id: 's',
            content: {
              type: 'tool_search_tool_search_result',
              tool_references: [
                { type: 'tool_reference', tool_name: 'mcp__notion__search' },
                { type: 'tool_reference', tool_name: 'mcp__gone__tool' },
              ],
            },
          },
        ],
      },
    ];
    const kept = knownReferences(found, new Set(['mcp__notion__search']));
    expect(JSON.stringify(kept)).not.toContain('mcp__gone__tool');
    expect(JSON.stringify(kept)).toContain('mcp__notion__search');
    expect(knownReferences(found, new Set(['mcp__notion__search', 'mcp__gone__tool']))[0]).toBe(
      found[0],
    );
  });

  it('strips only the search’s own blocks', () => {
    const out = withoutSearch(searchedBefore);
    expect(out[0]).toBe(searchedBefore[0]);
    expect(out[1]?.content).toEqual([{ type: 'text', text: 'Nothing found.' }]);
  });
});

// ── Through the engine ────────────────────────────────────────────────────

const remember: HostTool<{ content: z.ZodString }> = {
  name: 'remember',
  description: 'Save a fact.',
  input: { content: z.string() },
  run: async () => 'Saved.',
};

/** An app with `n` tools, each about 600 tokens of definition. */
function app(server: string, n: number, ran: unknown[] = []): BridgedTool[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `mcp__${server}__tool_${i}`,
    description: `Tool ${i} of ${server}. `.padEnd(
      2_400,
      'It does one thing in the app, with options. ',
    ),
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'integer' } },
      required: ['query'],
    },
    run: async (args) => {
      ran.push(args);
      return { text: 'Found 3 pages.', isError: false };
    },
  }));
}

async function engineWith(handler: (call: FakeCall, step: number) => Response) {
  const { home, settings, keys } = await fakeHome();
  await keys.save('anthropic-api', KEY);
  let step = 0;
  const api = fakeFetch((call) => {
    if (call.url.includes('/v1/models'))
      return jsonResponse({
        data: [{ id: MODEL, display_name: 'Claude Sonnet 5', max_input_tokens: 200_000 }],
        has_more: false,
      });
    return handler(call, ++step);
  });
  const engine = new ApiEngine(
    {
      id: 'anthropic-api',
      label: 'Anthropic API',
      docsUrl: '',
      keyUrl: '',
      canSignIn: false,
      wire: new AnthropicWire(api.fetch),
      home,
    },
    settings,
    keys,
  );
  const sent = () =>
    api.calls.filter((c) => c.url.endsWith('/v1/messages')).map((c) => c.body as Body);
  return { engine, sent };
}

function turn(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    conversationId: 'c_search',
    prompt: 'Find my Notion plans',
    systemAppend: '# Who you are\nYou are Pearl.',
    cwd: process.cwd(),
    tools: [remember as HostTool],
    requestPermission: async () => 'allow',
    signal: new AbortController().signal,
    options: { model: MODEL, effort: 'auto', fastMode: false, permissionMode: 'default' },
    ...overrides,
  };
}

const deferredNames = (body: Body | undefined) =>
  (body?.tools ?? []).filter((t) => t.defer_loading).map((t) => String(t.name));

describe('apps’ tools on the Anthropic API, through the engine', () => {
  it('stay loaded while every tool fits in a tenth of the window', async () => {
    const { engine, sent } = await engineWith(() => sseResponse(ENDED));
    await collect(engine.runTurn(turn({ bridgedTools: app('notion', 3) })));
    const body = sent()[0];
    expect(JSON.stringify(body?.tools)).not.toContain('defer_loading');
    expect(body?.tools?.map((t) => t.name)).not.toContain(TOOL_SEARCH.name);
  });

  it('wait to be searched for past it, Conch’s own never; a found one runs through the forgiving arguments', async () => {
    const ran: unknown[] = [];
    const { engine, sent } = await engineWith((_call, step) =>
      sseResponse(step === 1 ? SEARCHED : ENDED),
    );
    const bridgedTools = [
      ...app('notion', 20, ran),
      ...app('linear', 20).map((t) => ({ ...t, name: t.name.replace('tool_0', 'search') })),
    ];
    // The model calls `mcp__notion__search`: make it one of the notion tools.
    bridgedTools[0] = { ...(bridgedTools[0] as BridgedTool), name: 'mcp__notion__search' };

    const first = await collect(engine.runTurn(turn({ bridgedTools })));
    expect(first.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
    const resumeId = (
      first.find((e) => e.type === 'session') as Extract<EngineEvent, { type: 'session' }>
    ).resumeId;
    await collect(engine.runTurn(turn({ bridgedTools, resumeId, prompt: 'Thanks' })));

    const bodies = sent();
    expect(bodies).toHaveLength(3);
    const body = bodies[0] as Body;
    expect(body.tools?.[0]).toEqual(TOOL_SEARCH);
    // Every app tool waits; Conch's own (memory here) never does.
    expect(deferredNames(body).sort()).toEqual(bridgedTools.map((t) => t.name).sort());
    expect(deferredNames(body)).not.toContain('mcp__conch__remember');
    expect(body.tools?.find((t) => t.name === 'mcp__conch__remember')).toHaveProperty(
      'cache_control',
    );
    // The same tools block and system prompt, byte for byte, request after request and turn after turn.
    expect(new Set(bodies.map((b) => JSON.stringify(b.tools))).size).toBe(1);
    expect(new Set(bodies.map((b) => JSON.stringify(b.system))).size).toBe(1);
    for (const b of bodies) expect(marks(b)).toBeLessThanOrEqual(4);

    // The found tool ran with its arguments read forgivingly ("3" is the number 3).
    expect(ran).toEqual([{ query: 'plans', limit: 3 }]);
    // The search went back verbatim, with the call's answer after it.
    const second = bodies[1] as Body;
    const reply = second.messages.at(-2);
    expect(JSON.stringify(reply?.content)).toContain('"type":"server_tool_use"');
    expect(JSON.stringify(reply?.content)).toContain('"type":"tool_search_tool_result"');
    expect(JSON.stringify(second.messages.at(-1)?.content)).toContain('"tool_use_id":"toolu_1"');
  });

  it('heals a refusal before the model says a word, and the turn goes on', async () => {
    const { engine, sent } = await engineWith((call) =>
      JSON.stringify(call.body).includes('defer_loading')
        ? jsonResponse(
            {
              type: 'error',
              error: {
                type: 'invalid_request_error',
                message: 'tool_search_tool_regex is not available',
              },
            },
            400,
          )
        : sseResponse(ENDED),
    );
    const events = await collect(engine.runTurn(turn({ bridgedTools: app('notion', 40) })));
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
    const bodies = sent();
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1]?.tools)).not.toContain('defer_loading');
  });
});
