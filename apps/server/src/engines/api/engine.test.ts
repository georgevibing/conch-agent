import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { BridgedTool, EngineEvent, HostTool, TurnInput } from '../types';
import { ApiEngine, buildTools, capModels, parseArgs } from './engine';
import { collect, dataFrames, fakeFetch, fakeHome, jsonResponse, sseResponse } from './fake';
import { OpenRouterWire, openrouterVariant } from './openrouter';
import { sessionsDir } from './session';
import {
  ApiError,
  type ApiProviderId,
  type ApiVariant,
  type WireEvent,
  type WireToolCall,
} from './types';
import type { Wire } from './wire';

const KEY = 'sk-or-v1-secret-key-value';

const MODELS = {
  data: [
    {
      id: 'anthropic/claude-sonnet-4.6',
      name: 'Claude Sonnet 4.6',
      context_length: 200_000,
      pricing: { prompt: '0.000003', completion: '0.000015' },
      supported_parameters: ['tools'],
    },
  ],
};

// ── Doubles ─────────────────────────────────────────────────────────────────

function stubWire(overrides: Partial<Wire> = {}): Wire {
  const wire: Wire = {
    source: 'Stub',
    check: async () => ({ description: 'Stub · $1.00 left' }),
    models: async () => [
      {
        info: {
          id: 'stub/model',
          label: 'Stub model',
          description: '',
          efforts: [],
          supportsFastMode: false,
          supportsAutoMode: false,
        },
        tools: true,
      },
    ],
    stream: () => ended('All done.'),
    complete: async () => ({ text: 'A title' }),
    userMessage: (content) => ({ role: 'user', content }),
    toolResults: (results) =>
      results.map((result) => ({ role: 'tool', tool_call_id: result.id, content: result.text })),
    smallModel: () => undefined,
    ...overrides,
  };
  return wire;
}

/** A stream that says one thing and stops. */
function ended(text: string, toolCalls: WireToolCall[] = []) {
  return (async function* (): AsyncIterable<WireEvent> {
    yield { type: 'text', delta: text };
    yield {
      type: 'end',
      message: { role: 'assistant', content: text },
      toolCalls,
      stop: 'end',
      usage: { inputTokens: 10, outputTokens: 2 },
    };
  })();
}

async function engineFor(
  wire: Wire,
  options: { key?: string | false; id?: ApiProviderId } = {},
): Promise<{ engine: ApiEngine; home: string }> {
  const { home, settings, keys } = await fakeHome();
  if (options.key !== false) await keys.save(options.id ?? 'openrouter', options.key ?? KEY);
  const variant: ApiVariant = {
    id: options.id ?? 'openrouter',
    label: 'OpenRouter',
    docsUrl: 'https://openrouter.ai/docs',
    keyUrl: 'https://openrouter.ai/settings/keys',
    canSignIn: true,
    wire,
    home,
  };
  return { engine: new ApiEngine(variant, settings, keys), home };
}

function turn(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    conversationId: 'c_1',
    prompt: 'Remember I like tea',
    systemAppend: 'You are Pearl.',
    cwd: process.cwd(),
    tools: [],
    requestPermission: async () => 'allow',
    signal: new AbortController().signal,
    options: { effort: 'auto', fastMode: false, permissionMode: 'default' },
    ...overrides,
  };
}

function rememberTool(saved: string[]): HostTool {
  const tool: HostTool<{ content: z.ZodString }> = {
    name: 'remember',
    description: 'Save one durable fact.',
    input: { content: z.string() },
    run: async ({ content }) => {
      saved.push(content);
      return 'Saved to memory.';
    },
  };
  return tool as HostTool;
}

// ── Detection ───────────────────────────────────────────────────────────────

