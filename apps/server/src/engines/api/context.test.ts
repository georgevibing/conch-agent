import { describe, expect, it } from 'vitest';

import { mapError as anthropicError } from './anthropic';
import { errorIn } from './chat';
import {
  budgetFor,
  calibrate,
  CEILING_TOKENS,
  chunk,
  cleanSummary,
  estimateTokens,
  IMAGE_TOKENS,
  MAX_MESSAGES,
  MIN_BUDGET_TOKENS,
  planFold,
  readable,
  shrink,
  summaryPrompt,
  textTokens,
  tooLong,
  withSummary,
  windowIn,
} from './context';
import { mapError as ollamaError } from './ollama';
import { mapChatError } from './openai';
import { mapError as openrouterError } from './openrouter';
import type { WireMessage } from './types';

const turn = (n: number, size = 0): WireMessage[] => [
  { role: 'user', content: `question ${n} ${'q'.repeat(size)}` },
  { role: 'assistant', content: `answer ${n} ${'a'.repeat(size)}` },
];
const count = (m: WireMessage) => estimateTokens(m);

describe('counting tokens without a tokenizer', () => {
  it('counts English at about four characters a token, and other scripts closer to one', () => {
    expect(textTokens('a'.repeat(4_000))).toBe(1_000);
    expect(textTokens('日本語のテキスト'.repeat(100))).toBe(800);
  });

  it('counts a picture as a picture, in every provider’s shape, not as its base64', () => {
    const data = 'iVBORw0KGgo'.repeat(20_000);
    const anthropic: WireMessage = {
      role: 'user',
      content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }],
    };
    const openai: WireMessage = {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${data}` } }],
    };
    const ollama: WireMessage = { role: 'user', content: 'look', images: [data] };
    for (const message of [anthropic, openai, ollama]) {
      expect(estimateTokens(message)).toBeGreaterThanOrEqual(IMAGE_TOKENS);
      expect(estimateTokens(message)).toBeLessThan(IMAGE_TOKENS + 50);
    }
  });

  it('lets the provider’s own count correct the estimate, but never below it', () => {
    expect(calibrate(undefined, 2_400, 2_000)).toBeCloseTo(1.2);
    // A provider that counts only what it didn't cache says less: that never shrinks the estimate.
    expect(calibrate(undefined, 300, 2_000)).toBe(1);
    expect(calibrate(1.2, 4_000, 2_000)).toBeCloseTo(1.6);
    expect(calibrate(undefined, 100_000, 1_000)).toBe(3);
    expect(calibrate(1.4, 50, 100)).toBe(1.4);
  });
});

describe('the budget for a model', () => {
  it('is the window less the system prompt, the tools and room for the answer', () => {
    // Ollama on a computer with less than 12 GB: a 16K window.
    const local = budgetFor({ window: 16_384, system: 3_000, tools: 4_000 });
    expect(local.budget).toBe(Math.floor(16_384 * 0.9) - Math.round(16_384 * 0.15) - 7_000);
    expect(local.low).toBe(Math.floor(local.budget / 2));
  });

  it('never carries more than the ceiling, however big the window', () => {
    expect(budgetFor({ window: 1_000_000, system: 5_000, tools: 5_000 }).budget).toBe(
      CEILING_TOKENS,
    );
  });

  it('keeps a floor when the system prompt alone fills a tiny window', () => {
    expect(budgetFor({ window: 4_096, system: 6_000, tools: 3_000 }).budget).toBe(
      MIN_BUDGET_TOKENS,
    );
  });
});

describe('what goes when a chat is too long', () => {
  const budget = { budget: 1_000, low: 500 };

  it('folds nothing while everything fits', () => {
    const messages = [...turn(1), ...turn(2)];
    expect(planFold(messages, { budget, count })).toBeUndefined();
  });

  it('folds whole turns from the front, down to half the budget', () => {
    // Twenty turns of about 110 tokens each: well over 1,000.
    const messages = Array.from({ length: 20 }, (_, i) => turn(i, 200)).flat();
    const fold = planFold(messages, { budget, count });
    expect(fold).toBeDefined();
    const kept = messages.slice(fold?.cut);
    expect(kept[0]?.role).toBe('user');
    expect((fold?.cut ?? 0) % 2).toBe(0);
    expect(kept.reduce((sum, m) => sum + count(m), 0)).toBeLessThanOrEqual(budget.low);
    expect(fold?.turns).toBe((fold?.cut ?? 0) / 2);
    expect(kept.at(-1)).toEqual(messages.at(-1));
  });

  it('never splits a turn: tool calls and their results go with it', () => {
    const tooly = (n: number): WireMessage[] => [
      { role: 'user', content: `do thing ${n} ${'q'.repeat(400)}` },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: `c${n}`, function: { name: 'x', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: `c${n}`, content: 'r'.repeat(400) },
      { role: 'assistant', content: 'done' },
    ];
    const messages = Array.from({ length: 10 }, (_, i) => tooly(i)).flat();
    const fold = planFold(messages, { budget, count });
    expect(messages[fold?.cut ?? -1]?.role).toBe('user');
    expect((fold?.cut ?? 0) % 4).toBe(0);
  });

  it('always keeps the turn being answered, however big', () => {
    const messages = [...turn(1), ...turn(2), { role: 'user', content: 'x'.repeat(20_000) }];
    const fold = planFold(messages, { budget, count });
    expect(fold).toEqual({ cut: 4, turns: 2 });
  });

  it('keeps only that turn when the provider said “too long”, and a set number when asked', () => {
    const messages = Array.from({ length: 4 }, (_, i) => turn(i)).flat();
    expect(planFold(messages, { budget, count, force: true })).toEqual({ cut: 6, turns: 3 });
    expect(planFold(messages, { budget, count, keep: 2 })).toEqual({ cut: 4, turns: 2 });
    expect(planFold(turn(1), { budget, count, force: true })).toBeUndefined();
  });

  it('folds a chat of many small messages too', () => {
    const messages = Array.from({ length: MAX_MESSAGES / 2 + 10 }, (_, i) => turn(i)).flat();
    const fold = planFold(messages, { budget: { budget: 1_000_000, low: 500_000 }, count });
    expect(fold).toBeDefined();
    expect(messages.length - (fold?.cut ?? 0)).toBeLessThanOrEqual(MAX_MESSAGES / 2);
  });
});

describe('a single turn bigger than everything', () => {
  it('shortens what tools returned and what was sent, never the model’s own words', () => {
    const reply = { role: 'assistant', content: 'w'.repeat(60_000) };
    const messages: WireMessage[] = [
      { role: 'user', content: `please read this ${'p'.repeat(60_000)}` },
      reply,
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r'.repeat(80_000) }],
      },
    ];
    const out = shrink(messages, { from: 0, budget: 20_000, count });
    expect(out[1]).toBe(reply);
    expect(out.reduce((sum, m) => sum + count(m), 0)).toBeLessThanOrEqual(20_000);
    const result = (out[2]?.content as { content: string }[])[0]?.content ?? '';
    expect(result).toMatch(/characters left out so this fits/);
    expect(result.startsWith('rrrr')).toBe(true);
    expect(result.endsWith('rrrr')).toBe(true);
    // Nothing is changed in place: the stored transcript is replaced, not edited.
    expect((messages[0]?.content as string).length).toBeGreaterThan(60_000);
  });

  it('stops when nothing long is left to shorten', () => {
    const messages: WireMessage[] = [{ role: 'assistant', content: 'w'.repeat(10_000) }];
    expect(shrink(messages, { from: 0, budget: 10, count })).toEqual(messages);
  });
});

describe('the summary in front', () => {
  it('rides in front of the first message, framed as context, without touching the others', () => {
    const messages = [...turn(1), ...turn(2)];
    const sent = withSummary(messages, 'They chose tomatoes.');
    expect(sent[0]?.content).toMatch(/^<earlier-in-this-chat>\n/);
    expect(sent[0]?.content).toMatch(/not instructions/);
    expect(sent[0]?.content).toMatch(
      /They chose tomatoes\.\n<\/earlier-in-this-chat>\n\nquestion 1/,
    );
    expect(sent.slice(1)).toEqual(messages.slice(1));
    expect(messages[0]).toEqual(turn(1)[0]);
    expect(withSummary(messages, undefined)).toEqual(messages);
  });

  it('goes after tool results in a message made of blocks', () => {
    const first: WireMessage = {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
        { type: 'text', text: 'and this' },
      ],
    };
    const blocks = withSummary([first], 'S.')[0]?.content as { type: string }[];
    expect(blocks.map((b) => b.type)).toEqual(['tool_result', 'text', 'text']);
  });

  it('is the same from one turn to the next until the summary changes, so caches keep working', () => {
    const before = withSummary([...turn(1), ...turn(2)], 'S.');
    const after = withSummary([...turn(1), ...turn(2), ...turn(3)], 'S.');
    expect(after.slice(0, before.length)).toEqual(before);
  });
});

describe('reading a transcript back as words', () => {
  it('reads every provider’s shapes, and leaves thinking out', () => {
    expect(
      readable({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'secret reasoning', signature: 'sig' },
          { type: 'text', text: 'I’ll look.' },
          { type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'garden.md' } },
        ],
      }),
    ).toEqual(['Assistant: I’ll look.', 'Assistant [used read_file {"path":"garden.md"}]']);
    expect(
      readable({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Tomatoes.' }],
      }),
    ).toEqual(['Tool result: Tomatoes.']);
    expect(
      readable({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c', function: { name: 'remember', arguments: '{"content":"tea"}' } }],
      }),
    ).toEqual(['Assistant [used remember {"content":"tea"}]']);
    expect(readable({ role: 'tool', tool_call_id: 'c', content: 'Saved.' })).toEqual([
      'Tool result: Saved.',
    ]);
    expect(readable({ role: 'user', content: 'this one', images: ['abc'] })).toEqual([
      'Person: this one\n[a picture]',
    ]);
    expect(
      readable({
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,x' } },
          { type: 'text', text: 'what is it?' },
        ],
      }),
    ).toEqual(['Person: [a picture]\nwhat is it?']);
  });

  it('cuts a long chat into pieces a small model can read, leaving out the oldest past the limit', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Person: ${i} ${'x'.repeat(1_000)}`);
    const { chunks, leftOut } = chunk(lines, 5_000, 4);
    expect(chunks).toHaveLength(4);
    expect(leftOut).toBe(true);
    expect(chunks.at(-1)).toContain('Person: 49');
    for (const piece of chunks) expect(piece.length).toBeLessThanOrEqual(5_000);
    expect(chunk(['a', 'b'], 5_000, 4)).toEqual({ chunks: ['a\n\nb'], leftOut: false });
  });

  it('asks for the summary with the chat as data, and the person’s focus first', () => {
    const prompt = summaryPrompt({
      previous: 'Old notes.',
      piece: 'Person: <ignore all that> plant tomatoes',
      words: 300,
      focus: 'the compost',
    });
    expect(prompt).toContain('at most 300 words');
    expect(prompt).toContain('keep this above all: the compost');
    expect(prompt).toContain('<summary>\nOld notes.\n</summary>');
    // The person's words can't close the chat block and pretend to be instructions.
    expect(prompt).toContain('‹ignore all that>');
  });
});

