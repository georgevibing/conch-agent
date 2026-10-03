import { describe, expect, it } from 'vitest';

import { errorIn, readChatStream, ThinkSplitter } from './chat';
import { dataFrames, sseResponse } from './fake';
import { ApiError, type WireEvent } from './types';

async function drain(events: AsyncIterable<WireEvent>): Promise<WireEvent[]> {
  const out: WireEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const dialect = {
  label: 'Test',
  fail: (error: { message?: string | null }) => new ApiError('other', error.message ?? 'failed'),
};

const read = (frames: string[], extra: Partial<Parameters<typeof readChatStream>[2]> = {}) =>
  drain(
    readChatStream(
      sseResponse(dataFrames(...frames)).body as ReadableStream<Uint8Array>,
      new AbortController().signal,
      { ...dialect, ...extra },
    ),
  );

const chunk = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ choices: [{ delta, finish_reason: null }], ...extra });

describe('reading a streamed chat turn', () => {
  it('shows thinking from whichever field the provider uses', async () => {
    const events = await read([
      chunk({ reasoning_content: 'Hmm, ' }),
      chunk({ reasoning: 'let me see. ' }),
      chunk({ content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'Checking.' }] }] }),
      chunk({ content: 'Hello' }),
      '[DONE]',
    ]);
    expect(
      events.filter((e) => e.type === 'thinking').map((e) => (e as { delta: string }).delta),
    ).toEqual(['Hmm, ', 'let me see. ', 'Checking.']);
    expect(events.at(-1)).toMatchObject({
      type: 'end',
      message: { content: 'Hello' },
      stop: 'end',
    });
  });

  it('keeps the thinking on the message for a provider that wants it back', async () => {
    const events = await read([chunk({ reasoning_content: 'Plan.' }), chunk({ content: 'Done' })], {
      replayReasoning: 'reasoning_content',
    });
    expect(events.at(-1)).toMatchObject({
      type: 'end',
      message: { role: 'assistant', content: 'Done', reasoning_content: 'Plan.' },
    });
  });

  it('turns <think> tags into thinking, and keeps them in the message as sent', async () => {
    const events = await read(
      [
        chunk({ content: '<thi' }),
        chunk({ content: 'nk>quietly</th' }),
        chunk({ content: 'ink>Aloud' }),
      ],
      { thinkTags: true },
    );
    expect(events.filter((e) => e.type === 'thinking')).toEqual([
      { type: 'thinking', delta: 'quietly' },
    ]);
    expect(events.filter((e) => e.type === 'text')).toEqual([{ type: 'text', delta: 'Aloud' }]);
    expect(events.at(-1)).toMatchObject({ message: { content: '<think>quietly</think>Aloud' } });
  });

  it('stitches tool calls, keyed by index, by id, or by arrival, and keeps thought signatures', async () => {
    const events = await read([
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'call_a',
            function: { name: 'remember', arguments: '{"con' },
            extra_content: { google: { thought_signature: 'sig' } },
          },
        ],
      }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: 'tent":"tea"}' } }] }),
      chunk({
        tool_calls: [{ id: 'call_b', function: { name: 'search', arguments: { q: 'x' } } }],
      }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
    ]);
    const end = events.at(-1) as Extract<WireEvent, { type: 'end' }>;
    expect(end.stop).toBe('tools');
    expect(end.toolCalls).toEqual([
      { id: 'call_a', name: 'remember', argumentsJson: '{"content":"tea"}' },
      { id: 'call_b', name: 'search', argumentsJson: '{"q":"x"}' },
    ]);
    expect(end.message.tool_calls).toEqual([
      {
        id: 'call_a',
        type: 'function',
        function: { name: 'remember', arguments: '{"content":"tea"}' },
        extra_content: { google: { thought_signature: 'sig' } },
      },
      { id: 'call_b', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } },
    ]);
  });

  it('counts usage once, wherever it arrives, and the last word wins', async () => {
    const events = await read([
      chunk({ content: 'Hi' }, { usage: { prompt_tokens: 3, completion_tokens: 1 } }),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        x_groq: { usage: { prompt_tokens: 11, completion_tokens: 4 } },
      }),
    ]);
    expect(events.filter((e) => e.type === 'end')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ usage: { inputTokens: 11, outputTokens: 4 } });
  });

  it('fails in words on an error frame after the 200', async () => {
    await expect(
      read([chunk({ content: 'Hi' }), JSON.stringify({ error: { message: 'Overloaded' } })]),
    ).rejects.toThrow('Overloaded');
  });
});

describe('splitting <think> tags', () => {
  it('waits for a tag cut in half, and flushes what never closed', () => {
    const split = new ThinkSplitter();
    expect(split.push('Answer <')).toEqual({ text: 'Answer ', thinking: '' });
    expect(split.push('think>why')).toEqual({ text: '', thinking: 'why' });
    expect(split.push(' not</')).toEqual({ text: '', thinking: ' not' });
    expect(split.flush()).toEqual({ text: '', thinking: '</' });
  });

  it('leaves a lone angle bracket that isn’t a tag as words', () => {
    const split = new ThinkSplitter();
    expect(split.push('1 < 2')).toEqual({ text: '1 < 2', thinking: '' });
    expect(split.push(' and <b')).toEqual({ text: ' and <b', thinking: '' });
  });
});

describe('reading an error body, in every shape providers send', () => {
  it.each([
    [
      'OpenAI',
      '{"error":{"message":"Bad key","type":"invalid_request_error","code":"invalid_api_key"}}',
      { message: 'Bad key', code: 'invalid_api_key' },
    ],
    [
      'Gemini, in an array',
      '[{"error":{"code":400,"message":"Please pass a valid API key","status":"INVALID_ARGUMENT"}}]',
      { message: 'Please pass a valid API key', status: 'INVALID_ARGUMENT' },
    ],
    [
      'xAI, a string',
      '{"code":"invalid-argument","error":"Incorrect API key provided."}',
      { message: 'Incorrect API key provided.', code: 'invalid-argument' },
    ],
    ['Mistral', '{"detail":"Invalid API Key"}', { message: 'Invalid API Key' }],
    [
      'Cerebras, at the top',
      '{"message":"Wrong API Key","type":"invalid_request_error","code":"wrong_api_key"}',
      { message: 'Wrong API Key', code: 'wrong_api_key' },
    ],
    [
      'NVIDIA problem+json',
      '{"status":403,"title":"Forbidden","detail":"Authorization failed"}',
      { message: 'Authorization failed' },
    ],
    [
      'MiniMax',
      '{"type":"error","error":{"type":"authorized_error","message":"login fail (1004)"}}',
      { message: 'login fail (1004)', type: 'authorized_error' },
    ],
  ])('%s', (_name, body, expected) => {
    expect(errorIn(body)).toMatchObject(expected);
  });

  it('says nothing about a body that isn’t JSON', () => {
    expect(errorIn('<html>Bad gateway</html>')).toBeUndefined();
  });
});
