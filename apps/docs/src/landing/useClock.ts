import { usePrefersReducedMotion } from '@conch/nacre';
import { useEffect, useRef, useState } from 'react';

/**
 * A clock for a scripted picture: milliseconds since it began, going round
 * every `length`. It only runs while `running` (the picture is in view), ticks
 * about twelve times a second. With reduced motion it never moves: it stands
 * at `rest`, the moment of the story worth a still picture (the end, unless
 * the best moment comes earlier).
 */
export function useClock(length: number, running = true, rest = length): number {
  const still = usePrefersReducedMotion();
  const [now, setNow] = useState(0);
  const began = useRef(0);

  useEffect(() => {
    if (still || !running) return;
    let frame = 0;
    began.current = 0;
    const tick = (time: number) => {
      began.current ||= time;
      let elapsed = time - began.current;
      // A tab left in the background comes back to the start, not half way through.
      if (elapsed > length) {
        began.current = time;
        elapsed = 0;
      }
      setNow((was) => (elapsed === 0 || Math.abs(elapsed - was) > 80 ? elapsed : was));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [length, running, still]);

  return still ? rest : now;
}

/** How much of some words has arrived at `now`, at an even pace between two moments. */
export function arrived(text: string, now: number, from: number, to: number): string {
  if (now >= to) return text;
  return text.slice(0, Math.max(0, Math.round(((now - from) / (to - from)) * text.length)));
}
