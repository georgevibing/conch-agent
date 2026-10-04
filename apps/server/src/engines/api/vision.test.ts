/**
 * Every model sees the page (ADR 0070): a screenshot reaches a model that can
 * look as a picture, a model that can't gets it in words, and a model that
 * turns out not to see heals by itself.
 */
import { describe, expect, it } from 'vitest';

import type { DescribeImages, HostTool, TurnInput } from '../types';
import { mapError as anthropicError } from './anthropic';
import { ApiEngine } from './engine';
import { collect, fakeFetch, fakeHome, jsonResponse, sseResponse } from './fake';
import { mapError as ollamaError } from './ollama';
import { mapChatError, OpenAiWire } from './openai';
import { mapError as openrouterError, OpenRouterWire } from './openrouter';
import { hasPictures } from './pictures';
import { PRESETS } from './presets';
import { NO_SIGHT, withSight } from './sight';
import { ApiError, type ApiVariant, type WireEvent, type WireRequest } from './types';
import type { ToolResult, Wire } from './wire';

const JPEG = '/9j/' + 'Q'.repeat(64);

function screenshotTool(): HostTool {
  return {
    name: 'browser_screenshot',
    description: 'Look at the page.',
    input: {},
    run: async () => ({
      text: 'Screenshot of “Shop”: the visible part of the page, 1280×800 pixels.',
      images: [{ data: JPEG, mimeType: 'image/jpeg' }],
    }),
  };
}

/** A provider that refuses every picture. */
function refusing(): AsyncIterable<WireEvent> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        Promise.reject(new ApiError('images', 'No endpoints found that support image input')),
    }),
  };
}

/** Read a stream to its end. */
async function drain(stream: AsyncIterable<unknown>) {
  for await (const event of stream) void event;
}

function presetOf(id: string) {
  const found = PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`No preset ${id}`);
  return found;
}

function ended(text: string, calls: { id: string; name: string }[] = []) {
  return (async function* (): AsyncIterable<WireEvent> {
    if (text) yield { type: 'text', delta: text };
    yield {
      type: 'end',
      message: { role: 'assistant', content: text || null },
      toolCalls: calls.map((c) => ({ ...c, argumentsJson: '{}' })),
      stop: calls.length ? 'tools' : 'end',
      usage: { inputTokens: 10, outputTokens: 2 },
    };
  })();
}

/** A wire that asks for a screenshot first, then answers, recording what it was sent. */
function screenshotWire(
  options: { sees?: boolean; listed?: boolean; refuse?: number } = {},
): Wire & { requests: WireRequest[]; results: ToolResult[][] } {
  const requests: WireRequest[] = [];
  const results: ToolResult[][] = [];
  let refusals = options.refuse ?? 0;
  return {
    requests,
    results,
    source: 'Stub',
    check: async () => ({ description: 'Stub' }),
    models: async () => [
      {
        info: {
          id: 'stub/model',
          label: 'Stub model',
          description: '',
          efforts: [],
          supportsFastMode: false,
          supportsAutoMode: false,
          ...(options.listed !== undefined && { images: options.listed }),
        },
        tools: true,
      },
    ],
    stream: (request) => {
      requests.push(structuredClone({ ...request, signal: undefined }) as never);
      if (refusals > 0 && request.messages.some(hasPictures)) {
        refusals--;
        return refusing();
      }
      // After the person's newest message: a screenshot first, then the answer.
      const asked = request.messages.findLastIndex(
        (m) => m.role === 'user' && !String(m.content).startsWith('[Pictures'),
      );
      const looked = request.messages.slice(asked).some((m) => m.role === 'tool');
      return looked
        ? ended('It’s a shop.')
        : ended('', [{ id: `call_${requests.length}`, name: 'mcp__conch__browser_screenshot' }]);
    },
    complete: async () => ({ text: 'A title' }),
    userMessage: (content, images) =>
      images?.length
        ? { role: 'user', content, images: images.map((i) => i.data) }
        : { role: 'user', content },
    toolResults: (rs) => {
      results.push(rs);
      return [
        ...rs.map((r) => ({ role: 'tool', tool_call_id: r.id, content: r.text })),
        ...(rs.some((r) => r.images?.length)
          ? [
              {
                role: 'user',
                content: '[Pictures from the tool results above]',
                images: rs.flatMap((r) => (r.images ?? []).map((i) => i.data)),
              },
            ]
          : []),
      ];
    },
    smallModel: () => undefined,
    ...(options.sees !== undefined && { seesFor: () => options.sees }),
  };
}

