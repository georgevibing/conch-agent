import { useEffect, useRef, useState, type ComponentProps } from 'react';

import { trackScrollEdges } from '../../utils/scrollEdges';
import styles from './Prose.module.css';

export interface ProseTableProps extends ComponentProps<'table'> {
  /** Accessible name for the scrolling group when the table is wider than its space. */
  label?: string;
}

/**
 * A Markdown table that keeps its columns readable on a narrow screen: rather
 * than squeezing words letter by letter, it grows to a comfortable width and
 * scrolls sideways. The edge with more beyond it fades out (both, mid-scroll),
 * and the first time an overflowing table comes into view it peeks a little
 * to show it moves. When it's scrollable it's a labelled group you can reach
 * with Tab and scroll with the arrow keys.
 */
export function ProseTable({ label = 'Table', className, style, ...props }: ProseTableProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const [peek, setPeek] = useState(false);
  const peeked = useRef(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const table = el.querySelector('table');
    const columns = table?.rows[0]?.cells.length ?? 0;
    if (table && columns) table.style.setProperty('--pt-cols', String(columns));
    return trackScrollEdges(el, (edges) => setScrollable(edges.start || edges.end));
  }, []);

  // Peek once, the first time it's seen while overflowing.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !scrollable || peeked.current || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        peeked.current = true;
        if (el.scrollLeft === 0) setPeek(true);
        io.disconnect();
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [scrollable]);

  return (
    <div className={styles.tableFrame} data-scrollable={scrollable || undefined}>
      <div
        ref={scroller}
        className={styles.tableScroll}
        role={scrollable ? 'group' : undefined}
        aria-label={scrollable ? label : undefined}
        // What scrolls must be reachable from the keyboard (WCAG 2.1.1). A group, not
        // a region: a reply with several tables would be a page of identical landmarks.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={scrollable ? 0 : undefined}
        data-peek={peek || undefined}
        onPointerDown={() => setPeek(false)}
        onAnimationEnd={() => setPeek(false)}
      >
        <table className={className} style={style} {...props} />
      </div>
    </div>
  );
}
