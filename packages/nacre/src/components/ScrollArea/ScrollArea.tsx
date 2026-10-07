import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import { useEffect, useImperativeHandle, useRef, type ComponentProps, type Ref } from 'react';

import { cx } from '../../utils/cx';
import { trackScrollEdges } from '../../utils/scrollEdges';
import styles from './ScrollArea.module.css';

export interface ScrollAreaProps extends ComponentProps<typeof ScrollAreaPrimitive.Root> {
  /** Which scrollbars to render. */
  orientation?: 'vertical' | 'horizontal' | 'both';
  /** Soft fade at edges that have more content beyond them. */
  fade?: boolean;
  /** Ref to the scrolling viewport (for scroll-to-bottom in transcripts, etc). */
  viewportRef?: Ref<HTMLDivElement>;
  /** Accessible name for the scroll region, which makes it keyboard-focusable. */
  label?: string;
}

/**
 * Custom-styled scroll container with thin, auto-hiding scrollbars. Native
 * scrolling behaviour is preserved (wheel, touch, keyboard).
 */
export function ScrollArea({
  orientation = 'vertical',
  fade = true,
  type = 'hover',
  scrollHideDelay = 700,
  viewportRef,
  label,
  className,
  children,
  ...props
}: ScrollAreaProps) {
  const localRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(viewportRef, () => localRef.current as HTMLDivElement, []);

  useEffect(() => {
    const el = localRef.current;
    if (!el || !fade) return;
    return trackScrollEdges(el);
  }, [fade]);

  return (
    <ScrollAreaPrimitive.Root
      type={type}
      scrollHideDelay={scrollHideDelay}
      className={cx(styles.root, className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={localRef}
        data-fade={fade ? orientation : undefined}
        className={styles.viewport}
        tabIndex={label ? 0 : undefined}
        role={label ? 'region' : undefined}
        aria-label={label}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {orientation !== 'horizontal' && (
        <ScrollAreaPrimitive.Scrollbar orientation="vertical" className={styles.scrollbar}>
          <ScrollAreaPrimitive.Thumb className={styles.thumb} />
        </ScrollAreaPrimitive.Scrollbar>
      )}
      {orientation !== 'vertical' && (
        <ScrollAreaPrimitive.Scrollbar orientation="horizontal" className={styles.scrollbar}>
          <ScrollAreaPrimitive.Thumb className={styles.thumb} />
        </ScrollAreaPrimitive.Scrollbar>
      )}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}
