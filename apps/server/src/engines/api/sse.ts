/**
 * A server-sent events reader, in about fifty lines instead of a dependency.
 *
 * It exists because both providers stream text/event-stream and both have a
 * frame that crashes a naive `JSON.parse`: OpenRouter sends keep-alive comment
 * lines (`: OPENROUTER PROCESSING`) and a terminal `data: [DONE]`, Anthropic
 * sends `event:` and `data:` on separate lines with no sentinel at all. Chunk
 * boundaries land anywhere, including inside a line, so lines are buffered
 * across reads.
 */
import { ApiError } from './types';

/** A frame bigger than this is not a frame we want to hold in memory. */
const MAX_FIELD_BYTES = 8 * 1024 * 1024;

/** One dispatched event: SSE's `event:` name (when sent) and the joined `data:` lines. */
export interface SseEvent {
  event?: string;
  data: string;
}

/**
 * Complete lines from a byte stream, as they arrive. Comment lines and blank
 * lines are kept — the caller needs blanks to know a frame ended.
 */
export async function* sseLines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      if (signal?.aborted)
        throw signal.reason instanceof Error ? signal.reason : new Error('Stopped.');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_FIELD_BYTES) {
        throw new ApiError('other', 'The provider sent a response Conch couldn’t read.');
      }
      // A lone \r at the end of a chunk may be the first half of \r\n: leave it.
      let newline = buffer.search(/\r\n|\n|\r(?!$)/);
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + (buffer.startsWith('\r\n', newline) ? 2 : 1));
        yield line;
        newline = buffer.search(/\r\n|\n|\r(?!$)/);
      }
    }
    buffer += decoder.decode();
    if (buffer) yield buffer;
  } finally {
    // Releasing the lock lets the body be cancelled by whoever owns the request.
    reader.releaseLock();
  }
}

/**
 * SSE frames, dispatched on blank lines as the spec says. Comments (`:`) are
 * dropped, `data:` lines are joined with newlines, and a frame left unflushed
 * at the end of the stream is still delivered — not every server sends the
 * final blank line.
 */
export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  let name: string | undefined;
  let data: string[] = [];
  const flush = (): SseEvent | undefined => {
    if (!data.length) {
      name = undefined;
      return undefined;
    }
    const event: SseEvent = { data: data.join('\n'), ...(name && { event: name }) };
    name = undefined;
    data = [];
    return event;
  };
  for await (const line of sseLines(body, signal)) {
    if (line === '') {
      const event = flush();
      if (event) yield event;
      continue;
    }
    // ": OPENROUTER PROCESSING" is a keep-alive comment. Parsing one is a crash.
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const rest = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') name = rest;
    else if (field === 'data') data.push(rest);
    // `id` and `retry` mean nothing to either provider; anything else is unknown.
  }
  const last = flush();
  if (last) yield last;
}