async function engineFor(wire: Wire): Promise<ApiEngine> {
  const { home, settings, keys } = await fakeHome();
  await keys.save('openrouter', 'sk-or-v1-' + 'k'.repeat(20));
  const variant: ApiVariant = {
    id: 'openrouter',
    label: 'OpenRouter',
    docsUrl: 'https://openrouter.ai/docs',
    keyUrl: 'https://openrouter.ai/settings/keys',
    canSignIn: true,
    wire,
    home,
  };
  return new ApiEngine(variant, settings, keys);
}

function turn(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    conversationId: 'c_1',
    prompt: 'What does the page look like?',
    systemAppend: 'You are Pearl.',
    cwd: process.cwd(),
    tools: [screenshotTool()],
    requestPermission: async () => 'allow',
    signal: new AbortController().signal,
    options: { effort: 'auto', fastMode: false, permissionMode: 'default' },
    ...overrides,
  };
}

function describer(calls: unknown[]): DescribeImages {
  return async (images, context) => {
    calls.push({ count: images.length, what: context.what });
    return {
      text: 'What Gemini saw in it: a search box at 640,120 and a blue “Buy” button at 900,610.',
      usage: { inputTokens: 1_000, outputTokens: 80, costUsd: 0.001 },
    };
  };
}

describe('a screenshot reaches the model as a picture when it can see', () => {
  it('passes the picture to the wire beside the words', async () => {
    const wire = screenshotWire({ listed: true });
    const engine = await engineFor(wire);
    const calls: unknown[] = [];
    const events = await collect(engine.runTurn(turn({ describe: describer(calls) })));
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
    expect(wire.results[0]?.[0]?.images).toEqual([{ data: JPEG, mimeType: 'image/jpeg' }]);
    expect(wire.requests[1]?.messages.some(hasPictures)).toBe(true);
    expect(calls).toEqual([]);
  });

  it('trusts the provider’s word for a model its list doesn’t describe', async () => {
    const wire = screenshotWire({ sees: true });
    const engine = await engineFor(wire);
    await collect(engine.runTurn(turn()));
    expect(wire.results[0]?.[0]?.images).toHaveLength(1);
    expect((await engine.capabilities()).models[0]?.images).toBe(true);
  });
});

describe('a model that can’t see gets the screenshot in words', () => {
  it('asks the describer, and counts what it cost', async () => {
    const wire = screenshotWire({ listed: false });
    const engine = await engineFor(wire);
    const calls: unknown[] = [];
    const events = await collect(engine.runTurn(turn({ describe: describer(calls) })));
    expect(calls).toEqual([{ count: 1, what: 'a screenshot of a web page in Conch’s browser' }]);
    const sent = wire.results[0]?.[0];
    expect(sent?.images).toBeUndefined();
    expect(sent?.text).toContain('Screenshot of “Shop”');
    expect(sent?.text).toContain('a blue “Buy” button at 900,610');
    expect(wire.requests.some((r) => r.messages.some(hasPictures))).toBe(false);
    // The person sees the same words on the tool's row.
    expect(events.find((e) => e.type === 'tool-end')).toMatchObject({
      output: expect.stringContaining('Buy'),
    });
    const done = events.at(-1);
    expect(done?.type === 'done' && done.usage?.inputTokens).toBeGreaterThanOrEqual(1_000);
  });

  it('says so plainly, with what to use instead, when no model can look', async () => {
    const wire = screenshotWire({ listed: false });
    const engine = await engineFor(wire);
    await collect(engine.runTurn(turn({ describe: async () => ({}) })));
    expect(wire.results[0]?.[0]?.text).toContain(NO_SIGHT);
    expect(NO_SIGHT).toMatch(/browser_read/);
    expect(NO_SIGHT).toMatch(/browser_handoff/);
  });

  it('describes a picture the person attached, too', async () => {
    const wire = screenshotWire({ listed: false });
    const engine = await engineFor(wire);
    const calls: unknown[] = [];
    await collect(
      engine.runTurn(
        turn({
          tools: [],
          images: [{ name: 'cat.jpg', mimeType: 'image/jpeg', data: JPEG }],
          describe: describer(calls),
        }),
      ),
    );
    expect(calls).toEqual([{ count: 1, what: 'pictures the person attached to their message' }]);
    const first = wire.requests[0]?.messages[0];
    expect(first?.images).toBeUndefined();
    expect(String(first?.content)).toContain('a blue “Buy” button');
  });
});