describe('detecting an API provider', () => {
  it('is signed out, and says how to connect, with no key saved', async () => {
    const { engine } = await engineFor(stubWire(), { key: false });

    const status = await engine.detect();
    expect(status).toMatchObject({
      engine: 'openrouter',
      state: 'signed-out',
      install: [],
      canSignIn: true,
      docsUrl: 'https://openrouter.ai/docs',
    });
    expect(status.message).toBe('Sign in to OpenRouter, or paste a key, to start chatting.');
  });

  it('validates the key once a minute and describes the account', async () => {
    let checks = 0;
    const { engine } = await engineFor(
      stubWire({
        check: async () => {
          checks++;
          return { description: 'OpenRouter · $12.40 left' };
        },
      }),
    );

    const status = await engine.detect();
    expect(status.state).toBe('ready');
    expect(status.auth).toEqual({ method: 'api-key', description: 'OpenRouter · $12.40 left' });

    await engine.detect();
    expect(checks).toBe(1);
    await engine.detect({ force: true });
    expect(checks).toBe(2);
  });

  it('shares one probe between callers that ask at the same time', async () => {
    let checks = 0;
    const { engine } = await engineFor(
      stubWire({
        check: async () => {
          checks++;
          return { description: 'ok' };
        },
      }),
    );

    await Promise.all([engine.detect(), engine.detect(), engine.detect()]);
    expect(checks).toBe(1);
  });

  it('treats a refused key as signed out, and anything else as an error', async () => {
    const refused = await engineFor(
      stubWire({
        check: () => {
          throw new ApiError('auth', 'OpenRouter refused your key. Add a new one in Settings.');
        },
      }),
    );
    const out = await refused.engine.detect();
    expect(out.state).toBe('signed-out');
    expect(out.message).toContain('refused your key');

    const offline = await engineFor(
      stubWire({
        check: () => {
          throw new ApiError('network', 'Conch couldn’t reach OpenRouter. Check your connection.');
        },
      }),
    );
    const broken = await offline.engine.detect();
    expect(broken.state).toBe('error');
    expect(broken.message).toBe('Conch couldn’t reach OpenRouter. Check your connection.');
  });

  it('never surfaces a stack trace', async () => {
    const { engine } = await engineFor(
      stubWire({
        check: () => {
          throw new Error('Cannot read properties of undefined (reading "x")');
        },
      }),
    );

    const status = await engine.detect();
    expect(status.state).toBe('error');
    expect(status.message).not.toContain('\n');
  });

  it('asks nobody to unlock 1Password just to draw a page', async () => {
    const { engine } = await engineFor(stubWire(), { key: 'op://Private/OpenRouter/credential' });

    const status = await engine.detect();
    expect(status.state).toBe('signed-out');
    expect(status.message).toContain('1Password');
  });
});

// ── Capabilities ────────────────────────────────────────────────────────────

describe('what an API provider can do', () => {
  it('offers provider models and Conch’s consistent permission modes', async () => {
    const { engine } = await engineFor(stubWire());

    const capabilities = await engine.capabilities();
    expect(capabilities.models.map((m) => m.id)).toEqual(['stub/model']);
    expect(capabilities.commands).toEqual([]);
    // There are no file or shell tools here, so there's no wider mode to offer.
    expect(capabilities.permissionModes).toEqual([
      'default',
      'plan',
      'acceptEdits',
      'bypassPermissions',
    ]);
    expect(capabilities.tools).toMatchObject({ host: true, files: true, approvals: true });
  });

  it('caches the list and shares one probe', async () => {
    let lists = 0;
    const { engine } = await engineFor(
      stubWire({
        models: async () => {
          lists++;
          return [];
        },
      }),
    );

    await Promise.all([engine.capabilities(), engine.capabilities()]);
    await engine.capabilities();
    expect(lists).toBe(1);
    await engine.capabilities({ force: true });
    expect(lists).toBe(2);
  });

  it('returns an empty list when the provider can’t be reached, never a made-up model', async () => {
    const { engine } = await engineFor(
      stubWire({
        models: () => {
          throw new ApiError('network', 'Conch couldn’t reach OpenRouter.');
        },
      }),
    );

    expect((await engine.capabilities()).models).toEqual([]);
  });

  it('keeps the model the user already chose, even past the cap', () => {
    const models = Array.from({ length: 80 }, (_, i) => ({
      id: `m${i}`,
      label: `Model ${i}`,
      description: '',
      efforts: [],
      supportsFastMode: false,
      supportsAutoMode: false,
    }));

    const capped = capModels(models, 'm79');
    expect(capped.length).toBe(60);
    expect(capped.at(-1)?.id).toBe('m79');
    expect(capModels(models).length).toBe(60);
  });

  it('forgets everything that depended on the key when it changes', async () => {
    let checks = 0;
    const { engine } = await engineFor(
      stubWire({
        check: async () => {
          checks++;
          return { description: 'ok' };
        },
      }),
    );

    await engine.detect();
    await engine.setApiKey();
    await engine.detect();
    expect(checks).toBe(2);
  });
});

