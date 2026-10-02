import { Slot } from 'radix-ui';
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ElementType,
} from 'react';

import { cx } from '../../utils/cx';
import styles from './Reveal.module.css';

/**
 * Whether an element has come into view. Stays true once it has (`once`), so
 * what surfaced doesn't sink again; with `once: false` it follows the element
 * in and out, for things that should only run while someone can see them.
 */
export function useInView<T extends Element>({
  once = true,
  margin = '0px 0px -12% 0px',
}: { once?: boolean; margin?: string } = {}) {
  const ref = useRef<T>(null);
  // Where the browser can't tell (old ones, tests), everything counts as in view.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries.some((entry) => entry.isIntersecting);
        if (seen && once) observer.disconnect();
        setInView((was) => (once ? was || seen : seen));
      },
      { rootMargin: margin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [once, margin]);

  return [ref, inView] as const;
}

export interface RevealProps extends ComponentProps<'div'> {
  /** Its place among things that surface together: each waits a beat longer. */
  index?: number;
  as?: 'div' | 'section' | 'li' | 'article' | 'header' | 'footer';
  /** Merge onto the single child instead of adding an element. */
  asChild?: boolean;
}

/**
 * Surfaces its content the first time it scrolls into view: Nacre's entrance
 * (a few pixels up, out of soft focus), once. The words are in the page from
 * the start, so nothing is hidden from a screen reader or a search engine,
 * and with reduced motion nothing moves at all.
 */
export function Reveal({
  index = 0,
  as = 'div',
  asChild,
  className,
  style,
  ...props
}: RevealProps) {
  const [ref, shown] = useInView<HTMLDivElement>();
  const Comp: ElementType = asChild ? Slot.Root : as;
  return (
    <Comp
      ref={ref}
      data-shown={shown || undefined}
      className={cx(styles.reveal, className)}
      style={{ '--rv-index': index, ...style } as CSSProperties}
      {...props}
    />
  );
}
