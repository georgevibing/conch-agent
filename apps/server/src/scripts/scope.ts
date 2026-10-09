/**
 * Which script step is running, wherever a question gets asked (ADR 0119).
 * A tool a script calls asks the person the way it always does (`ctx.ask`,
 * or the gate's own question); the chat's question reads this, so its card
 * can say "step 48 of the script", and the run's clock stops while the
 * person thinks.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface ScriptStep {
  runId: string;
  /** Which call of the run it is, from 1. */
  step: number;
  /** What the run is for, in the assistant's words. */
  title: string;
  /** A question is waiting on the person (`true`), or was answered (`false`). */
  asking(waiting: boolean): void;
}

export const scriptStep = new AsyncLocalStorage<ScriptStep>();

/**
 * Waits on `answer` as a question from the step running now, if one is:
 * the run's clock stops until it's answered.
 */
export async function askedFromScript<T>(step: ScriptStep | undefined, answer: Promise<T>) {
  if (!step) return answer;
  step.asking(true);
  try {
    return await answer;
  } finally {
    step.asking(false);
  }
}