// ── A turn, end to end over HTTP ────────────────────────────────────────────

describe('a turn against the real OpenRouter wire', () => {
  const FIRST = dataFrames(
    '{"choices":[{"delta":{"content":"One moment"}}]}',
    '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"mcp__conch__remember","arguments":"{\\"content\\":\\"likes tea\\"}"}}]}}]}',
    '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
    '{"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":100,"completion_tokens":20,"cost":0.001}}',
    '[DONE]',
  );
  const SECOND = dataFrames(
    '{"choices":[{"delta":{"content":"Noted — I’ll remember that."}}]}',
    '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
    '{"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":140,"completion_tokens":9,"cost":0.0004}}',
    '[DONE]',
  );

  it('runs the tool the model asked for and comes back for the answer', async () => {
    let chats = 0;
    const fetch = fakeFetch((call) => {
      if (call.url.includes('/models')) return jsonResponse(MODELS);
      chats++;
      return sseResponse(chats === 1 ? FIRST : SECOND);
    });
    const { engine, home } = await engineFor(new OpenRouterWire(fetch.fetch));
    const saved: string[] = [];

    const events = await collect(engine.runTurn(turn({ tools: [rememberTool(saved)] })));

    const session = events[0] as Extract<EngineEvent, { type: 'session' }>;
    expect(session).toMatchObject({ type: 'session', model: 'anthropic/claude-sonnet-4.6' });
    expect(session.resumeId).toMatch(/^api_/);
    expect(events.filter((e) => e.type === 'text').map((e) => e.delta)).toEqual([
      'One moment',
      'Noted — I’ll remember that.',
    ]);
    expect(events.find((e) => e.type === 'tool-start')).toEqual({
      type: 'tool-start',
      // The provider's own id, so Conch can pair start with end.
      toolUseId: 'call_1',
      name: 'mcp__conch__remember',
      input: { content: 'likes tea' },
    });
    expect(events.find((e) => e.type === 'tool-end')).toEqual({
      type: 'tool-end',
      toolUseId: 'call_1',
      status: 'success',
      output: 'Saved to memory.',
    });
    expect(saved).toEqual(['likes tea']);
    const done = events.at(-1) as Extract<EngineEvent, { type: 'done' }>;
    expect(done.outcome).toBe('success');
    // Summed across both requests in the loop.
    expect(done.usage).toMatchObject({ inputTokens: 240, outputTokens: 29 });
    expect(done.usage?.costUsd).toBeCloseTo(0.0014, 6);
    expect(events.filter((e) => e.type === 'done').length).toBe(1);
    // Before the tool runs, what the turn has used so far (ADR 0057).
    const progress = events.filter((e) => e.type === 'usage');
    expect(progress).toHaveLength(1);
    expect(events.indexOf(progress[0] as EngineEvent)).toBeLessThan(
      events.findIndex((e) => e.type === 'tool-start'),
    );
    expect(progress[0]).toMatchObject({ usage: { inputTokens: 100 } });

    // Tools go on the second request too, with the result appended.
    const second = fetch.calls.at(-1)?.body as Record<string, unknown>;
    expect(second['tools']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({ name: 'mcp__conch__remember' }),
        }),
      ]),
    );
    expect((second['messages'] as unknown[]).at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'Saved to memory.',
    });

    // The transcript is on disk, ready for the next turn.
    const file = join(sessionsDir(home), `${session.resumeId}.json`);
    const stored = JSON.parse(await readFile(file, 'utf8')) as { messages: { role: string }[] };
    expect(stored.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  });

  it('replays the transcript on the next turn and doesn’t announce a new session', async () => {
    let chats = 0;
    const fetch = fakeFetch((call) => {
      if (call.url.includes('/models')) return jsonResponse(MODELS);
      chats++;
      return sseResponse(chats === 1 ? FIRST : SECOND);
    });
    const { engine } = await engineFor(new OpenRouterWire(fetch.fetch));
    const first = await collect(engine.runTurn(turn({ tools: [rememberTool([])] })));
    const resumeId = (first[0] as Extract<EngineEvent, { type: 'session' }>).resumeId;

    const events = await collect(engine.runTurn(turn({ resumeId, prompt: 'And biscuits' })));

    expect(events.some((e) => e.type === 'session')).toBe(false);
    const body = fetch.calls.at(-1)?.body as Record<string, unknown>;
    const messages = body['messages'] as { role: string; content?: unknown }[];
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]).toEqual({ role: 'user', content: 'Remember I like tea' });
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'And biscuits' });
  });

  it('tells the user in plain words when the provider fails', async () => {
    const fetch = fakeFetch((call) =>
      call.url.includes('/models')
        ? jsonResponse(MODELS)
        : jsonResponse({ error: { code: 400, message: 'no endpoints found', metadata: {} } }, 400),
    );
    const { engine } = await engineFor(new OpenRouterWire(fetch.fetch));

    const events = await collect(engine.runTurn(turn()));
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      outcome: 'error',
      error: 'no endpoints found',
    });
  });

  it.each([
    ['auth', 'signed-out'],
    ['payment', 'limit'],
    ['rate-limit', 'limit'],
    ['overloaded', 'unavailable'],
    ['network', 'unavailable'],
    ['context', 'too-long'],
  ] as const)('says a %s failure is %s, so the chat knows who can help', async (kind, problem) => {
    const wire = stubWire({
      stream: () =>
        (async function* (): AsyncIterable<WireEvent> {
          yield* [];
          throw new ApiError(kind, 'It went wrong.');
        })(),
    });
    const { engine } = await engineFor(wire);

    const done = (await collect(engine.runTurn(turn()))).at(-1);
    expect(done).toMatchObject({ type: 'done', outcome: 'error', error: 'It went wrong.' });
    expect(done && 'problem' in done ? done.problem : undefined).toBe(problem);
  });
});

