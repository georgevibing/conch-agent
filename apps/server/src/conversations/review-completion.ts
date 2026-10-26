/** Bounded tool-less review, including model acquisition and providers ignoring cancellation. */
import type { Completion, CompletionInput, Engine } from '../engines/types';
import type { LookModel } from '../memory/guard';

/**
 * How one review ended, for the dashboards (ADR 0147). `answered`: the model
 * replied, whatever it said. `timeout`: the deadline passed first. `error`:
 * the model call failed, or Stop came while it ran. `unavailable`: there was
 * nobody to ask (no model, or Stop came before asking).
 */
export type ReviewOutcome = 'answered' | 'timeout' | 'error' | 'unavailable';

export async function completeReview(
  model: () => Promise<LookModel | undefined>,
  input: Omit<CompletionInput, 'signal' | 'model'>,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    /** Called exactly once, when the review's answer is known (or known not to come). */
    onSettled?: (o: { ms: number; outcome: ReviewOutcome }) => void;
  },
): Promise<Completion | undefined> {
  const startedAt = performance.now();
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 8_000);
  const signal = AbortSignal.any([deadline, ...(options.signal ? [options.signal] : [])]);
  let settled = false;
  let asked = false;
  const settle = (outcome: ReviewOutcome) => {
    if (settled) return;
    settled = true;
    try {
      options.onSettled?.({ ms: Math.round(performance.now() - startedAt), outcome });
    } catch {
      /* Counting is never the review's problem. */
    }
  };
  const stopped = (): ReviewOutcome =>
    deadline.aborted ? 'timeout' : asked ? 'error' : 'unavailable';
  if (signal.aborted) {
    settle(stopped());
    return undefined;
  }
  let onAbort: (() => void) | undefined;
  try {
    const work = async () => {
      const found = await model();
      if (!found) {
        settle('unavailable');
        return undefined;
      }
      if (signal.aborted) return undefined;
      asked = true;
      const answer = await found.complete({
        ...input,
        ...(found.model && { model: found.model }),
        // More reviews like this one are likely soon: an engine may keep a process ready.
        warm: true,
        signal,
      });
      if (signal.aborted) return undefined;
      settle('answered');
      return answer;
    };
    const answer = await Promise.race([
      work(),
      new Promise<undefined>((resolve) => {
        onAbort = () => resolve(undefined);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
    if (!answer) settle(signal.aborted ? stopped() : 'unavailable');
    return answer;
  } catch {
    settle(signal.aborted ? stopped() : asked ? 'error' : 'unavailable');
    return undefined;
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** Flat reviewer contracts must not accept keys JSON.parse would silently overwrite. */
export function reviewJson(text: string): unknown {
  if (text.length > 4_096) return undefined;
  try {
    const keys = [...text.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map(
      (m) => JSON.parse(m[1] ?? '""') as string,
    );
    if (new Set(keys).size !== keys.length) return undefined;
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** How long a fast model that failed is left alone before it's tried again. */
const REFUSED_MS = 10 * 60_000;

/**
 * Fast models that just failed, by provider (ADR 0147): one the account can't
 * use (a plan without it, a cloud region without it, a managed setting that
 * denies it) is left alone for a while, so the turn's own model reviews
 * instead of every review failing the same way.
 */
export class FastRefusals {
  readonly #until = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  refused(engine: string, model: string): boolean {
    const key = `${engine}\u0000${model}`;
    const until = this.#until.get(key);
    if (until === undefined) return false;
    if (until > this.now()) return true;
    this.#until.delete(key);
    return false;
  }

  refuse(engine: string, model: string): void {
    this.#until.set(`${engine}\u0000${model}`, this.now() + REFUSED_MS);
  }
}

/**
 * The provider's own declared fast model for Auto's reviews (ADR 0147), on the
 * same engine, or undefined (none declared, or it failed lately): then the
 * caller uses the turn's own model. It never crosses to another provider (ADR
 * 0144): the answer comes from `engine.complete` and nothing else.
 */
export async function fastReviewer(
  engine: Engine,
  refusals: FastRefusals,
): Promise<LookModel | undefined> {
  const complete = engine.complete?.bind(engine);
  if (!complete || !engine.reviewModel) return undefined;
  const model = await engine.reviewModel().catch(() => undefined);
  if (!model || refusals.refused(engine.id, model)) return undefined;
  return {
    model,
    complete: async (input) => {
      try {
        return await complete(input);
      } catch (error) {
        // Stopped or out of time says nothing about the model.
        if (!input.signal.aborted) refusals.refuse(engine.id, model);
        throw error;
      }
    },
  };
}
