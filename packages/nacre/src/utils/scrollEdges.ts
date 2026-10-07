export interface ScrollEdges {
  top: boolean;
  bottom: boolean;
  start: boolean;
  end: boolean;
}

/**
 * Keep `data-fade-{top,bottom,start,end}` on a scroller in step with which
 * edges have more content beyond them, through scrolling and resizing (its own
 * and its content's). CSS turns those into edge fades. Returns the cleanup.
 */
export function trackScrollEdges(
  el: HTMLElement,
  onChange?: (edges: ScrollEdges) => void,
): () => void {
  const eps = 1;
  const update = () => {
    // Right-to-left scrollers count scrollLeft down from 0.
    const left = Math.abs(el.scrollLeft);
    const edges = {
      top: el.scrollTop > eps,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - eps,
      start: left > eps,
      end: left + el.clientWidth < el.scrollWidth - eps,
    };
    el.dataset.fadeTop = String(edges.top);
    el.dataset.fadeBottom = String(edges.bottom);
    el.dataset.fadeStart = String(edges.start);
    el.dataset.fadeEnd = String(edges.end);
    onChange?.(edges);
  };
  update();
  el.addEventListener('scroll', update, { passive: true });
  const ro = new ResizeObserver(update);
  ro.observe(el);
  if (el.firstElementChild) ro.observe(el.firstElementChild);
  return () => {
    el.removeEventListener('scroll', update);
    ro.disconnect();
  };
}
