import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react';

import { cx } from '../../utils/cx';
import styles from './VirtualList.module.css';

export interface VirtualListHandle {
  /** Bring a row into view, scrolling no further than it takes to show all of it. */
  scrollToIndex: (index: number) => void;
}

export interface VirtualListProps<T> extends Omit<ComponentProps<'div'>, 'children'> {
  items: readonly T[];
  /** A row's height in rem: one number for every row, or one per item. */
  rowHeight: number | ((item: T, index: number) => number);
  getKey: (item: T, index: number) => string;
  /** Draws one row. Keep it cheap, or memoised: it runs as the list scrolls. */
  children: (item: T, index: number) => ReactNode;
  /** Attributes for a row's own box: its role, its place among all of them. */
  rowProps?: (item: T, index: number) => ComponentProps<'div'>;
  /**
   * Rows that stay at the top while their group passes under them (headings).
   * What's held is a copy for the eye, so a heading mustn't hold anything to press.
   */
  sticky?: (item: T, index: number) => boolean;
  /** Rows drawn beyond each edge, so a fast scroll never shows a gap. */
  overscan?: number;
  handle?: Ref<VirtualListHandle>;
}

const ROOT_PX = 16;
/** Until the box has been measured (and where there's no layout at all). */
const UNMEASURED_PX = 640;

function rootPx(): number {
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return px > 0 ? px : ROOT_PX;
}

/** The last place in a rising list that is at or before `value` (-1 when none is). */
function lastAtOrBefore(sorted: ArrayLike<number>, value: number): number {
  let low = 0;
  let high = sorted.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((sorted[mid] ?? 0) <= value) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/**
 * A long list that only draws the rows in view. A thousand rows cost what
 * twenty do, so typing in a search above it, or selecting a row, never waits
 * on the list. Rows are placed in rem, so they sit exactly where CSS would
 * have put them at any text size; the scrollbar speaks for all of them.
 *
 * The row that has the keyboard stays drawn while it's scrolled out of view,
 * so focus is never lost to scrolling.
 *
 * It is the scrolling box itself: give it a height, and no padding above
 * (rows are placed from its top edge, and a heading held there would leave a
 * strip for rows to show through).
 */
export function VirtualList<T>({
  items,
  rowHeight,
  getKey,
  children,
  rowProps,
  sticky,
  overscan = 6,
  handle,
  className,
  onScroll,
  ...props
}: VirtualListProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [box, setBox] = useState({ height: 0, rem: ROOT_PX });
  const [heldKey, setHeldKey] = useState<string>();
  const count = items.length;

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () =>
      setBox((was) => {
        const next = { height: el.clientHeight, rem: rootPx() };
        return was.height === next.height && was.rem === next.rem ? was : next;
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The row that has the keyboard is held (see `held`). Listened for on the
  // element itself: the list's box isn't something to press, only its rows are.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const focusIn = (e: FocusEvent) =>
      setHeldKey((e.target as Element).closest<HTMLElement>('[data-vl-key]')?.dataset.vlKey);
    const focusOut = (e: FocusEvent) => {
      if (!(e.relatedTarget instanceof Node) || !el.contains(e.relatedTarget))
        setHeldKey(undefined);
    };
    el.addEventListener('focusin', focusIn);
    el.addEventListener('focusout', focusOut);
    return () => {
      el.removeEventListener('focusin', focusIn);
      el.removeEventListener('focusout', focusOut);
    };
  }, []);

  // Where each row starts, in rem; the last entry is where the list ends.
  const offsets = useMemo(() => {
    const at = new Float64Array(count + 1);
    for (let i = 0; i < count; i += 1)
      at[i + 1] =
        (at[i] ?? 0) + (typeof rowHeight === 'number' ? rowHeight : rowHeight(items[i] as T, i));
    return at;
  }, [items, count, rowHeight]);
  const heightOf = useCallback(
    (index: number) => (offsets[index + 1] ?? 0) - (offsets[index] ?? 0),
    [offsets],
  );

  const stickies = useMemo(
    () => (sticky ? items.flatMap((item, i) => (sticky(item, i) ? [i] : [])) : []),
    [items, sticky],
  );

  const view = box.height || UNMEASURED_PX;
  const first = Math.max(0, lastAtOrBefore(offsets, scrollTop / box.rem));
  const last = Math.min(count - 1, lastAtOrBefore(offsets, (scrollTop + view) / box.rem - 1e-6));
  const from = Math.max(0, first - overscan);
  const to = Math.min(count - 1, last + overscan);

  const held = useMemo(
    () => (heldKey === undefined ? -1 : items.findIndex((item, i) => getKey(item, i) === heldKey)),
    [items, getKey, heldKey],
  );
  const drawn: number[] = [];
  if (held !== -1 && held < from) drawn.push(held);
  for (let i = from; i <= to; i += 1) drawn.push(i);
  if (held > to) drawn.push(held);

  const heading = stickies[lastAtOrBefore(stickies, first)];

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = root.current;
      if (!el || index < 0 || index >= count) return;
      const top = (offsets[index] ?? 0) * box.rem;
      const bottom = (offsets[index + 1] ?? 0) * box.rem;
      // A heading held at the top would cover the row: leave room for it.
      const above = stickies[lastAtOrBefore(stickies, index)];
      const cover = above === undefined || above === index ? 0 : heightOf(above) * box.rem;
      let next = el.scrollTop;
      if (top - cover < next) next = top - cover;
      else if (bottom > next + (el.clientHeight || UNMEASURED_PX))
        next = bottom - (el.clientHeight || UNMEASURED_PX);
      if (next === el.scrollTop) return;
      el.scrollTop = next;
      // Drawn in this same update, so the caller can move focus to it straight away.
      setScrollTop(next);
    },
    [count, offsets, box.rem, stickies, heightOf],
  );
  useImperativeHandle(handle, () => ({ scrollToIndex }), [scrollToIndex]);

  const place = (index: number) =>
    ({
      '--vl-at': String(offsets[index] ?? 0),
      '--vl-h': String(heightOf(index)),
    }) as CSSProperties;

  return (
    <div
      ref={root}
      className={cx(styles.root, className)}
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
        onScroll?.(e);
      }}
      {...props}
    >
      {heading !== undefined && (
        <div
          data-vl-sticky=""
          aria-hidden
          inert
          className={styles.sticky}
          style={{ '--vl-h': String(heightOf(heading)) } as CSSProperties}
        >
          {children(items[heading] as T, heading)}
        </div>
      )}
      <div
        role="presentation"
        data-vl-size={String(offsets[count] ?? 0)}
        className={styles.size}
        style={{ '--vl-size': String(offsets[count] ?? 0) } as CSSProperties}
      >
        {drawn.map((index) => {
          const item = items[index] as T;
          const key = getKey(item, index);
          const own = rowProps?.(item, index);
          return (
            <div
              key={key}
              {...own}
              data-vl-key={key}
              className={cx(styles.row, own?.className)}
              style={{ ...place(index), ...own?.style }}
            >
              {children(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
