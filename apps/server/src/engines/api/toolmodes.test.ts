/**
 * Every model gets its tools (ADR 0069): a fake-fetch matrix over the ways a
 * provider can take them, refuse them, or not know a model at all.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { EngineEvent, HostTool, TurnInput } from '../types';
import { ApiEngine } from './engine';
import {
  collect,
  dataFrames,
  fakeFetch,
  fakeHome,
  jsonResponse,
  sseResponse,
  type FakeCall,
} from './fake';
import { OpenAiWire } from './openai';
import { OpenRouterWire } from './openrouter';
import { PRESETS } from './presets';
import { defaultHome } from './session';
import type { ApiProviderId, ApiVariant, FetchLike } from './types';
import type { Wire } from './wire';

const KEY = 'sk-or-v1-secret-key-value';

/** OpenRouter's list: `count` models, the picker's 60 first; tool support as `tools(i)` says. */
function catalogue(count: number, tools: (i: number) => boolean) {
  return {
    data: Array.from({ length: count }, (_, i) => ({
      id: `lab/model-${i}`,
      name: `Model ${i}`,
      context_length: 128_000,
      pricing: { prompt: '0.000001', completion: '0.000002' },
      supported_parameters: tools(i) ? ['tools', 'tool_choice'] : ['temperature'],
    })),
  };
}

/** A streamed answer in the chat shape, saying `text`. */
function says(text: string) {
  return sseResponse(
    dataFrames(
      JSON.stringify({ choices: [{ delta: { content: text } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 5 } }),
      '[DONE]',
    ),
  );
}

/** A native tool call, streamed. */
function calls(name: string, args: string) {
  return sseResponse(
    dataFrames(
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', type: 'function', function: { name, arguments: args } },
              ],
            },
          },
        ],
      }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      '[DONE]',
    ),
  );
}

function rememberTool(saved: string[]): HostTool {
  const tool: HostTool<{
    content: z.ZodString;
    kind: z.ZodOptional<z.ZodEnum<{ fact: 'fact'; preference: 'preference' }>>;
  }> = {
    name: 'remember',
    description: 'Save one durable fact about the person.',
    input: { content: z.string().min(1), kind: z.enum(['fact', 'preference']).optional() },
    run: async ({ content }) => {
      saved.push(content);
      return 'Saved to memory.';
    },
  };
  return tool as HostTool;
}

function turn(model: string, tools: HostTool[], overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    conversationId: 'c_1',
    prompt: 'Remember I like tea',
    systemAppend: 'You are Pearl.',
    cwd: process.cwd(),
    tools,
    // Only Conch's own tools: these tests are about how they reach the model.
    disallowedTools: ['Read', 'LS', 'Write', 'Edit', 'Bash'],
    requestPermission: async () => 'allow',
    signal: new AbortController().signal,
    options: { model, effort: 'auto', fastMode: false, permissionMode: 'default' },
    ...overrides,
  };
}

async function engineWith(wire: Wire, id: ApiProviderId = 'openrouter') {
  const { home, settings, keys } = await fakeHome();
  await keys.save(id, KEY);
  const variant: ApiVariant = {
    id,
    label: id === 'openrouter' ? 'OpenRouter' : 'Provider',
    docsUrl: 'https://example.com',
    keyUrl: 'https://example.com',
    canSignIn: false,
    wire,
    home: home ?? defaultHome(),
  };
  return new ApiEngine(variant, settings, keys);
}

const isChat = (call: FakeCall) => call.url.endsWith('/chat/completions');
const chatBodies = (all: FakeCall[]) =>
  all.filter(isChat).map((c) => c.body as Record<string, unknown>);
const systemOf = (body: Record<string, unknown> | undefined) =>
  ((body?.messages as { role: string; content: string }[] | undefined)?.[0]?.content ??
    '') as string;

function openRouter(handler: (call: FakeCall) => Response | Promise<Response>) {
  const fetch = fakeFetch(handler);
  return { wire: new OpenRouterWire(fetch.fetch as FetchLike), calls: fetch.calls };
}

