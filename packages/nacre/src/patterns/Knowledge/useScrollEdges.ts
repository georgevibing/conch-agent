import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Whether a row that scrolls sideways has more to see before or after what's
 * in view, as `data-*` attributes for its edge fades. Only how it looks: the
 * row scrolls, and keys move through it, by themselves.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = Math.abs(el.scrollLeft);
    const start = left > 1;
    const end = left + el.clientWidth < el.scrollWidth - 1;
    setEdges((now) => (now.start === start && now.end === end ? now : { start, end }));
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const watch = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    watch?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      watch?.disconnect();
    };
  }, [measure]);
  return [
    ref,
    {
      'data-more-start': edges.start || undefined,
      'data-more-end': edges.end || undefined,
    },
  ] as const;
}
