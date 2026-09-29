import { describe, expect, it } from 'vitest';

import { dataFrames, namedFrames, sseResponse } from './fake';
import { sseEvents, sseLines } from './sse';

async function read<T>(events: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const event of events) out.push(event);
  return out;
}

function body(text: string, chunk = 3): ReadableStream<Uint8Array> {
  const response = sseResponse(text, { chunk });
  if (!response.body) throw new Error('no body');
  return response.body;
}

describe('SSE lines', () => {
  it('stitches lines back together across chunk boundaries', async () => {
    const lines = await read(sseLines(body('data: {"a":1}\n\ndata: {"b":2}\n\n', 2)));
    expect(lines).toEqual(['data: {"a":1}', '', 'data: {"b":2}', '']);
  });

  it('handles \\r\\n without leaving a stray line', async () => {
    const lines = await read(sseLines(body('a\r\nb\r\n', 1)));
    expect(lines).toEqual(['a', 'b']);
  });

  it('delivers a last line with no newline after it', async () => {
    expect(await read(sseLines(body('data: tail', 4)))).toEqual(['data: tail']);
  });
});

describe('SSE frames', () => {
  it('skips keep-alive comments, which would crash a parser', async () => {
    const text = `: OPENROUTER PROCESSING\n\n${dataFrames('{"a":1}')}: OPENROUTER PROCESSING\n\n${dataFrames('[DONE]')}`;
    expect(await read(sseEvents(body(text)))).toEqual([{ data: '{"a":1}' }, { data: '[DONE]' }]);
  });

  it('reads the event name Anthropic sends alongside the data', async () => {
    const text = namedFrames(
      ['message_start', { type: 'message_start' }],
      ['ping', { type: 'ping' }],
    );
    expect(await read(sseEvents(body(text)))).toEqual([
      { event: 'message_start', data: '{"type":"message_start"}' },
      { event: 'ping', data: '{"type":"ping"}' },
    ]);
  });

  it('joins several data lines in one frame', async () => {
    expect(await read(sseEvents(body('data: one\ndata: two\n\n')))).toEqual([{ data: 'one\ntwo' }]);
  });

  it('delivers a frame the provider never closed with a blank line', async () => {
    expect(await read(sseEvents(body('data: {"a":1}\n')))).toEqual([{ data: '{"a":1}' }]);
  });

  it('stops when the turn is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(read(sseEvents(body('data: {"a":1}\n\n'), controller.signal))).rejects.toThrow();
  });
});
