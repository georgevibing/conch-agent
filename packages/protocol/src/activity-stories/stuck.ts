/**
 * When a story is going round in circles, said plainly: the same thing failing
 * again and again, the same change made and undone, a running command checked
 * on over and over with nothing new. Works on a story still running too, so
 * the chat can say it while there's time to step in.
 */
import type { StoryStep } from '../activity-stories';
import { isFailed, isNoiseStep, isSettled, sameKey } from './steps';

export const STUCK_FAILURES = 3;
export const STUCK_POLLS = 4;
/** Polls this far apart (first to last) with nothing new are a long wait. */
export const STUCK_POLL_MS = 2 * 60_000;
export const STUCK_REVERTS = 2;

function failedTooOften(steps: readonly StoryStep[]): string | undefined {
  const failures = new Map<string, { n: number; step: StoryStep }>();
  for (const step of steps) {
    if (isNoiseStep(step) || !isSettled(step)) continue;
    const key = sameKey(step);
    if (isFailed(step)) failures.set(key, { n: (failures.get(key)?.n ?? 0) + 1, step });
    else failures.delete(key);
  }
  let worst: { n: number; step: StoryStep } | undefined;
  for (const f of failures.values()) if (!worst || f.n > worst.n) worst = f;
  if (!worst || worst.n < STUCK_FAILURES) return undefined;
  const f = worst.step.label.family;
  const what = f === 'run' || f === 'verify' || f === 'ship' ? 'command' : 'step';
  return `The same ${what} failed ${worst.n} times`;
}

const FILE = ['file_path', 'filePath', 'path', 'file'];
const OLD = ['old_string', 'oldString', 'old_str', 'oldText', 'old'];
const NEW = ['new_string', 'newString', 'new_str', 'newText', 'new'];

function pick(input: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) if (typeof input[k] === 'string') return input[k];
  return undefined;
}

function changeOf(step: StoryStep): { file: string; from: string; to: string } | undefined {
  if (step.label.family !== 'edit' || !step.input || typeof step.input !== 'object')
    return undefined;
  const input = step.input as Record<string, unknown>;
  const file = pick(input, FILE) ?? step.label.subject;
  const from = pick(input, OLD);
  const to = pick(input, NEW);
  if (file === undefined || from === undefined || to === undefined || from === to) return undefined;
  return { file, from, to };
}

function undoneAndRedone(steps: readonly StoryStep[]): string | undefined {
  const changes = steps.flatMap((s) => {
    const c = changeOf(s);
    return c && !isFailed(s) ? [c] : [];
  });
  let reverts = 0;
  changes.forEach((c, i) => {
    if (changes.slice(0, i).some((p) => p.file === c.file && p.from === c.to && p.to === c.from)) {
      reverts += 1;
    }
  });
  return reverts >= STUCK_REVERTS ? 'It keeps making the same change and undoing it' : undefined;
}

function minutes(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m === 1 ? 'a minute' : `${m} minutes`;
}

function waitingOnNothing(steps: readonly StoryStep[]): string | undefined {
  // The latest run of identical checks, per thing checked on.
  const runs = new Map<string, { outcome: string; polls: StoryStep[] }>();
  for (const step of steps) {
    if (!isNoiseStep(step) || step.label.family === 'plan' || !isSettled(step)) continue;
    const key = sameKey(step);
    const outcome = step.label.outcome ?? '';
    const run = runs.get(key);
    if (run && run.outcome === outcome) run.polls.push(step);
    else runs.set(key, { outcome, polls: [step] });
  }
  for (const { polls } of runs.values()) {
    if (polls.length < STUCK_POLLS) continue;
    const first = polls[0] as StoryStep;
    const last = polls[polls.length - 1] as StoryStep;
    const span = last.startedAt + (last.durationMs ?? 0) - first.startedAt;
    if (span >= STUCK_POLL_MS) {
      return `Still running · checked ${polls.length} times in ${minutes(span)}, nothing new yet`;
    }
  }
  return undefined;
}

/** A plain sentence when the steps go round in circles, else nothing. */
export function stuckOf(steps: readonly StoryStep[]): string | undefined {
  return stuckReading(steps)?.text;
}

/**
 * The same, with how it should look. Checking on a running command again and
 * again is a provider waiting the slow way (ADR 0124: `wait_for` is the quick
 * one), not something going wrong: it's said calmly. Failing or undoing is a
 * warning.
 */
export function stuckReading(
  steps: readonly StoryStep[],
): { text: string; tone: 'warning' | 'calm' } | undefined {
  const wrong = failedTooOften(steps) ?? undoneAndRedone(steps);
  if (wrong) return { text: wrong, tone: 'warning' };
  const waiting = waitingOnNothing(steps);
  return waiting ? { text: waiting, tone: 'calm' } : undefined;
}
