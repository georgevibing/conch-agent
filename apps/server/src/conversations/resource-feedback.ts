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
    const message =
      initial && pace.phase === 'normal'
        ? 'This computer currently has room for managed work. Use process_start for builds, tests and other heavy commands. Resource updates may ask you to reduce parallelism or wait; follow them without abandoning the task or bypassing permissions.'
        : paceMessage(pace);
    return `[Conch resource update: ${message}]`;
  };
  return { take };
}