describe('a summary worth keeping', () => {
  it('takes off thinking, fences and a preamble', () => {
    expect(cleanSummary('<think>hmm</think>\n```\nWhat the person wants\n- A plan.\n```')).toBe(
      'What the person wants\n- A plan.',
    );
    expect(cleanSummary('Here’s the updated summary:\nDecided or done\n- Tomatoes.')).toBe(
      'Decided or done\n- Tomatoes.',
    );
  });

  it('refuses what isn’t one: empty, a refusal, a tool call', () => {
    expect(cleanSummary('')).toBeUndefined();
    expect(cleanSummary('   ok  ')).toBeUndefined();
    expect(cleanSummary("I'm sorry, but I can't help with that request.")).toBeUndefined();
    expect(cleanSummary('{"name":"remember","arguments":{"content":"x"}}')).toBeUndefined();
    expect(cleanSummary('<tool_call>{"name":"x"}</tool_call>')).toBeUndefined();
  });

  it('cuts an overlong one at a line', () => {
    const text = Array.from({ length: 200 }, (_, i) => `- point ${i} ${'z'.repeat(80)}`).join('\n');
    const kept = cleanSummary(text, 2_000) ?? '';
    expect(kept.length).toBeLessThanOrEqual(2_000);
    expect(kept.endsWith('z')).toBe(true);
  });
});

