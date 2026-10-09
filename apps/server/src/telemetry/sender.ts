/**
 * Sending to a dashboard without ever slowing Conch down (ADR 0121).
 *
 * - **Nothing waits for it.** A span or an event is pushed onto a bounded
 *   queue and the turn carries on; sending happens later, one request at a
 *   time per signal, off the turn's path.
 * - **Bounded.** A queue that's full drops what's new and counts it
 *   (`conch.telemetry.dropped{reason="queue_full"}`), as OpenTelemetry's batch
 *   processor does. Memory never grows with an endpoint that's down.
 * - **Retries what passes by itself** (working agreement 11): 429, 502, 503,
 *   504, a timeout or a dropped connection are tried again with exponential
 *   backoff and jitter, honouring `Retry-After` (seconds or a date), as the
 *   OTLP specification says. Anything else is the person's to fix (a 401 is a
 *   key) and is said in a sentence, not retried.
 * - **Small on the wire.** Gzip, which every OTLP receiver takes.
 */
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

import type { TelemetryProblem, TelemetrySignal } from '@conch/protocol';

import { rejectedOf } from './otlp';

const zip = promisify(gzip);

export interface SendDeps {
  fetch?: typeof fetch;
  now?: () => number;
  /** Waits, unless stopped first. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  /** One request's limit. */
  timeoutMs?: number;
  /** How many times one batch is tried before it's dropped. */
  attempts?: number;
}

export interface SendResult {
  ok: boolean;
  status?: number;
  /** Worth trying again later. */
  retryable: boolean;
  /** How long the service asked to wait, in ms. */
  retryAfterMs?: number;
  /** Items the service took the request but turned away (`partialSuccess`). */
  rejected?: number;
  message?: string;
  ms: number;
}

const RETRYABLE = new Set([429, 502, 503, 504]);
const MAX_ANSWER = 64 * 1024;

