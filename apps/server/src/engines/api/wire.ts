/**
 * The seam between the engine and one provider's HTTP.
 *
 * `ApiEngine` knows nothing about JSON bodies, SSE frames or error envelopes —
 * it asks a `Wire` to check a key, list models, run one streaming turn or
 * answer one short prompt. Two adapters implement it: `openrouter.ts` and
 * `anthropic.ts`.
 *
 * Everything below the interface is the small amount of HTTP both adapters
 * share: sending a request without ever putting the key anywhere but a header,
 * validating the reply with Zod before anyone reads it, and turning a failure
 * into one plain sentence with no key in it.
 */
import type { EffortChoice } from '@conch/protocol';
import type { z } from 'zod';

import { isLoopbackUrl, isPrivateUrl } from '../../local/host';
import type { Completion, EngineUsage, TurnImage } from '../types';
import {
  ApiError,
  type FetchLike,
  type WireAccount,
  type WireCompletion,
  type WireEvent,
  type WireMessage,
  type WireModel,
  type WireRequest,
} from './types';

/** One tool's answer, on its way back to the model. */
export interface ToolResult {
  id: string;
  name: string;
  text: string;
  isError: boolean;
}

export interface Wire {
  /** Who meters you, for the usage card: "OpenRouter", "Anthropic API". */
  readonly source: string;
  /** Validate a key and describe what it belongs to. Throws `ApiError`. */
  check(input: { key: string; signal?: AbortSignal }): Promise<WireAccount>;
  /** The models this key may use. Without a key, whatever the provider shows publicly. */
  models(input: { key?: string; signal?: AbortSignal }): Promise<WireModel[]>;
  /** One streamed turn. Ends with exactly one `end` event, or throws `ApiError`. */
  stream(request: WireRequest): AsyncIterable<WireEvent>;
  /** One short answer, no tools, no streaming. */
  complete(request: WireCompletion): Promise<Completion>;
  /** Limits the provider publishes. Omitted where it publishes none. */
  usage?(input: { key: string; signal?: AbortSignal }): Promise<EngineUsage>;
  /** The user's prompt (and any images sent with it), in this provider's message shape. */
  userMessage(text: string, images?: readonly TurnImage[]): WireMessage;
  /** Tool answers, in this provider's message shape. */
  toolResults(results: ToolResult[]): WireMessage[];
  /** A small, cheap model from the last list the provider gave us, if it has one. */
  smallModel(): string | undefined;
  /**
   * Whether this model can call tools, from the last list. `false` means the
   * turn goes without them (and the model is told so); unset means yes.
   */
  toolsFor?(model: string): boolean | undefined;
}

/** Effort levels Conch's protocol knows about (everything but `auto`). */
export type Effort = Exclude<EffortChoice, 'auto'>;
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Only the effort levels both the provider and Conch understand. */
export function knownEfforts(offered: readonly string[] | undefined): Effort[] {
  if (!offered) return [];
  return EFFORTS.filter((effort) => offered.includes(effort));
}

/**
 * A response body big enough to be a problem. The OpenRouter model list is
 * megabytes on its own, so the ceiling is generous — it's here to stop a
 * runaway stream, not to second-guess the provider.
 */
const MAX_BODY_BYTES = 24 * 1024 * 1024;

/**
 * Error text with anything key-shaped taken out. Same idea as
 * `integrations/probe.ts`: the exact value first (we know it), then the shapes
 * every provider's keys have, then a length cap so a giant HTML error page
 * can't become the user's error message.
 */
