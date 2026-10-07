import { MotionConfig, motion } from 'motion/react';
import { ToggleGroup } from 'radix-ui';
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';

import { springs } from '../../tokens';
import { cx } from '../../utils/cx';
import { useMotionFromPeople } from '../../utils/useMotionFromPeople';
import styles from './SegmentedControl.module.css';

interface SegmentedContextValue {
  value: string;
  indicatorId: string;
  /** A person is choosing: the pill glides. Otherwise it's simply there. */
  moving: boolean;
}

const SegmentedContext = createContext<SegmentedContextValue | null>(null);

export interface SegmentedControlProps extends Omit<
  ComponentProps<typeof ToggleGroup.Root>,
  'type' | 'value' | 'defaultValue' | 'onValueChange'
> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  size?: 'sm' | 'md';
  /** Stretch segments to fill the container equally. */
  block?: boolean;
}

/**
 * Mutually exclusive view switcher. A porcelain pill glides between segments
 * on a spring when someone chooses; chosen by data, it's simply there.
 * Unlike a toggle group it can never be empty.
 */
function SegmentedControlRoot({
  value: valueProp,
  defaultValue = '',
  onValueChange,
  size = 'md',
  block,
  className,
  children,
  ref: forwarded,
  onScroll,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onClick,
  ...props
}: SegmentedControlProps) {
  const [internal, setInternal] = useState(defaultValue);
  const value = valueProp ?? internal;
  const indicatorId = useId();
  const { ref, edges, measure } = useOverflow(value);
  const { moving, ...motion } = useMotionFromPeople(valueProp, {
    onPointerEnter,
    onPointerLeave,
    onPointerDown,
    onClick,
  });

  return (
    <SegmentedContext.Provider value={{ value, indicatorId, moving }}>
      <MotionConfig reducedMotion="user">
        <ToggleGroup.Root
          type="single"
          value={value}
          onValueChange={(next) => {
            if (!next) return; // never allow deselecting
            if (valueProp === undefined) setInternal(next);
            onValueChange?.(next);
          }}
          data-size={size}
          data-block={block || undefined}
          data-more-start={edges.start || undefined}
          data-more-end={edges.end || undefined}
          className={cx(styles.root, className)}
          {...props}
          {...motion}
          ref={(el: HTMLDivElement | null) => {
            ref.current = el;
            if (typeof forwarded === 'function') forwarded(el);
            else if (forwarded) forwarded.current = el;
          }}
          onScroll={(event) => {
            measure();
            onScroll?.(event);
          }}
        >
          {children}
        </ToggleGroup.Root>
      </MotionConfig>
    </SegmentedContext.Provider>
  );
}

/**
 * Wider than the room it has (a phone): it scrolls sideways within its own
 * width instead of pushing the page wider, fades at the edge that has more,
 * and keeps the chosen segment in view.
 */
function useOverflow(value: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const at = Math.abs(el.scrollLeft);
    const next = { start: max > 1 && at > 1, end: max > 1 && at < max - 1 };
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);
  // The chosen one in view, without moving the page around it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const on = el.querySelector<HTMLElement>('[data-state="on"]');
    if (!on) return;
    const box = el.getBoundingClientRect();
    const item = on.getBoundingClientRect();
    const left = item.left - box.left + el.scrollLeft;
    const right = left + item.width;
    if (left < el.scrollLeft) el.scrollLeft = left - 16;
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth + 16;
    measure();
  }, [value, measure]);
  return { ref, edges, measure };
}

export interface SegmentedControlItemProps extends ComponentProps<typeof ToggleGroup.Item> {
  icon?: ReactNode;
}

function SegmentedControlItem({
  icon,
  children,
  className,
  value,
  ...props
}: SegmentedControlItemProps) {
  const ctx = useContext(SegmentedContext);
  const active = ctx?.value === value;
  return (
    <ToggleGroup.Item value={value} className={cx(styles.item, className)} {...props}>
      {active && (
        <motion.span
          layoutId={ctx?.indicatorId}
          className={styles.indicator}
          transition={ctx?.moving ? springs.snappy : { duration: 0 }}
          aria-hidden
        />
      )}
      <span className={styles.content}>
        {icon != null && (
          <span className={styles.icon} aria-hidden>
            {icon}
          </span>
        )}
        {children != null && <span className={styles.label}>{children}</span>}
      </span>
    </ToggleGroup.Item>
  );
}

export const SegmentedControl = Object.assign(SegmentedControlRoot, {
  Root: SegmentedControlRoot,
  Item: SegmentedControlItem,
});
