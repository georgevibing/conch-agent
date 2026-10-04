import { useCallback, useSyncExternalStore } from 'react';

/** A screen used only by touch: no hover and no fine pointer, so most likely no keyboard. */
export const TOUCH_ONLY = '(hover: none) and (pointer: coarse)';

/** Subscribes to a CSS media query. Returns `false` when `matchMedia` is unavailable. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== 'undefined' && window.matchMedia?.(query).matches) || false,
    () => false,
  );
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}
