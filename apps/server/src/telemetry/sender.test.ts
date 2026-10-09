import { gunzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import {
  backoffMs,
  BatchQueue,
  postOtlp,
  retryAfterMs,
  sendWithRetry,
  type SendDeps,
} from './sender';

/** A pretend OTLP endpoint: answers in turn, and keeps what it was sent. */
function endpoint(
  answers: (number | 'down' | { status: number; headers?: Record<string, string> })[],
) {
  const seen: { url: string; headers: Record<string, string>; body: Buffer }[] = [];
  let i = 0;
  const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    seen.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: gunzipSync(Buffer.from(init?.body as Uint8Array)),
    });
    const next = answers[Math.min(i++, answers.length - 1)] ?? 200;
    if (next === 'down') throw new TypeError('fetch failed');
    const { status, headers } = typeof next === 'number' ? { status: next, headers: {} } : next;
    return new Response(status === 200 ? new Uint8Array() : 'no', { status, headers });
  }) as unknown as typeof globalThis.fetch;
  return { fetch: fake, seen };
}

const quick = (fetch: typeof globalThis.fetch, sleeps: number[] = []): SendDeps => ({
  fetch,
  random: () => 0.5,
  sleep: async (ms) => {
    sleeps.push(ms);
  },
});

describe('one OTLP request', () => {
  it('is gzipped protobuf with the destination’s headers', async () => {
    const { fetch, seen } = endpoint([200]);
    const r = await postOtlp(
      'https://otlp.example/v1/traces',
      { 'x-honeycomb-team': 'k' },
      new Uint8Array([1, 2, 3]),
      'application/x-protobuf',
      { fetch },
    );
    expect(r.ok).toBe(true);
    expect(seen[0]?.headers).toMatchObject({
      'x-honeycomb-team': 'k',
      'content-type': 'application/x-protobuf',
      'content-encoding': 'gzip',
    });
    expect([...(seen[0]?.body ?? [])]).toEqual([1, 2, 3]);
  });

  it('says which failures pass by themselves', async () => {
    for (const [status, retryable] of [
      [429, true],
      [502, true],
      [503, true],
      [504, true],
      [400, false],
      [401, false],
      [404, false],
      [500, false],
    ] as const) {
      const { fetch } = endpoint([status]);
      expect(
        (await postOtlp('https://x/v1/metrics', {}, '{}', 'application/json', { fetch })).retryable,
        String(status),
      ).toBe(retryable);
    }
    const { fetch } = endpoint(['down']);
    expect(
      await postOtlp('https://x/v1/metrics', {}, '{}', 'application/json', { fetch }),
    ).toMatchObject({ ok: false, retryable: true });
  });

  it('reads Retry-After as seconds or a date', () => {
    expect(retryAfterMs('7', 0)).toBe(7000);
    expect(retryAfterMs(new Date(60_000).toUTCString(), 0)).toBe(60_000);
    expect(retryAfterMs(null, 0)).toBeUndefined();
    expect(retryAfterMs('soon', 0)).toBeUndefined();
  });
});

describe('retrying', () => {
  const stop = new AbortController().signal;

  it('tries again after 503, with backoff, until it arrives', async () => {
    const sleeps: number[] = [];
    const { fetch, seen } = endpoint([503, 503, 200]);
    const outcome = await sendWithRetry(
      () => postOtlp('https://x/v1/traces', {}, 'b', 'application/json', { fetch }),
      {
        signal: 'traces',
        items: 4,
        destination: 'Honeycomb',
        stop,
        deps: quick(fetch, sleeps),
      },
    );
    expect(outcome).toMatchObject({ ok: true, items: 4 });
    expect(seen).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('waits as long as Retry-After asks', async () => {
    const sleeps: number[] = [];
    const { fetch } = endpoint([{ status: 429, headers: { 'retry-after': '12' } }, 200]);
    await sendWithRetry(
      () => postOtlp('https://x/v1/traces', {}, 'b', 'application/json', { fetch }),
      {
        signal: 'traces',
        items: 1,
        destination: 'Datadog',
        stop,
        deps: quick(fetch, sleeps),
      },
    );
    expect(sleeps).toEqual([12_000]);
  });

  it('never retries what only the person can fix, and says it in a sentence', async () => {
    const { fetch, seen } = endpoint([401]);
    const outcome = await sendWithRetry(
      () => postOtlp('https://x/v1/traces', {}, 'b', 'application/json', { fetch }),
      {
        signal: 'traces',
        items: 9,
        destination: 'Grafana Cloud',
        stop,
        deps: quick(fetch),
      },
    );
    expect(seen).toHaveLength(1);
    expect(outcome).toMatchObject({
      ok: false,
      dropped: { count: 9, reason: 'rejected' },
      problem: {
        status: 401,
        yours: true,
        message: 'Grafana Cloud didn’t take the key. Paste it again, or make a new one.',
      },
    });
  });

  it('gives up after its attempts, keeping memory bounded, and counts what it dropped', async () => {
    const { fetch, seen } = endpoint(['down']);
    const outcome = await sendWithRetry(
      () => postOtlp('https://x/v1/logs', {}, 'b', 'application/json', { fetch }),
      {
        signal: 'logs',
        items: 3,
        destination: 'New Relic',
        stop,
        deps: { ...quick(fetch), attempts: 4 },
      },
    );
    expect(seen).toHaveLength(4);
    expect(outcome).toMatchObject({ ok: false, dropped: { count: 3, reason: 'failed' } });
    expect(outcome.problem?.message).toBe('New Relic couldn’t be reached. Conch will keep trying.');
  });

  it('stops waiting the moment Conch stops', async () => {
    const stopping = new AbortController();
    const { fetch, seen } = endpoint([503]);
    const done = sendWithRetry(
      () => postOtlp('https://x/v1/logs', {}, 'b', 'application/json', { fetch }),
      {
        signal: 'logs',
        items: 1,
        destination: 'Honeycomb',
        stop: stopping.signal,
        deps: { fetch, random: () => 0.5 },
      },
    );
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    stopping.abort();
    await expect(done).resolves.toMatchObject({ ok: false });
    expect(seen).toHaveLength(1);
  });

  it('backs off exponentially with jitter, and never too long', () => {
    expect(backoffMs(0, () => 0)).toBe(500);
    expect(backoffMs(3, () => 0.5)).toBe(8000);
    expect(backoffMs(20, () => 1)).toBe(45_000);
    expect(backoffMs(0, () => 0.5, 600_000)).toBe(60_000);
  });
});

describe('the queue', () => {
  it('never holds more than its limit, and counts what it turned away', async () => {
    const full = vi.fn();
    const sent: number[][] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const queue = new BatchQueue<number>({
      max: 10,
      batch: 4,
      onFull: full,
      send: async (items) => {
        sent.push(items);
        await gate;
      },
    });
    for (let i = 0; i < 30; i++) queue.push(i);
    // The first batch went as soon as there were four; ten more wait; the rest were turned away.
    expect(queue.size).toBeLessThanOrEqual(10);
    expect(full).toHaveBeenCalledTimes(30 - 4 - 10);
    release();
    await queue.flush();
    expect(sent.flat()).toHaveLength(14);
    expect(queue.size).toBe(0);
  });

  it('pushes without waiting, even while a send hangs', () => {
    const queue = new BatchQueue<number>({
      max: 100,
      batch: 1,
      onFull: () => undefined,
      send: () => new Promise(() => undefined),
    });
    const started = performance.now();
    for (let i = 0; i < 50; i++) queue.push(i);
    expect(performance.now() - started).toBeLessThan(20);
  });
});
