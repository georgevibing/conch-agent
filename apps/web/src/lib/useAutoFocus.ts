import { useEffect, useRef } from 'react';

/**
 * Focus an element when it mounts. Used only where focus moving is the
 * expected result of the user's own action (opening an inline editor, a step
 * the user just advanced to), never on initial page load.
 */
export function useAutoFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    // `focusVisible: false`: moving focus for the user shouldn't draw a keyboard ring.
    ref.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
  }, []);
  return ref;
}