/** `Retry-After`: seconds, or an HTTP date. */
export function retryAfterMs(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

/** What a status means, in the person's words. */
export function statusWords(status: number, destination: string, retrying = true): string {
  const later = retrying ? 'Conch will try again.' : 'Try again in a minute.';
  if (status === 401 || status === 403)
    return `${destination} didn’t take the key. Paste it again, or make a new one.`;
  if (status === 404) return `${destination} has nothing at that address. Check the endpoint.`;
  if (status === 413) return `${destination} said the batch was too large.`;
  if (status === 415) return `${destination} wants another format. Choose protobuf under Advanced.`;
  if (status === 429) return `${destination} asked Conch to slow down. ${later}`;
  if (status >= 500) return `${destination} had a problem of its own (${status}). ${later}`;
  return `${destination} answered ${status}.`;
}

/** One OTLP request: gzipped, timed, and read into whether it arrived. */
export async function postOtlp(
  url: string,
  headers: Record<string, string>,
  body: Uint8Array | string,
  contentType: string,
  deps: SendDeps = {},
): Promise<SendResult> {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const started = now();
  const raw = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  try {
    const zipped = await zip(raw);
    const response = await doFetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': contentType,
        'content-encoding': 'gzip',
        'user-agent': 'Conch',
      },
      body: zipped,
      redirect: 'error',
      signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    });
    const answer = new Uint8Array(await response.arrayBuffer()).subarray(0, MAX_ANSWER);
    const ms = now() - started;
    if (response.ok) {
      const { rejected, message } = rejectedOf(answer, response.headers.get('content-type'));
      return {
        ok: true,
        retryable: false,
        ms,
        status: response.status,
        ...(rejected > 0 && { rejected }),
        ...(message && { message }),
      };
    }
    const wait = retryAfterMs(response.headers.get('retry-after'), now());
    return {
      ok: false,
      status: response.status,
      retryable: RETRYABLE.has(response.status),
      ms,
      ...(wait !== undefined && { retryAfterMs: wait }),
    };
  } catch (error) {
    const timeout = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      retryable: true,
      ms: now() - started,
      message: timeout ? 'didn’t answer in time' : 'couldn’t be reached',
    };
  }
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    timer.unref();
    function done() {
      signal.removeEventListener('abort', done);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

/** Backoff for the n-th retry: 1 s, 2 s, 4 s… with ±50 % jitter, at most 30 s; or what the service asked, at most 60 s. */
export function backoffMs(attempt: number, random: () => number, asked?: number): number {
  if (asked !== undefined) return Math.min(asked, 60_000);
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  return Math.round(base * (0.5 + random()));
}

export interface Outcome {
  signal: TelemetrySignal;
  ok: boolean;
  items: number;
  /** Dropped for good, and why. */
  dropped?: { count: number; reason: 'rejected' | 'failed' };
  problem?: TelemetryProblem;
  ms: number;
}

/**
 * Send one batch until it arrives, the service says no, or the attempts run
 * out. Stopping (`signal`) ends the waiting at once.
 */
export async function sendWithRetry(
  send: () => Promise<SendResult>,
  options: {
    signal: TelemetrySignal;
    items: number;
    destination: string;
    stop: AbortSignal;
    deps?: SendDeps;
  },
): Promise<Outcome> {
  const deps = options.deps ?? {};
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const attempts = deps.attempts ?? 5;
  const now = deps.now ?? Date.now;
  let last: SendResult | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (options.stop.aborted) break;
    last = await send();
    if (last.ok) {
      const rejected = last.rejected ?? 0;
      return {
        signal: options.signal,
        ok: true,
        items: options.items,
        ms: last.ms,
        ...(rejected > 0 && { dropped: { count: rejected, reason: 'rejected' as const } }),
      };
    }
    if (!last.retryable) break;
    if (attempt + 1 < attempts)
      await sleep(backoffMs(attempt, random, last.retryAfterMs), options.stop);
  }
  const status = last?.status;
  const message =
    status !== undefined
      ? statusWords(status, options.destination)
      : `${options.destination} ${last?.message ?? 'couldn’t be reached'}. Conch will keep trying.`;
  return {
    signal: options.signal,
    ok: false,
    items: options.items,
    ms: last?.ms ?? 0,
    dropped: {
      count: options.items,
      reason: status !== undefined && !last?.retryable ? 'rejected' : 'failed',
    },
    problem: {
      at: now(),
      signal: options.signal,
      message: message.slice(0, 300),
      ...(status !== undefined && { status }),
      ...(status !== undefined &&
        status >= 400 &&
        status < 500 &&
        status !== 429 && { yours: true }),
    },
  };
}

/**
 * Spans or events waiting to be sent: a bounded queue, taken in batches,
 * one request at a time. `push` never waits and never throws.
 */
export class BatchQueue<T> {
  #items: T[] = [];
  #sending?: Promise<void>;

  constructor(
    private readonly options: {
      max: number;
      batch: number;
      /** Send one batch; resolves when it's done with it (arrived or dropped). */
      send: (items: T[]) => Promise<void>;
      onFull: (count: number) => void;
    },
  ) {}

  get size(): number {
    return this.#items.length;
  }

  push(item: T): void {
    if (this.#items.length >= this.options.max) {
      this.options.onFull(1);
      return;
    }
    this.#items.push(item);
    if (this.#items.length >= this.options.batch) void this.flush();
  }

  /** Send everything waiting, a batch at a time. Calls while one is running wait for it. */
  flush(): Promise<void> {
    this.#sending ??= (async () => {
      try {
        while (this.#items.length) {
          const batch = this.#items.splice(0, this.options.batch);
          await this.options.send(batch).catch(() => undefined);
        }
      } finally {
        this.#sending = undefined;
      }
    })();
    return this.#sending;
  }

  /** Forget what's waiting (sending was turned off): how many there were. */
  clear(): number {
    const n = this.#items.length;
    this.#items = [];
    return n;
  }
}