describe('a model that turns out not to see heals by itself', () => {
  it('learns it’s blind, puts the pictures into words and asks once more', async () => {
    // Nothing said it couldn't see, so the picture went; the provider refused it.
    const wire = screenshotWire({ sees: true, refuse: 1 });
    const engine = await engineFor(wire);
    const calls: unknown[] = [];
    const events = await collect(engine.runTurn(turn({ describe: describer(calls) })));
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'notice', code: 'no-images' }));
    // Refused with the picture, then asked again with words in its place.
    expect(wire.requests[1]?.messages.some(hasPictures)).toBe(true);
    const healed = wire.requests[2];
    expect(healed?.messages.some(hasPictures)).toBe(false);
    expect(JSON.stringify(healed?.messages)).toContain('a blue “Buy” button');
    expect(calls).toHaveLength(1);
    // Blind for the rest of the session, in the list too: the next screenshot goes as words.
    expect((await engine.capabilities()).models[0]?.images).toBe(false);
    const second = await collect(engine.runTurn(turn({ describe: describer(calls) })));
    expect(second.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
    expect(calls).toHaveLength(2);
    expect(wire.results.at(-1)?.[0]?.images).toBeUndefined();
  });

  it('heals only once: a provider that refuses again is the turn’s error', async () => {
    const wire = screenshotWire({ sees: true });
    wire.stream = () => refusing();
    const engine = await engineFor(wire);
    const events = await collect(
      engine.runTurn(
        turn({ tools: [], images: [{ name: 'a.jpg', mimeType: 'image/jpeg', data: JPEG }] }),
      ),
    );
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'error' });
  });
});

describe('withSight', () => {
  it('asks whether the model sees on every call', async () => {
    let sees = true;
    const tools = withSight(
      new Map([
        [
          'shot',
          {
            spec: { name: 'shot', description: '', schema: {} },
            display: 'mcp__conch__browser_screenshot',
            run: async () => ({
              text: 'Shot.',
              isError: false,
              images: [{ data: JPEG, mimeType: 'image/jpeg' as const }],
            }),
          },
        ],
      ]),
      { sees: () => sees, signal: new AbortController().signal },
    );
    const tool = tools.get('shot');
    expect((await tool?.run({}, '1'))?.images).toHaveLength(1);
    sees = false;
    const blind = await tool?.run({}, '2');
    expect(blind?.images).toBeUndefined();
    expect(blind?.text).toBe(`Shot.\n\n${NO_SIGHT}`);
  });
});

describe('reading a refusal of pictures', () => {
  it('OpenRouter’s 404 for a model with no endpoint that sees', () => {
    expect(
      openrouterError(404, { message: 'No endpoints found that support image input' }, undefined)
        .kind,
    ).toBe('images');
    // An ordinary 404 is still a missing model.
    expect(openrouterError(404, { message: 'Model not found' }, undefined).kind).toBe('not-found');
  });

  it('the chat APIs, Anthropic and Ollama', () => {
    const preset = { label: 'OpenAI' };
    expect(
      mapChatError(
        400,
        { message: 'Invalid content type. image_url is only supported by certain models.' },
        undefined,
        preset,
      ).kind,
    ).toBe('images');
    expect(
      mapChatError(400, { message: 'Invalid value for temperature' }, undefined, preset).kind,
    ).toBe('other');
    expect(
      anthropicError(
        400,
        { type: 'invalid_request_error', message: 'This model does not support image input.' },
        undefined,
      ).kind,
    ).toBe('images');
    expect(
      ollamaError(500, 'this model is missing data required for image input', 'qwen3').kind,
    ).toBe('images');
  });
});

