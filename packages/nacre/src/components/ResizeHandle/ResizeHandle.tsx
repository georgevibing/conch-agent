import {
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import { cx } from '../../utils/cx';
import styles from './ResizeHandle.module.css';

export interface ResizeHandleProps extends Omit<
  ComponentProps<'div'>,
  'onChange' | 'children' | 'defaultValue'
> {
  /** The size it controls, in pixels. */
  value: number;
  min: number;
  max: number;
  onValueChange: (value: number) => void;
  /**
   * Which way dragging grows the size. `start`: dragging toward the start edge
   * grows it (a panel on the right, resized from its left edge).
   */
  grows?: 'start' | 'end';
  /** Accessible name, e.g. "Resize the browser". */
  label: string;
  /** Pixels per arrow-key press (Shift: ×4). */
  step?: number;
  /**
   * `x`: a vertical seam between side-by-side panes (drag left/right).
   * `y`: a horizontal seam above a drawer (drag up/down).
   */
  axis?: 'x' | 'y';
}

/**
 * The seam between two panes. Drag it, or focus it and use the arrow keys
 * (Home and End jump to the limits). For assistive tech it is a slider over
 * the pane's width: the same value, limits and arrow keys as the WAI-ARIA
 * window splitter, in a role every screen reader announces as adjustable.
 */
export function ResizeHandle({
  value,
  min,
  max,
  onValueChange,
  grows = 'start',
  label,
  step = 24,
  axis = 'x',
  className,
  ...props
}: ResizeHandleProps) {
  const drag = useRef<{ at: number; value: number } | null>(null);
  const at = (event: PointerEvent<HTMLDivElement>) =>
    axis === 'x' ? event.clientX : event.clientY;
  const [dragging, setDragging] = useState(false);
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  const sign = grows === 'start' ? -1 : 1;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { at: at(event), value };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onValueChange(clamp(drag.current.value + sign * (at(event) - drag.current.at)));
  };
  const onPointerUp = () => {
    drag.current = null;
    setDragging(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = event.shiftKey ? step * 4 : step;
    const [back, forward] = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    const keys: Record<string, number> = {
      [back]: value - sign * by,
      [forward]: value + sign * by,
      Home: min,
      End: max,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onValueChange(clamp(next));
  };

  return (
    <div
      role="slider"
      aria-orientation={axis === 'x' ? 'horizontal' : 'vertical'}
      aria-valuetext={`${Math.round(value)} pixels ${axis === 'x' ? 'wide' : 'tall'}`}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={cx(styles.handle, className)}
      data-axis={axis}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      {...props}
    >
      <span className={styles.grip} aria-hidden />
    </div>
  );
}
