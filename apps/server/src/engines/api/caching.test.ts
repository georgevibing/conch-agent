/**
 * Prompt caching on every provider that has it (ADR 0085), and what it saves.
 *
 * The savings test drives a real `ApiEngine` through a twelve-step tool loop
 * against a pretend Anthropic that caches the way Anthropic documents it: a
 * prefix is written at each breakpoint, and a later request reads the longest
 * one it finds within 20 blocks back. The bill is then priced both ways.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { costAt, priceOf } from '../../usage/prices';
import type { EngineEvent, HostTool, TurnInput } from '../types';
import { cached, AnthropicWire } from './anthropic';
import { usageFrom } from './chat';
import { ApiEngine } from './engine';
import {
  collect,
  dataFrames,
  fakeFetch,
  fakeHome,
  jsonResponse,
  namedFrames,
  sseResponse,
} from './fake';
import { OpenRouterWire } from './openrouter';
import type { WireRequest } from './types';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Where the breakpoints are in an Anthropic body, block by block. */
function blocks(body: Record<string, unknown>): { json: string; mark: boolean }[] {
  const out: { json: string; mark: boolean }[] = [];
  const push = (block: unknown, role?: string) => {
    const mark = isRecord(block) && 'cache_control' in block;
    const plain = isRecord(block) ? { ...block, cache_control: undefined } : block;
    out.push({ json: JSON.stringify({ role, plain }), mark });
  };
  for (const tool of (body.tools as unknown[] | undefined) ?? []) push(tool);
  for (const block of (body.system as unknown[] | undefined) ?? []) push(block);
  for (const message of body.messages as { role: string; content: unknown }[]) {
    // A plain string is the same text block as one marked for the cache.
    const content =
      typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : (message.content as unknown[]);
    for (const block of content) push(block, message.role);
  }
  return out;
}

describe('Anthropic cache breakpoints', () => {
  const request = (messages: WireRequest['messages']) => ({
    system: 'You are Pearl.',
    tools: [
      { name: 'a', description: 'A', schema: { type: 'object' } },
      { name: 'b', description: 'B', schema: { type: 'object' } },
    ],
    messages,
  });

  it('marks the tools, the system prompt and the newest two of the person’s side', () => {
    const messages = [
      { role: 'user', content: 'Book a table' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'a', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'b', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'done' }] },
    ];
    const body = cached(request(messages));
    const marks = blocks(body as Record<string, unknown>).filter((b) => b.mark);
    expect(marks).toHaveLength(4);
    expect((body.tools as { cache_control?: unknown }[])[1]?.cache_control).toEqual({
      type: 'ephemeral',
    });
    expect((body.tools as { cache_control?: unknown }[])[0]?.cache_control).toBeUndefined();
    expect(body.system).toEqual([
      { type: 'text', text: 'You are Pearl.', cache_control: { type: 'ephemeral' } },
    ]);
    expect(JSON.stringify(body.messages[0])).not.toContain('cache_control');
    expect(JSON.stringify(body.messages[2])).toContain('cache_control');
    expect(JSON.stringify(body.messages[4])).toContain('cache_control');
    // What's kept in the transcript is never changed.
    expect(JSON.stringify(messages)).not.toContain('cache_control');
  });

  it('turns a plain message into a block it can mark, and never marks thinking', () => {
    const body = cached(request([{ role: 'user', content: 'Hi' }]));
    expect(body.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'Hi', cache_control: { type: 'ephemeral' } }],
    });
    const odd = cached(request([{ role: 'user', content: [{ type: 'thinking', thinking: '' }] }]));
    expect(JSON.stringify(odd.messages)).not.toContain('cache_control');
  });
});

