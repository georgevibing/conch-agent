import { describe, expect, it, vi } from 'vitest';

import type { CompletionInput, Engine } from '../engines/types';
import type { LookModel } from '../memory/guard';
import {
  completeReview,
  fastReviewer,
  FastRefusals,
  type ReviewOutcome,
} from './review-completion';

const ask = { system: 'Judge', prompt: 'Is this fine?' };

function settled() {
  const seen: { ms: number; outcome: ReviewOutcome }[] = [];
  return { seen, onSettled: (o: { ms: number; outcome: ReviewOutcome }) => void seen.push(o) };
}

describe('how a review ended (ADR 0147)', () => {
  it('says answered once, and asks the engine to keep a process ready', async () => {
    const complete = vi.fn(async (_: CompletionInput) => ({ text: '{"ok":true}' }));
    const { seen, onSettled } = settled();
    const answer = await completeReview(async () => ({ complete, model: 'fast' }), ask, {
      onSettled,
    });
    expect(answer?.text).toBe('{"ok":true}');
    expect(seen).toEqual([{ ms: expect.any(Number), outcome: 'answered' }]);
    expect(complete.mock.calls[0]?.[0]).toMatchObject({ model: 'fast', warm: true });
  });

  it('says timeout when the deadline passes first, even for a provider that ignores Stop', async () => {
    const { seen, onSettled } = settled();
    const answer = await completeReview(
      async () => ({ complete: () => new Promise<never>(() => {}) }),
      ask,
      { timeoutMs: 20, onSettled },
    );
    expect(answer).toBeUndefined();
    expect(seen.map((s) => s.outcome)).toEqual(['timeout']);
    expect(seen[0]?.ms).toBeGreaterThanOrEqual(15);
  });

  it('says timeout when getting the model takes all the time', async () => {
    const { seen, onSettled } = settled();
    await completeReview(() => new Promise<LookModel>(() => {}), ask, {
      timeoutMs: 20,
      onSettled,
    });
    expect(seen.map((s) => s.outcome)).toEqual(['timeout']);
  });

  it('says error when the model call fails, and unavailable when there is nobody to ask', async () => {
    const failing = settled();
    await completeReview(
      async () => ({
        complete: async () => {
          throw new Error('refused');
        },
      }),
      ask,
      { onSettled: failing.onSettled },
    );
    expect(failing.seen.map((s) => s.outcome)).toEqual(['error']);

    const nobody = settled();
    await completeReview(async () => undefined, ask, { onSettled: nobody.onSettled });
    expect(nobody.seen.map((s) => s.outcome)).toEqual(['unavailable']);

    const broken = settled();
    await completeReview(
      async () => {
        throw new Error('no provider');
      },
      ask,
      { onSettled: broken.onSettled },
    );
    expect(broken.seen.map((s) => s.outcome)).toEqual(['unavailable']);
  });

  it('tells Stop before asking from Stop while asking, and never counts twice', async () => {
    const before = settled();
    const stopped = new AbortController();
    stopped.abort();
    const complete = vi.fn();
    await completeReview(async () => ({ complete }), ask, {
      signal: stopped.signal,
      onSettled: before.onSettled,
    });
    expect(complete).not.toHaveBeenCalled();
    expect(before.seen.map((s) => s.outcome)).toEqual(['unavailable']);

    const during = settled();
    const stop = new AbortController();
    let late!: (value: { text: string }) => void;
    const pending = completeReview(
      async () => ({
        complete: () =>
          new Promise<{ text: string }>((resolve) => {
            late = resolve;
            queueMicrotask(() => stop.abort());
          }),
      }),
      ask,
      { signal: stop.signal, onSettled: during.onSettled },
    );
    expect(await pending).toBeUndefined();
    // The provider answers after Stop: no second count, no answer.
    late({ text: 'too late' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(during.seen.map((s) => s.outcome)).toEqual(['error']);
  });

  it('never lets a broken counter break the review', async () => {
    const answer = await completeReview(
      async () => ({ complete: async () => ({ text: 'x' }) }),
      ask,
      {
        onSettled: () => {
          throw new Error('meter broke');
        },
      },
    );
    expect(answer?.text).toBe('x');
  });
});

function engineOf(over: Partial<Engine> & Pick<Engine, 'id'>): Engine {
  return {
    label: over.id,
    integrations: { mode: 'native' },
    detect: vi.fn(),
    capabilities: vi.fn(),
    runTurn: vi.fn(),
    ...over,
  } as unknown as Engine;
}

describe('the declared fast reviewer (ADR 0147)', () => {
  it('uses the engine’s own declared model on the same engine, never another provider', async () => {
    const own = vi.fn(async (_: CompletionInput) => ({ text: 'own' }));
    const other = vi.fn(async (_: CompletionInput) => ({ text: 'other' }));
    const engine = engineOf({ id: 'claude-code', complete: own, reviewModel: async () => 'haiku' });
    // Another connected provider is never consulted, whatever it offers.
    void engineOf({ id: 'openai', complete: other, reviewModel: async () => 'gpt-6-luna' });
    const found = await fastReviewer(engine, new FastRefusals());
    expect(found?.model).toBe('haiku');
    await found?.complete({ ...ask, model: 'haiku', signal: new AbortController().signal });
    expect(own).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
  });

  it('declares nothing for an engine without a fast model, or without answers', async () => {
    const refusals = new FastRefusals();
    expect(
      await fastReviewer(engineOf({ id: 'ollama', complete: vi.fn() }), refusals),
    ).toBeUndefined();
    expect(
      await fastReviewer(engineOf({ id: 'codex-cli', reviewModel: async () => 'fast' }), refusals),
    ).toBeUndefined();
    expect(
      await fastReviewer(
        engineOf({ id: 'groq', complete: vi.fn(), reviewModel: async () => undefined }),
        refusals,
      ),
    ).toBeUndefined();
    expect(
      await fastReviewer(
        engineOf({
          id: 'gemini',
          complete: vi.fn(),
          reviewModel: async () => {
            throw new Error('list failed');
          },
        }),
        refusals,
      ),
    ).toBeUndefined();
  });

  it('leaves a fast model that failed alone for a while, but not one that was only stopped', async () => {
    let now = 0;
    const refusals = new FastRefusals(() => now);
    const complete = vi.fn(async (input: CompletionInput) => {
      if (input.signal.aborted) throw new Error('Stopped.');
      throw new Error('This plan has no Haiku.');
    });
    const engine = engineOf({ id: 'claude-code', complete, reviewModel: async () => 'haiku' });

    const stopped = new AbortController();
    stopped.abort();
    const first = await fastReviewer(engine, refusals);
    await expect(first?.complete({ ...ask, signal: stopped.signal })).rejects.toThrow();
    expect(await fastReviewer(engine, refusals)).toBeDefined();

    const found = await fastReviewer(engine, refusals);
    await expect(
      found?.complete({ ...ask, signal: new AbortController().signal }),
    ).rejects.toThrow();
    expect(await fastReviewer(engine, refusals)).toBeUndefined();
    now += 11 * 60_000;
    expect(await fastReviewer(engine, refusals)).toBeDefined();
  });
});
