import type { EngineStatus, LocalModel } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { OllamaClient } from '../../local/ollama';
import { ApiEngine } from './engine';
import { collect, failure, fakeFetch, fakeHome, jsonResponse, sseResponse } from './fake';
import { OllamaWire, ollamaVariant, thinkFor, type OllamaLink } from './ollama';
import type { WireEvent, WireRequest } from './types';
import type { HostTool, TurnInput } from '../types';

const BASE = 'http://127.0.0.1:11434';

const QWEN: LocalModel = {
  name: 'qwen3:4b-instruct',
  label: 'Qwen3 4B',
  sizeBytes: 2_497_293_803,
  tools: true,
  vision: false,
  thinking: false,
};
const THINKER: LocalModel = { ...QWEN, name: 'qwen3.5:9b', label: 'Qwen3.5 9B', thinking: true };
const GEMMA: LocalModel = { ...QWEN, name: 'gemma3:1b', label: 'Gemma3 1B', tools: false };

/** NDJSON, one object a line, delivered in awkward slices. */
const lines = (...objects: unknown[]) =>
  sseResponse(objects.map((o) => JSON.stringify(o)).join('\n') + '\n', { chunk: 11 });

const done = (extra: Record<string, unknown> = {}) => ({
  model: 'qwen3:4b-instruct',
  message: { role: 'assistant', content: '' },
  done: true,
  done_reason: 'stop',
  prompt_eval_count: 812,
  eval_count: 24,
  ...extra,
});

function link(
  handler: Parameters<typeof fakeFetch>[0],
  overrides: Partial<OllamaLink> = {},
  models: LocalModel[] = [QWEN, THINKER, GEMMA],
) {
  const fetch = fakeFetch(handler);
  const value: OllamaLink = {
    client: new OllamaClient(() => BASE, fetch.fetch),
    models: async () => models,
    contextFor: () => 32_768,
    ensureRunning: vi.fn(async () => false),
    loaded: async () => true,
    engineStatus: async () => ({ state: 'ready' }) as EngineStatus,
    ...overrides,
  };
  return { link: value, calls: fetch.calls };
}

async function ready(l: OllamaLink) {
  const wire = new OllamaWire(l);
  await wire.models();
  return wire;
}