describe('what caching saves on a long turn', () => {
  /** A pretend Anthropic with Anthropic's documented cache rules, counting a token as four characters. */
  function pretendAnthropic(steps: number) {
    const written = new Set<string>();
    let step = 0;
    const tokens = (list: { json: string }[]) =>
      list.reduce((n, b) => n + Math.ceil(b.json.length / 4), 0);
    const hash = (list: { json: string }[]) =>
      createHash('sha256')
        .update(list.map((b) => b.json).join('\u0000'))
        .digest('hex');
    return fakeFetch((call) => {
      if (call.url.includes('/v1/models'))
        return jsonResponse({
          data: [
            { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5', max_input_tokens: 1_000_000 },
          ],
          has_more: false,
        });
      const all = blocks(call.body as Record<string, unknown>);
      const marks = all.flatMap((b, i) => (b.mark ? [i] : []));
      let read = 0;
      for (const mark of marks)
        for (let j = mark; j >= Math.max(0, mark - 20); j--)
          if (written.has(hash(all.slice(0, j + 1)))) {
            read = Math.max(read, tokens(all.slice(0, j + 1)));
            break;
          }
      for (const mark of marks) written.add(hash(all.slice(0, mark + 1)));
      const last = marks.at(-1);
      const upTo = last === undefined ? 0 : tokens(all.slice(0, last + 1));
      const write = Math.max(0, upTo - read);
      const usage = {
        input_tokens: tokens(all) - read - write,
        cache_read_input_tokens: read,
        cache_creation_input_tokens: write,
      };
      step++;
      const id = `toolu_${step}`;
      const frames: [string, unknown][] = [
        [
          'message_start',
          { type: 'message_start', message: { usage: { ...usage, output_tokens: 1 } } },
        ],
        step < steps
          ? [
              'content_block_start',
              {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'tool_use', id, name: 'mcp__conch__remember', input: {} },
              },
            ]
          : [
              'content_block_start',
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            ],
        step < steps
          ? [
              'content_block_delta',
              {
                type: 'content_block_delta',
                index: 0,
                delta: {
                  type: 'input_json_delta',
                  partial_json: JSON.stringify({ content: `fact ${step}` }),
                },
              },
            ]
          : [
              'content_block_delta',
              {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: 'All saved.' },
              },
            ],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        [
          'message_delta',
          {
            type: 'message_delta',
            delta: { stop_reason: step < steps ? 'tool_use' : 'end_turn' },
            usage: { output_tokens: 60 },
          },
        ],
        ['message_stop', { type: 'message_stop' }],
      ];
      return sseResponse(namedFrames(...frames), { chunk: 4096 });
    });
  }

  it('costs well under half on a twelve-step turn, and says what came from the cache', async () => {
    const { home, settings, keys } = await fakeHome();
    await keys.save('anthropic-api', 'a-fake-anthropic-key');
    const api = pretendAnthropic(12);
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
    // Conch's real instructions and tools are tens of thousands of tokens; this is a modest share.
    const filler = (i: number): HostTool => ({
      name: `tool_${i}`,
      description: `A tool that does thing number ${i}. `.repeat(20),
      input: { value: z.string().describe('What to do it with.') },
      run: async () => 'ok',
    });
    const remember: HostTool<{ content: z.ZodString }> = {
      name: 'remember',
      description: 'Save a fact.',
      input: { content: z.string() },
      run: async () => 'Saved.',
    };
    const input: TurnInput = {
      conversationId: 'c_cache',
      prompt: 'Save these twelve facts',
      systemAppend: `# Who you are\nYou are Pearl.\n\n${'Guidance for every turn. '.repeat(1_500)}`,
      cwd: process.cwd(),
      tools: [remember as HostTool, ...Array.from({ length: 30 }, (_, i) => filler(i))],
      requestPermission: async () => 'allow',
      signal: new AbortController().signal,
      options: {
        model: 'claude-sonnet-5',
        effort: 'auto',
        fastMode: false,
        permissionMode: 'default',
      },
    };
    const events = await collect(engine.runTurn(input));
    const done = events.at(-1) as Extract<EngineEvent, { type: 'done' }>;
    expect(done).toMatchObject({ type: 'done', outcome: 'success' });
    const usage = done.usage;
    if (!usage) throw new Error('no usage');
    // Most of what each step sent came from the cache, and the turn says so.
    expect(usage.cachedInputTokens).toBeGreaterThan(usage.inputTokens * 0.8);
    expect(usage.cacheWriteTokens).toBeGreaterThan(0);

    const price = priceOf('claude-sonnet-5');
    if (!price) throw new Error('no price');
    const withCache = costAt(price, usage);
    const without = costAt(price, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    const saved = 1 - withCache / without;
    // Measured: about 80% less on this turn (twelve requests over a ~25K-token prefix).
    expect(saved).toBeGreaterThan(0.6);
  });
});