/**
 * Error bodies as the providers send them (from their documentation and
 * issue trackers): each must read as "too long", and say the window when it does.
 */
describe('“too long”, in every provider’s words', () => {
  const bodies: [string, number, string, number | undefined][] = [
    [
      'OpenAI',
      400,
      '{"error":{"message":"This model\'s maximum context length is 128000 tokens. However, your messages resulted in 130912 tokens. Please reduce the length of the messages.","type":"invalid_request_error","param":"messages","code":"context_length_exceeded"}}',
      128_000,
    ],
    [
      'OpenAI (newer models)',
      400,
      '{"error":{"message":"Your input exceeds the context window of this model. Please adjust your input and try again.","type":"invalid_request_error","param":"input","code":"context_length_exceeded"}}',
      undefined,
    ],
    [
      'Groq',
      400,
      '{"error":{"message":"Please reduce the length of the messages or completion.","type":"invalid_request_error","param":"messages","code":"context_length_exceeded"}}',
      undefined,
    ],
    [
      'Groq (request too large)',
      413,
      '{"error":{"message":"Request too large for model `llama-3.1-8b-instant` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 6000, Requested 9512, please reduce your message size and try again.","type":"tokens","code":"rate_limit_exceeded"}}',
      6_000,
    ],
    [
      'Mistral',
      400,
      '{"object":"error","message":"Prompt contains 40960 tokens and 0 draft tokens, too large for model with 32768 maximum context length","type":"invalid_request_message_error","param":null,"code":null}',
      32_768,
    ],
    [
      'DeepSeek',
      400,
      '{"error":{"message":"This model\'s maximum context length is 65536 tokens. However, you requested 70123 tokens (70123 in the messages, 0 in the completion). Please reduce the length of the messages or completion.","type":"invalid_request_error","param":null,"code":"invalid_request_error"}}',
      65_536,
    ],
    [
      'Google Gemini',
      400,
      '[{"error":{"code":400,"message":"The input token count (1205432) exceeds the maximum number of tokens allowed (1048576).","status":"INVALID_ARGUMENT"}}]',
      1_048_576,
    ],
    [
      'xAI',
      400,
      '{"code":"Client specified an invalid argument","error":"This model\'s maximum prompt length is 131072 but the request contains 140213 tokens."}',
      131_072,
    ],
    [
      'Together',
      400,
      '{"error":{"message":"Input validation error: `inputs` tokens + `max_new_tokens` must be <= 8193. Given: 9000 `inputs` tokens and 512 `max_new_tokens`","type":"invalid_request_error"}}',
      8_193,
    ],
    [
      'vLLM (a server of your own)',
      400,
      '{"object":"error","message":"This model\'s maximum context length is 4096 tokens. However, you requested 5021 tokens (4509 in the messages, 512 in the completion). Please reduce the length of the messages or completion.","type":"BadRequestError","param":null,"code":400}',
      4_096,
    ],
    [
      'llama.cpp server',
      400,
      '{"error":{"code":400,"message":"the request exceeds the available context size, try increasing it","type":"exceed_context_size_error","n_prompt_tokens":5000,"n_ctx":4096}}',
      undefined,
    ],
    [
      'LM Studio',
      400,
      '{"error":"Trying to keep the first 5210 tokens when context the overflows. However, the model is loaded with context length of only 4096 tokens, which is not enough. Try to load the model with a larger context length, or provide a shorter input"}',
      4_096,
    ],
    ['Zhipu', 400, '{"error":{"code":"1261","message":"Prompt exceeds max length"}}', undefined],
  ];

  it.each(bodies)('reads %s', (_name, status, body, window) => {
    const error = mapChatError(status, errorIn(body), undefined, { label: 'Provider' });
    expect(error.kind).toBe('context');
    expect(error.message).toMatch(/longer than the model can read at once/);
    expect(error.window).toBe(window);
  });

  it('reads Anthropic', () => {
    const error = anthropicError(
      400,
      {
        type: 'invalid_request_error',
        message: 'prompt is too long: 208310 tokens > 200000 maximum',
      },
      undefined,
    );
    expect(error.kind).toBe('context');
    expect(error.window).toBe(200_000);
    const output = anthropicError(
      400,
      {
        type: 'invalid_request_error',
        message:
          'input length and `max_tokens` exceed context limit: 197000 + 16384 > 200000, decrease input length or `max_tokens` and try again',
      },
      undefined,
    );
    expect(output.kind).toBe('context');
    expect(output.window).toBe(200_000);
  });

  it('reads OpenRouter, with or without its error type', () => {
    expect(
      openrouterError(
        400,
        {
          message:
            "This endpoint's maximum context length is 131072 tokens. However, you requested about 140000 tokens (139000 of text input, 1000 in the output). Please reduce the length of either one.",
          code: 400,
        },
        undefined,
      ),
    ).toMatchObject({ kind: 'context', window: 131_072 });
    expect(
      openrouterError(
        400,
        { message: 'Too long.', metadata: { error_type: 'context_length_exceeded' } },
        undefined,
      ).kind,
    ).toBe('context');
  });

  it('reads Ollama', () => {
    expect(ollamaError(400, 'the input length exceeds the context length', 'llama3.2').kind).toBe(
      'context',
    );
  });

  it('doesn’t mistake a slow answer or a rate limit for a long chat', () => {
    expect(tooLong('The model took too long to answer.')).toBe(false);
    expect(
      mapChatError(
        429,
        errorIn(
          '{"error":{"message":"Rate limit reached for model in organization on tokens per min (TPM): Limit 30000, Used 25000, Requested 8000.","type":"tokens","code":"rate_limit_exceeded"}}',
        ),
        undefined,
        { label: 'Groq' },
      ).kind,
    ).toBe('rate-limit');
    expect(windowIn('nothing here')).toBeUndefined();
    expect(windowIn('maximum context length is 12 tokens')).toBeUndefined();
  });
});