function request(overrides: Partial<WireRequest> = {}): WireRequest {
  return {
    key: '',
    model: 'qwen3:4b-instruct',
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

describe('Ollama, streamed', () => {
  it('streams text, asks for a real context size, and only ever calls this computer', async () => {
    const { link: l, calls } = link(() =>
      lines(
        { message: { role: 'assistant', content: 'Hel' }, done: false },
        { message: { role: 'assistant', content: 'lo!' }, done: false },
        done(),
      ),
    );
    const events = await drain((await ready(l)).stream(request()));

    expect(
      events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta),
    ).toEqual(['Hel', 'lo!']);
    const end = events.at(-1);
    expect(end).toMatchObject({
      type: 'end',
      stop: 'end',
      message: { role: 'assistant', content: 'Hello!' },
      usage: { inputTokens: 812, outputTokens: 24, costUsd: 0 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/api/chat`);
    expect(calls[0]?.body).toMatchObject({
      model: 'qwen3:4b-instruct',
      stream: true,
      // The default (4,096) can't hold Conch's tools.
      options: { num_ctx: 32_768 },
      messages: [
        { role: 'system', content: 'You are Pearl.' },
        { role: 'user', content: 'Remember I like tea' },
      ],
      tools: [{ type: 'function', function: { name: 'mcp__conch__remember' } }],
    });
    // A model that can't think is never sent `think` (it would be a 400).
    expect(calls[0]?.body).not.toHaveProperty('think');
  });

  it('turns a whole tool call into one the engine can run, and replays it as Ollama sent it', async () => {
    const { link: l } = link(() =>
      lines(
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_abc123',
                function: { index: 0, name: 'mcp__conch__remember', arguments: { content: 'tea' } },
              },
            ],
          },
          done: false,
        },
        // Before 0.12.10 there's no id: one is made up so the round trip still pairs.
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              { function: { name: 'mcp__conch__remember', arguments: '{"content":"biscuits"}' } },
            ],
          },
          done: false,
        },
        done({ done_reason: 'stop' }),
      ),
    );
    const wire = await ready(l);
    const end = (await drain(wire.stream(request()))).at(-1);
    if (end?.type !== 'end') throw new Error('no end');

    expect(end.stop).toBe('tools');
    expect(end.toolCalls[0]).toEqual({
      id: 'call_abc123',
      name: 'mcp__conch__remember',
      argumentsJson: '{"content":"tea"}',
    });
    expect(end.toolCalls[1]?.id).toMatch(/^call_1_/);
    expect(end.toolCalls[1]?.argumentsJson).toBe('{"content":"biscuits"}');
    expect(end.message['tool_calls']).toEqual([
      {
        id: 'call_abc123',
        function: { index: 0, name: 'mcp__conch__remember', arguments: { content: 'tea' } },
      },
      { function: { name: 'mcp__conch__remember', arguments: { content: 'biscuits' } } },
    ]);
    // Tool answers go back as `role: tool` with the tool's name.
    expect(
      wire.toolResults([
        { id: 'call_abc123', name: 'mcp__conch__remember', text: 'Saved.', isError: false },
      ]),
    ).toEqual([
      {
        role: 'tool',
        tool_name: 'mcp__conch__remember',
        tool_call_id: 'call_abc123',
        content: 'Saved.',
      },
    ]);
  });

  it('shows thinking apart, and only thinks when asked to', async () => {
    const { link: l, calls } = link(() =>
      lines(
        { message: { role: 'assistant', content: '', thinking: 'Hmm, tea.' }, done: false },
        { message: { role: 'assistant', content: 'Noted.' }, done: false },
        done(),
      ),
    );
    const wire = await ready(l);
    const events = await drain(wire.stream(request({ model: 'qwen3.5:9b', effort: 'high' })));
    expect(events[0]).toEqual({ type: 'thinking', delta: 'Hmm, tea.' });
    expect(calls[0]?.body).toMatchObject({ think: true });
    expect(events.at(-1)).toMatchObject({ message: { thinking: 'Hmm, tea.', content: 'Noted.' } });

    await drain(wire.stream(request({ model: 'qwen3.5:9b', effort: 'auto' })));
    // Small computers are slow to think: auto means answer straight away.
    expect(calls[1]?.body).toMatchObject({ think: false });
  });

  it('maps effort to think for each kind of model', () => {
    expect(thinkFor({ name: 'qwen3:4b', thinking: false }, 'high')).toBeUndefined();
    expect(thinkFor({ name: 'qwen3.5:9b', thinking: true }, 'low')).toBe(false);
    expect(thinkFor({ name: 'qwen3.5:9b', thinking: true }, 'max')).toBe(true);
    expect(thinkFor({ name: 'gpt-oss:20b', thinking: true }, 'auto')).toBeUndefined();
    expect(thinkFor({ name: 'gpt-oss:20b', thinking: true }, 'medium')).toBe('medium');
    expect(thinkFor({ name: 'gpt-oss:20b', thinking: true }, 'max')).toBe('high');
  });

  it('says so when a model has to load first', async () => {
    const { link: l } = link(() => lines(done()), { loaded: async () => false });
    const events = await drain((await ready(l)).stream(request()));
    expect(events[0]).toEqual({
      type: 'notice',
      code: 'loading',
      message: 'Loading Qwen3 4B into memory — the first answer takes a moment.',
    });
  });

  it('asks again without tools when the model can’t use them, and remembers', async () => {
    const { link: l, calls } = link((call) =>
      (call.body as { tools?: unknown }).tools
        ? jsonResponse(
            { error: 'registry.ollama.ai/library/gemma3:1b does not support tools' },
            400,
          )
        : lines({ message: { role: 'assistant', content: 'Hi' }, done: false }, done()),
    );
    // /api/show said it could; Ollama knows better.
    const liar = { ...GEMMA, tools: true };
    const wire = await ready({ ...l, models: async () => [liar] });
    const events = await drain(wire.stream(request({ model: 'gemma3:1b' })));

    expect(events.find((e) => e.type === 'notice')).toMatchObject({ code: 'no-tools' });
    expect(events.at(-1)).toMatchObject({ type: 'end', message: { content: 'Hi' } });
    expect(calls).toHaveLength(2);
    expect(wire.toolsFor('gemma3:1b')).toBe(false);
    await drain(wire.stream(request({ model: 'gemma3:1b' })));
    expect(calls).toHaveLength(3);
    expect(calls[2]?.body).not.toHaveProperty('tools');
  });

  it('asks again without thinking when the model can’t', async () => {
    const { link: l, calls } = link((call) =>
      'think' in (call.body as object)
        ? jsonResponse({ error: '"qwen3.5:9b" does not support thinking' }, 400)
        : lines(done()),
    );
    const wire = await ready(l);
    await drain(wire.stream(request({ model: 'qwen3.5:9b', effort: 'high' })));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).not.toHaveProperty('think');
  });

  it('says plainly when the model isn’t here any more', async () => {
    const { link: l } = link(() =>
      jsonResponse({ error: "model 'qwen3:4b-instruct' not found" }, 404),
    );
    const error = await failure(drain((await ready(l)).stream(request())));
    expect(error.kind).toBe('not-found');
    expect(error.message).toMatch(/^Qwen3 4B isn’t on this computer any more\./);
  });

  it('turns a failure mid-answer into a sentence', async () => {
    const { link: l } = link(() =>
      lines(
        { message: { role: 'assistant', content: 'Sure' }, done: false },
        { error: 'model requires more system memory (9.1 GiB) than is available (3.2 GiB)' },
      ),
    );
    const error = await failure(drain((await ready(l)).stream(request())));
    expect(error.message).toMatch(/needs more memory than this computer has free/);
  });

  it('starts Ollama when it isn’t running, then asks again', async () => {
    let up = false;
    const ensureRunning = vi.fn(async () => {
      up = true;
      return true;
    });
    const { link: l, calls } = link(
      () => {
        if (!up) throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:11434');
        return lines({ message: { role: 'assistant', content: 'Back.' }, done: false }, done());
      },
      { ensureRunning },
    );
    const events = await drain((await ready(l)).stream(request()));
    expect(ensureRunning).toHaveBeenCalledWith({ note: true });
    expect(calls).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ message: { content: 'Back.' } });
  });

  it('says what to do when Ollama isn’t running and can’t be started', async () => {
    const { link: l } = link(() => {
      throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:11434');
    });
    const error = await failure(drain((await ready(l)).stream(request())));
    expect(error.kind).toBe('network');
    expect(error.message).toMatch(/Ollama isn’t running, and Conch couldn’t start it/);
  });

  it('never talks to another computer, whatever it’s given', async () => {
    const { calls, link: l } = link(() => lines(done()));
    const remote = new OllamaClient(() => 'http://192.168.1.20:11434', l.client.fetch);
    const wire = await ready({ ...l, client: remote });
    const error = await failure(drain(wire.stream(request())));
    expect(error.message).toBe('Conch only talks to Ollama on this computer.');
    expect(calls).toHaveLength(0);
  });

  it('sends pictures the way Ollama takes them', () => {
    const wire = new OllamaWire(link(() => lines()).link);
    expect(
      wire.userMessage('What is this?', [{ name: 'a.png', mimeType: 'image/png', data: 'iVBOR' }]),
    ).toEqual({ role: 'user', content: 'What is this?', images: ['iVBOR'] });
  });

  it('answers one short prompt without thinking, at the same context size', async () => {
    const { link: l, calls } = link(() =>
      jsonResponse({
        message: { role: 'assistant', content: 'Tea notes' },
        done: true,
        eval_count: 3,
      }),
    );
    const wire = await ready(l);
    const reply = await wire.complete({
      key: '',
      model: 'qwen3.5:9b',
      system: 'Name this chat.',
      prompt: 'I like tea',
      maxTokens: 64,
      signal: new AbortController().signal,
    });
    expect(reply.text).toBe('Tea notes');
    expect(calls[0]?.body).toMatchObject({
      stream: false,
      think: false,
      options: { num_ctx: 32_768, num_predict: 64 },
    });
  });

  it('lists models with what each can do', async () => {
    const wire = new OllamaWire(link(() => lines()).link);
    const models = await wire.models();
    expect(models.map((m) => [m.info.id, m.tools, m.info.efforts])).toEqual([
      ['qwen3:4b-instruct', true, []],
      ['qwen3.5:9b', true, ['high']],
      ['gemma3:1b', false, []],
    ]);
    expect(models[2]?.info.description).toBe('2.5 GB · can’t use your apps or memory');
  });
});

describe('the local engine', () => {
  const tool: HostTool = {
    name: 'remember',
    description: 'Save a fact.',
    input: {},
    run: async () => 'Saved.',
  };

  async function engine(handler: Parameters<typeof fakeFetch>[0], models?: LocalModel[]) {
    const { home, settings, keys } = await fakeHome();
    const { link: l, calls } = link(handler, {}, models);
    return { engine: new ApiEngine(ollamaVariant(l, { home }), settings, keys), calls };
  }

  function turn(overrides: Partial<TurnInput> = {}): TurnInput {
    return {
      conversationId: 'c_1',
      prompt: 'Remember I like tea',
      systemAppend: 'You are Pearl.',
      cwd: '.',
      tools: [tool],
      requestPermission: async () => 'allow',
      signal: new AbortController().signal,
      options: {
        model: 'qwen3:4b-instruct',
        effort: 'auto',
        fastMode: false,
        permissionMode: 'default',
      },
      ...overrides,
    };
  }

  it('needs no key, says it’s local, and runs a tool round trip', async () => {
    let step = 0;
    const { engine: e, calls } = await engine(() => {
      step += 1;
      return step === 1
        ? lines(
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  { id: 'call_1', function: { name: 'mcp__conch__remember', arguments: {} } },
                ],
              },
              done: false,
            },
            done(),
          )
        : lines({ message: { role: 'assistant', content: 'Saved it.' }, done: false }, done());
    });
    expect(e.local).toBe(true);
    const events = await collect(e.runTurn(turn()));

    expect(events.map((ev) => ev.type)).toEqual([
      'session',
      'tool-start',
      'tool-end',
      'text',
      'message-done',
      'done',
    ]);
    expect(events.at(-1)).toMatchObject({ outcome: 'success' });
    const second = calls[1]?.body as { messages: Record<string, unknown>[] };
    expect(second.messages.at(-1)).toEqual({
      role: 'tool',
      tool_name: 'mcp__conch__remember',
      tool_call_id: 'call_1',
      content: 'Saved.',
    });
    // The model is told where it runs.
    expect(String(second.messages[0]?.['content'])).toMatch(
      /running on this computer, through Ollama/,
    );
  });

  it('gives a model that can’t use tools none, and tells it so', async () => {
    const { engine: e, calls } = await engine(() => lines(done()), [GEMMA]);
    await e.capabilities();
    await collect(e.runTurn(turn({ options: { ...turn().options, model: 'gemma3:1b' } })));
    const body = calls[0]?.body as { tools?: unknown; messages: { content: string }[] };
    expect(body.tools).toBeUndefined();
    expect(body.messages[0]?.content).toMatch(/You have no tools in this conversation/);
  });

  it('reports usage as free', async () => {
    const { engine: e } = await engine(() => lines());
    expect(await e.usage?.()).toMatchObject({
      kind: 'unknown',
      message: expect.stringMatching(/nothing to pay/),
    });
  });
});
