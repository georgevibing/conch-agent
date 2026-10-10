/**
 * A waiting task's line, as a person reads it (ADR 0128): why it waits, then,
 * when it's known, when it tries again ("trying again in 20s") or about when it
 * should start ("likely in about 3 min"). The words come from the gateway; the
 * time is counted here, so it stays true as the seconds pass.
 */
import type { TaskWaiting } from './tasks';

/** "20s", "about 3 min", "about 1 h". */
function soon(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.round(m / 60)} h`;
}

/** When it tries again or should start, in a few words; undefined when there's nothing to say. */
export function waitingWhen(waiting: TaskWaiting, now: number): string | undefined {
  if (waiting.retryAt !== undefined && waiting.retryAt > now)
    return `trying again in ${soon(waiting.retryAt - now)}`;
  // A guess from what's working now: only worth saying while it's ahead.
  if (waiting.expectedAt !== undefined && waiting.expectedAt - now >= 30_000)
    return `likely in about ${soon(waiting.expectedAt - now)}`;
  return undefined;
}

/** The whole line: "Codex asked Conch to slow down · trying again in 20s". */
export function waitingLine(waiting: TaskWaiting, now: number): string {
  const when = waitingWhen(waiting, now);
  return when ? `${waiting.words} · ${when}` : waiting.words;
}