describe('OpenRouter: tool support for any model, not just the picker’s first 60', () => {
  it('sends tools natively to a model outside the top 60 that takes them', async () => {
    const { wire, calls } = openRouter((call) =>
      isChat(call) ? says('Saved.') : jsonResponse(catalogue(200, (i) => i % 2 === 0)),
    );
    const engine = await engineWith(wire);
    expect((await engine.capabilities()).models).toHaveLength(60);
    const events = await collect(engine.runTurn(turn('lab/model-150', [rememberTool([])])));
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
    expect(chatBodies(calls)[0]?.tools).toBeDefined();
    expect(events.find((e) => e.type === 'notice')).toBeUndefined();
  });

  it('gives tools in words to a model outside the top 60 that can’t take them', async () => {
    const { wire, calls } = openRouter((call) =>
      isChat(call) ? says('Hello.') : jsonResponse(catalogue(100, (i) => i < 70)),
    );
    const engine = await engineWith(wire);
    await collect(engine.runTurn(turn('lab/model-90', [rememberTool([])])));
    const body = chatBodies(calls)[0];
    expect(body?.tools).toBeUndefined();
    expect(systemOf(body)).toContain(
      '- mcp__conch__remember({content: string, kind?: "fact"|"preference"})',
    );
  });

  it('counts a model it can’t look up as able when the list never came (ADR 0050)', async () => {
    const { wire, calls } = openRouter((call) =>
      isChat(call) ? says('Hi.') : jsonResponse({ error: { message: 'down' } }, 503),
    );
    const engine = await engineWith(wire);
    expect((await engine.capabilities()).models).toEqual([]);
    const events = await collect(engine.runTurn(turn('lab/anything', [rememberTool([])])));
    expect(chatBodies(calls)[0]?.tools).toBeDefined();
    expect(events.find((e) => e.type === 'notice' && e.code === 'chat-only')).toBeUndefined();
  });

  it('looks a model up in the public catalogue, once, when the account’s list doesn’t have it', async () => {
    const { wire, calls } = openRouter((call) => {
      if (isChat(call)) return says('Hi.');
      if (call.url.endsWith('/models/user')) return jsonResponse(catalogue(10, () => true));
      return jsonResponse(catalogue(200, (i) => i !== 150));
    });
    const engine = await engineWith(wire);
    await engine.capabilities();
    await collect(engine.runTurn(turn('lab/model-150', [rememberTool([])])));
    await collect(engine.runTurn(turn('lab/model-150', [rememberTool([])])));
    expect(chatBodies(calls).map((b) => b.tools === undefined)).toEqual([true, true]);
    expect(calls.filter((c) => c.url.endsWith('/models')).length).toBe(1);
  });

  it('gives Google’s models the Gemini dialect of a schema', async () => {
    const { wire, calls } = openRouter((call) =>
      isChat(call) ? says('Hi.') : jsonResponse({ data: [] }),
    );
    const engine = await engineWith(wire);
    const bridged = {
      name: 'mcp__linear__create',
      description: 'Create an issue.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          due: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        additionalProperties: false,
      },
      run: async () => ({ text: 'ok', isError: false }),
    };
    await collect(engine.runTurn(turn('google/gemini-3-pro', [], { bridgedTools: [bridged] })));
    const sent = JSON.stringify(chatBodies(calls)[0]?.tools);
    expect(sent).not.toContain('additionalProperties');
    expect(sent).toContain('"nullable":true');
  });
});