// ── The loop ────────────────────────────────────────────────────────────────

describe('the tool loop', () => {
  const toolTurn = (calls: { id: string; name: string; argumentsJson: string }[], text = '') =>
    (async function* (): AsyncIterable<WireEvent> {
      if (text) yield { type: 'text', delta: text };
      yield {
        type: 'end',
        message: { role: 'assistant', content: text || null },
        toolCalls: calls,
        stop: 'tools',
      };
    })();

  it('reports a tool that failed without ending the turn', async () => {
    let step = 0;
    const bridged: BridgedTool = {
      name: 'mcp__notion__create_page',
      description: 'Create a page.',
      inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
      run: async () => ({ text: 'The user declined this action.', isError: true }),
    };
    const { engine } = await engineFor(
      stubWire({
        stream: () =>
          ++step === 1
            ? toolTurn([
                {
                  id: 'call_1',
                  name: 'mcp__notion__create_page',
                  argumentsJson: '{"title":"Notes"}',
                },
              ])
            : ended('No problem — I left it alone.'),
      }),
    );

    const events = await collect(engine.runTurn(turn({ bridgedTools: [bridged] })));
    expect(events.find((e) => e.type === 'tool-end')).toEqual({
      type: 'tool-end',
      toolUseId: 'call_1',
      status: 'error',
      output: 'The user declined this action.',
    });
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
  });

  it('answers arguments that aren’t JSON with a tool error, not a crash', async () => {
    let step = 0;
    const { engine } = await engineFor(
      stubWire({
        stream: () =>
          ++step === 1
            ? toolTurn([
                { id: 'call_1', name: 'mcp__conch__remember', argumentsJson: '{"content": ' },
              ])
            : ended('Let me try that again.'),
      }),
    );

    const events = await collect(engine.runTurn(turn({ tools: [rememberTool([])] })));
    expect(events.find((e) => e.type === 'tool-end')).toMatchObject({
      status: 'error',
      output: 'Those arguments were not valid JSON. Call the tool again with a JSON object.',
    });
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
  });

  it('answers a tool the model invented instead of throwing', async () => {
    let step = 0;
    const { engine } = await engineFor(
      stubWire({
        stream: () =>
          ++step === 1
            ? toolTurn([{ id: 'call_1', name: 'delete_everything', argumentsJson: '{}' }])
            : ended('I can’t do that.'),
      }),
    );

    const events = await collect(engine.runTurn(turn()));
    expect(events.find((e) => e.type === 'tool-end')).toMatchObject({
      status: 'error',
      output: expect.stringContaining('There is no tool called delete_everything'),
    });
  });

  it('stops after a sane number of steps and says so', async () => {
    let steps = 0;
    const { engine } = await engineFor(
      stubWire({
        stream: () => {
          steps++;
          return toolTurn([
            { id: `call_${steps}`, name: 'mcp__conch__remember', argumentsJson: '{"content":"x"}' },
          ]);
        },
      }),
    );

    const events = await collect(engine.runTurn(turn({ tools: [rememberTool([])] })));
    expect(steps).toBe(24);
    expect(events.at(-2)).toMatchObject({ type: 'notice', code: 'step-limit' });
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
  });

  it('never offers a tool the user turned off', () => {
    const bridged = (name: string): BridgedTool => ({
      name,
      description: '',
      inputSchema: { type: 'object', properties: {} },
      run: async () => ({ text: '', isError: false }),
    });
    const tools = buildTools(
      turn({
        tools: [rememberTool([])],
        bridgedTools: [bridged('mcp__notion__search'), bridged('mcp__notion__delete_page')],
        disallowedTools: ['mcp__notion__delete_page', 'mcp__conch__remember'],
      }),
    );

    expect([...tools.keys()]).toContain('mcp__notion__search');
    expect([...tools.keys()]).not.toContain('mcp__conch__remember');
  });
});

