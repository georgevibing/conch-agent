import { paceMessage, type WorkloadPace } from '../recovery/pace';

/** Per-turn cursor over shared state: no per-chat sampler, timer or unbounded event queue. */
export function resourceFeedback(
  read: () => WorkloadPace,
  signal: AbortSignal,
  now: () => number = () => performance.now(),
) {
  let previous = 'normal';
  let severity = 0;
  let saidAt = -Infinity;
  const take = (initial = false) => {
    if (signal.aborted) return;
    const pace = read();
    const key = `${pace.phase}:${pace.cause}:${pace.critical}`;
    if (!initial && previous === 'normal' && pace.phase === 'normal') return;
    const level = pace.critical
      ? 3
      : pace.phase === 'held'
        ? 2
        : pace.phase === 'constrained'
          ? 1
          : 0;
    if (!initial && (key === previous || (level <= severity && now() - saidAt < 30_000))) return;
    previous = key;
    severity = level;
    saidAt = now();
    return initial && pace.phase === 'normal'
      ? ROOM_NOTE
      : `[Conch resource update: ${paceMessage(pace)}]`;
  };
  return { take };
}

/**
 * What a turn starts with when this computer has room: the same words every
 * time, so they can stay in a session's system text (ADR 0085). Any other
 * update is about now, and goes with the message or a step's results.
 */
export const ROOM_NOTE =
  '[Conch resource update: This computer currently has room for managed work. Use process_start for builds, tests and other heavy commands. Resource updates may ask you to reduce parallelism or wait; follow them without abandoning the task or bypassing permissions.]';