describe('caching through OpenRouter, and every provider’s cache count', () => {
  const frames = dataFrames(
    JSON.stringify({ choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }] }),
    JSON.stringify({
      choices: [],
      usage: {
        prompt_tokens: 10_339,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 10_318, cache_write_tokens: 12 },
        cost: 0.0012,
      },
    }),
    '[DONE]',
  );
  const ask = async (model: string) => {
    const api = fakeFetch(() => sseResponse(frames));
    const wire = new OpenRouterWire(api.fetch);
    const out: unknown[] = [];
    for await (const event of wire.stream({
      key: 'k',
      model,
      system: 'You are Pearl.',
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [],
      effort: 'auto',
      signal: new AbortController().signal,
    }))
      out.push(event);
    return { body: api.calls[0]?.body as Record<string, unknown>, events: out };
  };

  it('asks for Anthropic’s cache on Claude models, as OpenRouter documents', async () => {
    const { body, events } = await ask('anthropic/claude-sonnet-5');
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    expect((body.messages as unknown[])[0]).toEqual({
      role: 'system',
      content: [{ type: 'text', text: 'You are Pearl.', cache_control: { type: 'ephemeral' } }],
    });
    expect(events.at(-1)).toMatchObject({
      type: 'end',
      usage: {
        inputTokens: 10_339,
        cachedInputTokens: 10_318,
        cacheWriteTokens: 12,
        costUsd: 0.0012,
      },
    });
  });

  it('marks only the system prompt for Gemini, and leaves the others to cache by themselves', async () => {
    const gemini = await ask('google/gemini-3-pro');
    expect(gemini.body.cache_control).toBeUndefined();
    expect(JSON.stringify((gemini.body.messages as unknown[])[0])).toContain('cache_control');
    const openai = await ask('openai/gpt-5.1');
    expect(JSON.stringify(openai.body)).not.toContain('cache_control');
    expect((openai.body.messages as unknown[])[0]).toEqual({
      role: 'system',
      content: 'You are Pearl.',
    });
  });

  it('reads cache hits in each provider’s own words', () => {
    // OpenAI, OpenRouter, Gemini, xAI.
    expect(
      usageFrom({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 80 } }),
    ).toMatchObject({
      cachedInputTokens: 80,
    });
    // DeepSeek's own fields.
    expect(
      usageFrom({ prompt_tokens: 100, prompt_cache_hit_tokens: 64, prompt_cache_miss_tokens: 36 }),
    ).toMatchObject({ cachedInputTokens: 64 });
    // Kimi's.
    expect(usageFrom({ prompt_tokens: 100, cached_tokens: 50 })).toMatchObject({
      cachedInputTokens: 50,
    });
  });

  it('reads cache writes in each provider’s own words, and only where there were some', () => {
    // OpenAI from GPT-5.6, and Kimi: reads and writes side by side.
    expect(
      usageFrom({
        prompt_tokens: 2_000,
        prompt_tokens_details: { cached_tokens: 1_024, cache_write_tokens: 900 },
      }),
    ).toEqual({
      inputTokens: 2_000,
      outputTokens: 0,
      cachedInputTokens: 1_024,
      cacheWriteTokens: 900,
    });
    // Qwen's explicit cache.
    expect(
      usageFrom({
        prompt_tokens: 3_000,
        prompt_tokens_details: { cached_tokens: 0, cache_creation_input_tokens: 2_048 },
      }),
    ).toEqual({ inputTokens: 3_000, outputTokens: 0, cacheWriteTokens: 2_048 });
    // DeepSeek says it twice; it's counted once.
    expect(
      usageFrom({
        prompt_tokens: 100,
        prompt_cache_hit_tokens: 64,
        prompt_cache_miss_tokens: 36,
        prompt_tokens_details: { cached_tokens: 64 },
      }),
    ).toEqual({ inputTokens: 100, outputTokens: 0, cachedInputTokens: 64 });
    // Nothing from the cache is nothing said.
    expect(
      usageFrom({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: {} }),
    ).toEqual({ inputTokens: 100, outputTokens: 5 });
  });
});
