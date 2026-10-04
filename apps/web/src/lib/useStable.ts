import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A function that keeps one identity for the component's life and always
 * runs the newest `fn`: handed to a memoised child, it doesn't make it draw
 * again each time the parent does (a keystroke in the composer). For event
 * handlers only, never called while rendering.
 */
export function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}