// ── Stopping, retrying, failing ─────────────────────────────────────────────

describe('when a turn is interrupted or retried', () => {
  it('ends as interrupted when the user stops it', async () => {
    const controller = new AbortController();
    const { engine } = await engineFor(
      stubWire({
        stream: () =>
          (async function* (): AsyncIterable<WireEvent> {
            yield { type: 'text', delta: 'Thinking' };
            controller.abort();
            throw new DOMException('Aborted', 'AbortError');
          })(),
      }),
    );

    const events = await collect(engine.runTurn(turn({ signal: controller.signal })));
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'interrupted' });
    expect(events.some((e) => e.type === 'done' && e.outcome === 'error')).toBe(false);
  });

  it('answers every tool call it can’t run, so the next turn is still valid', async () => {
    const controller = new AbortController();
    const { engine, home } = await engineFor(
      stubWire({
        stream: () =>
          (async function* (): AsyncIterable<WireEvent> {
            yield {
              type: 'end',
              message: { role: 'assistant', content: null },
              toolCalls: [
                { id: 'call_1', name: 'mcp__conch__remember', argumentsJson: '{"content":"x"}' },
              ],
              stop: 'tools',
            };
            controller.abort();
          })(),
      }),
    );

    const events = await collect(
      engine.runTurn(turn({ signal: controller.signal, tools: [rememberTool([])] })),
    );
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'interrupted' });

    const session = events.find((e) => e.type === 'session');
    const resumeId = (session as Extract<EngineEvent, { type: 'session' }>).resumeId;
    const stored = JSON.parse(
      await readFile(join(sessionsDir(home), `${resumeId}.json`), 'utf8'),
    ) as { messages: { role: string }[] };
    expect(stored.messages.at(-1)?.role).toBe('tool');
  });

  it('retries a transient failure twice, saying so each time', async () => {
    let attempts = 0;
    const { engine } = await engineFor(
      stubWire({
        stream: () => {
          attempts++;
          if (attempts < 3) {
            throw new ApiError('overloaded', 'The model’s provider is overloaded right now.', {
              retryable: true,
              retryAfterMs: 5,
            });
          }
          return ended('Here you go.');
        },
      }),
    );

    const events = await collect(engine.runTurn(turn()));
    expect(attempts).toBe(3);
    expect(events.filter((e) => e.type === 'notice')).toEqual([
      {
        type: 'notice',
        code: 'retry',
        message: 'The model’s provider is overloaded right now. Retrying in 1s…',
      },
      {
        type: 'notice',
        code: 'retry',
        message: 'The model’s provider is overloaded right now. Retrying in 1s…',
      },
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
  });

  it('gives up after two retries with one plain sentence', async () => {
    let attempts = 0;
    const { engine } = await engineFor(
      stubWire({
        stream: () => {
          attempts++;
          throw new ApiError('overloaded', 'Anthropic is overloaded right now.', {
            retryable: true,
            retryAfterMs: 5,
          });
        },
      }),
    );

    const events = await collect(engine.runTurn(turn()));
    expect(attempts).toBe(3);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      outcome: 'error',
      error: 'Anthropic is overloaded right now.',
    });
  });

  it('doesn’t retry once the model has already said something', async () => {
    let attempts = 0;
    const { engine } = await engineFor(
      stubWire({
        stream: () =>
          (async function* (): AsyncIterable<WireEvent> {
            attempts++;
            yield { type: 'text', delta: 'Half an answer' };
            throw new ApiError('overloaded', 'Overloaded.', { retryable: true, retryAfterMs: 5 });
          })(),
      }),
    );

    const events = await collect(engine.runTurn(turn()));
    expect(attempts).toBe(1);
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'error' });
  });

  it('says what to do when there is no key at all, as a sign-in the person gives', async () => {
    const { engine } = await engineFor(stubWire(), { key: false });

    const events = await collect(engine.runTurn(turn()));
    expect(events).toEqual([
      {
        type: 'done',
        outcome: 'error',
        error: 'Add your OpenRouter key in Settings to start chatting.',
        problem: 'signed-out',
        usage: expect.objectContaining({ inputTokens: 0 }),
      },
    ]);
  });
});