describe('which models see, by provider', () => {
  it('reads OpenRouter’s modalities, and tries one it doesn’t list', async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse({
        data: [
          {
            id: 'a/sees',
            name: 'Sees',
            supported_parameters: ['tools'],
            architecture: { input_modalities: ['text', 'image'] },
          },
          {
            id: 'a/blind',
            name: 'Blind',
            supported_parameters: ['tools'],
            architecture: { input_modalities: ['text'] },
          },
        ],
      }),
    );
    const wire = new OpenRouterWire(fetch);
    await wire.models({});
    expect(wire.seesFor('a/sees')).toBe(true);
    expect(wire.seesFor('a/blind')).toBe(false);
    expect(wire.seesFor('a/unlisted')).toBe(true);
  });

  it('uses a preset’s rule for a list that says nothing', async () => {
    const preset = (id: string) => presetOf(id);
    const list = (ids: string[]) =>
      fakeFetch(() => jsonResponse({ data: ids.map((id) => ({ id, object: 'model' })) })).fetch;
    const openai = new OpenAiWire(preset('openai'), list(['gpt-5.1']));
    await openai.models({ key: 'k' });
    expect(openai.seesFor('gpt-5.1')).toBe(true);
    const deepseek = new OpenAiWire(preset('deepseek'), list(['deepseek-chat']));
    const models = await deepseek.models({ key: 'k' });
    expect(models[0]?.info.images).toBe(false);
    const groq = new OpenAiWire(
      preset('groq'),
      list(['meta-llama/llama-4-scout-17b', 'llama-3.3-70b']),
    );
    await groq.models({ key: 'k' });
    expect(groq.seesFor('meta-llama/llama-4-scout-17b')).toBe(true);
    expect(groq.seesFor('llama-3.3-70b')).toBe(false);
  });

  it('bridges a tool and the pictures after it in Mistral’s request, and sends no stray field', async () => {
    const { fetch, calls } = fakeFetch(() =>
      sseResponse(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      ),
    );
    const wire = new OpenAiWire(presetOf('mistral'), fetch);
    await drain(
      wire.stream({
        key: 'k',
        model: 'mistral-medium-latest',
        system: 'sys',
        messages: [
          { role: 'user', content: 'Look' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 's', arguments: '{}' } }],
          },
          ...wire.toolResults([
            {
              id: 'c1',
              name: 's',
              text: 'Shot.',
              isError: false,
              images: [{ data: JPEG, mimeType: 'image/jpeg' }],
            },
          ]),
        ],
        tools: [],
        effort: 'auto',
        signal: new AbortController().signal,
      }),
    );
    const body = calls[0]?.body as { messages: { role: string }[] };
    expect(body.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'user',
    ]);
  });

  it('sends pictures with a one-off completion, for describing', async () => {
    const { fetch, calls } = fakeFetch(() =>
      sseResponse(
        'data: {"choices":[{"delta":{"content":"A shop."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      ),
    );
    const wire = new OpenAiWire(presetOf('openai'), fetch);
    const reply = await wire.complete({
      key: 'k',
      model: 'gpt-5.1-mini',
      system: 'Describe.',
      prompt: 'This screenshot.',
      images: [{ data: JPEG, mimeType: 'image/jpeg' }],
      maxTokens: 300,
      signal: new AbortController().signal,
    });
    expect(reply.text).toBe('A shop.');
    const body = calls[0]?.body as { messages: { content: unknown }[] };
    expect(body.messages[1]?.content).toEqual([
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${JPEG}` } },
      { type: 'text', text: 'This screenshot.' },
    ]);
  });
});
