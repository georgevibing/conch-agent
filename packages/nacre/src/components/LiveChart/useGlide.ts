import { useReducedMotionConfig } from 'motion/react';
import { useLayoutEffect, useRef } from 'react';

/**
 * A live chart moves like a conveyor, never a jump. Each new reading is drawn
 * where it belongs, then the drawing is set back by exactly how far time moved
 * and glides home over one sampling interval, linearly, so the line flows
 * left continuously and the newest point slides in from the edge. A gap
 * bigger than `limit` (the page was hidden) just redraws. Reduced motion
 * redraws in place.
 */
export function useGlide<T extends SVGElement | HTMLElement>(
  latest: number | undefined,
  /** How far, in the element's own units, a move of `ms` milliseconds is. */
  distance: (ms: number) => number,
  durationMs: number,
  limit: number,
) {
  const ref = useRef<T>(null);
  const reduced = useReducedMotionConfig() === true;
  const previous = useRef(latest);
  useLayoutEffect(() => {
    const el = ref.current;
    const before = previous.current;
    previous.current = latest;
    if (!el || reduced || before === undefined || latest === undefined || latest <= before) return;
    const dx = distance(latest - before);
    if (!(dx > 0) || dx > limit) return;
    el.style.transition = 'none';
    el.style.transform = `translateX(${dx}px)`;
    // Commit the starting place before gliding from it.
    void el.getBoundingClientRect();
    el.style.transition = `transform ${durationMs}ms linear`;
    el.style.transform = 'translateX(0px)';
    // Only a new reading moves it; the measures it uses are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);
  return ref;
}