describe('a provider that refuses tools never leaves the model without them', () => {
  it('reads OpenRouter’s “no endpoints support tool use” as tools in words, not chat-only, and runs the call', async () => {
    const saved: string[] = [];
    let chat = 0;
    const { wire, calls } = openRouter((call) => {
      if (!isChat(call)) return jsonResponse({ data: [] });
      chat++;
      if ((call.body as { tools?: unknown }).tools)
        return jsonResponse(
          {
            error: {
              code: 404,
              message: 'No endpoints found that support tool use. Try disabling "tools".',
            },
          },
          404,
        );
      return chat === 2
        ? says(
            'Saving it.\n<tool_call>\n{"name": "remember", "arguments": {"content": "Likes tea"}}\n</tool_call>',
          )
        : says('Done — I’ll remember you like tea.');
    });
    const engine = await engineWith(wire);
    const events = await collect(engine.runTurn(turn('lab/tiny', [rememberTool(saved)])));

    expect(saved).toEqual(['Likes tea']);
    expect(events.find((e) => e.type === 'notice')).toBeUndefined();
    const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(text).toBe('Saving it.\nDone — I’ll remember you like tea.');
    expect(events.find((e) => e.type === 'tool-end')).toMatchObject({
      status: 'success',
      output: 'Saved to memory.',
    });
    const bodies = chatBodies(calls);
    expect(bodies).toHaveLength(3);
    expect(systemOf(bodies[1])).toContain('<tool_call>');
    const answer = (bodies[2]?.messages as { role: string; content: string }[]).at(-1);
    expect(answer).toEqual({
      role: 'user',
      content: '<tool_response name="mcp__conch__remember">\nSaved to memory.\n</tool_response>',
    });
    // The next turn starts in words, with no refused request first.
    await collect(engine.runTurn(turn('lab/tiny', [rememberTool(saved)])));
    expect(chatBodies(calls)[3]?.tools).toBeUndefined();
  });

  it('simplifies a refused schema and asks again, then remembers to', async () => {
    const fetch = fakeFetch((call) => {
      if (!isChat(call)) return jsonResponse({ data: [{ id: 'gemini-3-pro' }] });
      const sent = JSON.stringify((call.body as { tools?: unknown }).tools ?? '');
      return sent.includes('"anyOf"')
        ? jsonResponse(
            [
              {
                error: {
                  code: 400,
                  message:
                    'Invalid JSON payload received. Unknown name "anyOf" at \'tools[0].function_declarations[0].parameters.properties[1].value\': Cannot find field.',
                  status: 'INVALID_ARGUMENT',
                },
              },
            ],
            400,
          )
        : says('Hi.');
    });
    const gemini = PRESETS.find((p) => p.id === 'gemini');
    if (!gemini) throw new Error('No Gemini preset.');
    const engine = await engineWith(new OpenAiWire(gemini, fetch.fetch), 'gemini');
    const bridged = {
      name: 'mcp__tasks__add',
      description: 'Add a task.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          size: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
        },
      },
      run: async () => ({ text: 'ok', isError: false }),
    };
    const events = await collect(
      engine.runTurn(turn('gemini-3-pro', [], { bridgedTools: [bridged] })),
    );
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
    const bodies = chatBodies(fetch.calls);
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1]?.tools)).not.toContain('anyOf');
    await collect(engine.runTurn(turn('gemini-3-pro', [], { bridgedTools: [bridged] })));
    expect(chatBodies(fetch.calls)).toHaveLength(3);
  });

  it('gives tools in words when even the plainest schema is refused', async () => {
    const fetch = fakeFetch((call) => {
      if (!isChat(call)) return jsonResponse({ data: [{ id: 'odd-model' }] });
      return (call.body as { tools?: unknown }).tools
        ? jsonResponse(
            { error: { message: 'Invalid schema for function: parameters must be ...' } },
            400,
          )
        : says('Hi.');
    });
    const openai = PRESETS.find((p) => p.id === 'openai');
    if (!openai) throw new Error('No OpenAI preset.');
    const engine = await engineWith(new OpenAiWire(openai, fetch.fetch), 'openai');
    const events = await collect(engine.runTurn(turn('odd-model', [rememberTool([])])));
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
    const bodies = chatBodies(fetch.calls);
    expect(bodies.map((b) => b.tools !== undefined)).toEqual([true, true, false]);
    expect(systemOf(bodies[2])).toContain('<tool_call>');
  });

  it('never mistakes a refused request for a refused tool when no tools were sent', async () => {
    const fetch = fakeFetch((call) =>
      isChat(call)
        ? jsonResponse({ error: { message: 'Invalid schema for function x: not supported' } }, 400)
        : jsonResponse({ data: [{ id: 'm' }] }),
    );
    const openai = PRESETS.find((p) => p.id === 'openai');
    if (!openai) throw new Error('No OpenAI preset.');
    const engine = await engineWith(new OpenAiWire(openai, fetch.fetch), 'openai');
    const events = await collect(
      engine.runTurn(turn('m', [], { disallowedTools: ['Read', 'LS', 'Write', 'Edit', 'Bash'] })),
    );
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'error' });
    expect(chatBodies(fetch.calls)).toHaveLength(1);
  });
});

