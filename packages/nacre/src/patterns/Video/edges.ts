import { useEffect, type RefObject } from 'react';

import { trackScrollEdges } from '../../utils/scrollEdges';

/** A row that scrolls sideways fades out at the edge with more beyond it. */
export function useScrollEdges(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    return trackScrollEdges(el);
  }, [ref]);
}