// ── Small jobs ──────────────────────────────────────────────────────────────

describe('naming a chat', () => {
  it('uses the provider’s own small model when it has one', async () => {
    const asked: string[] = [];
    const { engine } = await engineFor(
      stubWire({
        smallModel: () => 'anthropic/claude-haiku-4.5',
        complete: async (request) => {
          asked.push(request.model);
          return { text: 'Tea preferences' };
        },
      }),
    );

    const reply = await engine.complete({
      system: 'Name chats.',
      prompt: 'Hello',
      signal: new AbortController().signal,
    });
    expect(reply.text).toBe('Tea preferences');
    expect(asked).toEqual(['anthropic/claude-haiku-4.5']);
    expect(engine.smallModel).toBe('anthropic/claude-haiku-4.5');
  });

  it('falls back to the first model the provider lists', async () => {
    const asked: string[] = [];
    const { engine } = await engineFor(
      stubWire({
        complete: async (request) => {
          asked.push(request.model);
          return { text: 'x' };
        },
      }),
    );

    await engine.complete({
      system: '',
      prompt: 'Hello',
      signal: new AbortController().signal,
    });
    expect(asked).toEqual(['stub/model']);
  });

  it('rejects with a sentence, never a stack', async () => {
    const { engine } = await engineFor(
      stubWire({
        complete: () => {
          throw new ApiError('rate-limit', 'OpenRouter is rate-limiting this key.');
        },
      }),
    );

    await expect(
      engine.complete({ system: '', prompt: 'x', signal: new AbortController().signal }),
    ).rejects.toThrow('OpenRouter is rate-limiting this key.');
  });
});

describe('arguments from the model', () => {
  it('accepts an object and nothing else', () => {
    expect(parseArgs('{"a":1}')).toEqual({ a: 1 });
    expect(parseArgs('')).toEqual({});
    expect(parseArgs('   ')).toEqual({});
    expect(parseArgs('[1,2]')).toBeUndefined();
    expect(parseArgs('"a"')).toBeUndefined();
    expect(parseArgs('{oops')).toBeUndefined();
  });
});

describe('how these engines take part in integrations', () => {
  it('is a bridge engine with no connectors of its own', async () => {
    const { engine } = await engineFor(stubWire());
    expect(engine.integrations.mode).toBe('bridge');
    expect(engine.integrations.account).toBeUndefined();
    expect(engine.integrations.signInHint).toContain('in Apps');
  });

  it('only offers a usage reading where the provider publishes one', async () => {
    const withUsage = await engineFor(
      stubWire({
        usage: async () => ({ kind: 'metered', source: 'OpenRouter', windows: [] }),
      }),
    );
    expect(withUsage.engine.usage).toBeDefined();
    expect(await withUsage.engine.usage?.()).toMatchObject({ kind: 'metered' });

    const without = await engineFor(stubWire());
    expect(without.engine.usage).toBeUndefined();
  });

  it('builds the OpenRouter variant with the home Conch gave it', () => {
    const variant = openrouterVariant({ home: '/tmp/x' });
    expect(variant.home).toBe('/tmp/x');
  });
});