describe('a weak model’s native tool calls', () => {
  it('mends almost-JSON arguments and reads numbers written as text', async () => {
    const saved: string[] = [];
    let chat = 0;
    const { wire } = openRouter((call) => {
      if (!isChat(call)) return jsonResponse(catalogue(1, () => true));
      return chat++ === 0
        ? calls('mcp__conch__remember', "{'content': 'Likes tea', kind: 'Preference',}")
        : says('Saved.');
    });
    const engine = await engineWith(wire);
    const events = await collect(engine.runTurn(turn('lab/model-0', [rememberTool(saved)])));
    expect(saved).toEqual(['Likes tea']);
    expect(events.find((e) => e.type === 'tool-end')).toMatchObject({ status: 'success' });
  });
});

describe('a weak model’s tool calls, in words', () => {
  async function wordsTurn(replies: string[], tools: HostTool[]) {
    let chat = 0;
    const fetch = fakeFetch((call) =>
      isChat(call) ? says(replies[chat++] ?? 'Done.') : jsonResponse(catalogue(1, () => false)),
    );
    const engine = await engineWith(new OpenRouterWire(fetch.fetch as FetchLike));
    const events = await collect(engine.runTurn(turn('lab/model-0', tools)));
    return { events, bodies: chatBodies(fetch.calls) };
  }

  const ends = (events: EngineEvent[]) => events.filter((e) => e.type === 'tool-end');

  it('mends almost-JSON and reads loose names', async () => {
    const saved: string[] = [];
    await wordsTurn(
      ["```tool_call\n{'name': 'remember', 'parameters': {'content': 'Likes tea',}}\n```"],
      [rememberTool(saved)],
    );
    expect(saved).toEqual(['Likes tea']);
  });

  it('answers wrong arguments with exactly what to fix', async () => {
    const { events, bodies } = await wordsTurn(
      [
        '<tool_call>{"name": "remember", "arguments": {"kind": "Fact", "contnet": "tea"}}</tool_call>',
      ],
      [rememberTool([])],
    );
    const output = (ends(events)[0] as { output: string }).output;
    expect(output).toContain('- content: required (text), but it was missing.');
    expect(output).toContain('Ignored a field this tool doesn’t take: contnet.');
    expect((bodies[1]?.messages as { content: string }[]).at(-1)?.content).toContain(
      'status="error"',
    );
  });

  it('tells the model how to write a call it couldn’t read', async () => {
    const { events } = await wordsTurn(
      ['<tool_call>remember that I like tea</tool_call>'],
      [rememberTool([])],
    );
    expect((ends(events)[0] as { output: string }).output).toMatch(/couldn’t read that tool call/);
  });

  it('never runs or shows a tool answer the model made up', async () => {
    const saved: string[] = [];
    const { events } = await wordsTurn(
      [
        '<tool_call>{"name": "remember", "arguments": {"content": "tea"}}</tool_call>\n<tool_response>Saved!</tool_response> All saved.',
      ],
      [rememberTool(saved)],
    );
    expect(saved).toEqual(['tea']);
    const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(text).not.toContain('Saved!');
  });
});
