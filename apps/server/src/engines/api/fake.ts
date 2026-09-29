/**
 * Test doubles for the API engines.
 *
 * `fetch` is injected, never monkey-patched: a test's stub can't leak into the
 * next one, and a test that forgets to script a route fails loudly instead of
 * reaching the real internet.
 */
import { ProviderKeys } from '../../providers/keys';
import { SettingsStore } from '../../settings/store';
import type { EngineEvent } from '../types';
import { ApiError, type FetchLike } from './types';

export interface FakeCall {
  url: string;
  method: string;
  /** Lower-cased, so a test never depends on header casing. */
  headers: Record<string, string>;
  body?: unknown;
}

export interface FakeFetch {
  fetch: FetchLike;
  calls: FakeCall[];
}

/** A `fetch` that answers from a handler and records every call. */
export function fakeFetch(handler: (call: FakeCall) => Response | Promise<Response>): FakeFetch {
  const calls: FakeCall[] = [];
  const fetch: FetchLike = async (input, init) => {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[name.toLowerCase()] = value;
    }
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: FakeCall = { url: String(input), method: init?.method ?? 'GET', headers, body };
    calls.push(call);
    return handler(call);
  };
  return { fetch, calls };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * An SSE body delivered in small byte slices, so line and frame boundaries land
 * in awkward places — which is exactly where a hand-written reader breaks.
 */
export function sseResponse(text: string, { chunk = 7, status = 200 } = {}): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset += chunk;
    },
  });
  return new Response(stream, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** `data:`-only frames, the way OpenRouter streams. */
export function dataFrames(...frames: string[]): string {
  return frames.map((frame) => `data: ${frame}\n\n`).join('');
}

/** `event:` + `data:` frames, the way Anthropic streams. */
export function namedFrames(...frames: [string, unknown][]): string {
  return frames.map(([name, body]) => `event: ${name}\ndata: ${JSON.stringify(body)}\n\n`).join('');
}

/** A settings store and key vault in a throwaway home. */
export async function fakeHome(): Promise<{
  home: string;
  settings: SettingsStore;
  keys: ProviderKeys;
}> {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = await mkdtemp(join(tmpdir(), 'conch-api-'));
  const settings = new SettingsStore(home);
  return { home, settings, keys: new ProviderKeys(settings) };
}

export async function collect(events: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

/** The failure a call rejected with. Fails the test if it somehow succeeded. */
export async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('Expected that call to fail.');
}