export function scrub(text: string, key?: string): string {
  let out = text;
  if (key && key.length >= 6) out = out.replaceAll(key, '••••');
  return out
    .replace(/(bearer\s+)[\w.~+/-]+=*/gi, '$1••••')
    .replace(/\b(sk-or-v1-|sk-ant-|sk-)[\w-]+/gi, '$1••••')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** `Retry-After`, in milliseconds, whether the provider sent seconds or a date. */
export function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 120) * 1000;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.min(at - Date.now(), 120_000));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError('other', 'Stopped.'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new ApiError('other', 'Stopped.'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Send one request. The key only ever travels in `headers` — never a query
 * string, never a log line.
 *
 * `redirect: 'error'` is deliberate: no provider redirects, and following one
 * would mean deciding at runtime whether the new address is still https and
 * still theirs (or, for Ollama, still this computer). Refusing is the safe
 * answer, and it says so in plain words.
 */
export async function send(options: {
  fetchImpl: FetchLike;
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  /** The provider's name, for the sentence a person reads. */
  label: string;
  /** The key, so it can be scrubbed out of anything we surface. */
  key?: string;
  /**
   * A server on this computer (Ollama): plain http, but only ever to a
   * loopback address. Everything else must be https.
   */
  local?: boolean;
  /**
   * A server you run yourself: https anywhere, and plain http too when it's on
   * this computer or your own network — never across the internet, where the
   * key and the conversation would travel in the clear.
   */
  plain?: boolean;
}): Promise<Response> {
  const { fetchImpl, url, method, headers, body, signal, label, key, local, plain } = options;
  const allowed = local
    ? isLoopbackUrl(url)
    : url.startsWith('https://') || (plain === true && isPrivateUrl(url));
  if (!allowed) {
    throw new ApiError(
      'other',
      local
        ? `Conch only talks to ${label} on this computer.`
        : plain
          ? `Conch only talks to ${label} over https, or plain http on this computer or your own network.`
          : `Conch only talks to ${label} over https.`,
    );
  }
  try {
    return await fetchImpl(url, {
      method,
      headers,
      redirect: 'error',
      ...(body !== undefined && { body: JSON.stringify(body) }),
      ...(signal && { signal }),
    });
  } catch (error) {
    if (signal?.aborted) {
      const reason: unknown = signal.reason;
      if (reason instanceof Error && reason.name === 'TimeoutError') {
        throw new ApiError('timeout', `${label} took too long to answer.`, { retryable: true });
      }
      throw new ApiError('other', 'Stopped.');
    }
    const detail = scrub(error instanceof Error ? error.message : String(error), key);
    if (/timeout|timed out|ETIMEDOUT/i.test(detail)) {
      throw new ApiError('timeout', `${label} took too long to answer.`, { retryable: true });
    }
    if (/redirect/i.test(detail)) {
      throw new ApiError('other', `${label} redirected the request, so Conch stopped.`);
    }
    throw new ApiError(
      'network',
      // A server on this computer that's down isn't your connection's fault.
      local || isLoopbackUrl(url)
        ? `${label} isn’t answering on this computer.`
        : `Conch couldn’t reach ${label}. Check your connection.`,
      { retryable: true },
    );
  }
}

/** The body as text, with a ceiling. Used for both success and error bodies. */
export async function text(response: Response, label: string): Promise<string> {
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) {
    throw new ApiError('other', `${label} sent a reply too large for Conch to read.`);
  }
  try {
    const body = await response.text();
    if (body.length > MAX_BODY_BYTES) {
      throw new ApiError('other', `${label} sent a reply too large for Conch to read.`);
    }
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('network', `The reply from ${label} was cut off.`, { retryable: true });
  }
}

/**
 * Parse and validate a body. The wire is untrusted: nothing is read out of a
 * provider's JSON before Zod has agreed it's the shape we expected.
 */
export function validate<T>(schema: z.ZodType<T>, body: string, label: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new ApiError('other', `${label} didn’t send valid JSON.`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('other', `${label} sent an answer Conch didn’t understand.`);
  }
  return parsed.data;
}

/** Same, for one SSE frame: a frame Conch can't read is skipped, not fatal. */
export function frame<T>(schema: z.ZodType<T>, data: string): T | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return undefined;
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The cheapest capable model in a list, by id. Conch never invents a slug: if
 * nothing in the provider's own list looks Haiku-class, there is no small model
 * and the caller uses the default instead.
 */
export function pickSmallModel(ids: readonly string[]): string | undefined {
  const haiku = ids.filter((id) => /haiku/i.test(id) && !/[:@]/.test(id));
  if (!haiku.length) return undefined;
  const version = (id: string) =>
    Number(/(\d+(?:[.-]\d+)?)/.exec(id.replace(/haiku/i, ''))?.[1]?.replace('-', '.') ?? 0);
  return [...haiku].sort((a, b) => version(b) - version(a) || a.length - b.length)[0];
}

/** A short, plain sentence for a context size, e.g. "200k context". */
export function contextLabel(tokens: number | undefined | null): string | undefined {
  if (!tokens || tokens <= 0) return undefined;
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k context` : `${tokens} token context`;
}
