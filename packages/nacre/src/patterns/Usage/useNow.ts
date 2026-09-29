import { useEffect, useState } from 'react';

/**
 * The current time, re-read every `intervalMs` so countdowns stay live.
 * Pass `fixed` (stories, tests, server snapshots) to freeze the clock.
 */
export function useNow(intervalMs = 30_000, fixed?: number): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, fixed]);
  return fixed ?? now;
}
