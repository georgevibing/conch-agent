/**
 * Why a task is still waiting (ADR 0129), as its card and line say it: the
 * reason in a few words, then, when it's known, when it tries again or about
 * when it should start. The words come from the gateway; the time is counted
 * here, every second, so it stays true. (Mirrors `waitingWhen` in
 * @conch/protocol; Nacre stays dependency-free.)
 */

/** A waiting task's reason. */
export interface TaskWaitingInfo {
  /** "Starts when “Web fetch” finishes", "Waiting for memory: 3 heavy tasks working". */
  words: string;
  /** When it tries again, when that's known (epoch ms). */
  retryAt?: number;
  /** About when it should start: a guess (epoch ms). */
  expectedAt?: number;
  /** Given, it waits only for room, and the person may start it now. */
  onStartNow?: () => void;
  /** "Start now" was pressed: the button waits for the answer to land. */
  starting?: boolean;
}

function soon(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.round(m / 60)} h`;
}

/** "trying again in 20s", "likely in about 3 min", or nothing worth saying. */
export function taskWaitingWhen(
  waiting: Pick<TaskWaitingInfo, 'retryAt' | 'expectedAt'>,
  now: number,
): string | undefined {
  if (waiting.retryAt !== undefined && waiting.retryAt > now)
    return `trying again in ${soon(waiting.retryAt - now)}`;
  if (waiting.expectedAt !== undefined && waiting.expectedAt - now >= 30_000)
    return `likely in about ${soon(waiting.expectedAt - now)}`;
  return undefined;
}

/** The whole line: "Codex asked Conch to slow down · trying again in 20s". */
export function taskWaitingLine(waiting: TaskWaitingInfo, now: number): string {
  const when = taskWaitingWhen(waiting, now);
  return when ? `${waiting.words} · ${when}` : waiting.words;
}
