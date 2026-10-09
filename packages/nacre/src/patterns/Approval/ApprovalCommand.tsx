import { ChevronDown } from 'lucide-react';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
} from 'react';

import { cx } from '../../utils/cx';
import styles from './ApprovalCommand.module.css';

export interface ApprovalCommandProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The command, exactly as it would run. */
  children: string;
  /** How many lines show before "Show all". */
  lines?: number;
  /** What it is, for a screen reader: "Command". */
  label?: string;
}

/**
 * Exactly what a step would run, under the plain words that say what it does
 * (ADR 0028, ADR 0108): monospace at code size, long lines wrapped where they
 * can break, a few lines shown and the rest a press away. Opened, a very long
 * one scrolls inside the block, so the answers stay in reach.
 */
export function ApprovalCommand({
  children,
  lines = 7,
  label = 'Command',
  className,
  style,
  ...props
}: ApprovalCommandProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || open) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [children, lines, open]);
  return (
    <div
      className={cx(styles.command, className)}
      data-open={open || undefined}
      data-clipped={(clipped && !open) || undefined}
      style={{ '--ac-lines': lines, ...style } as CSSProperties}
      {...props}
    >
      <div
        ref={box}
        id={id}
        className={styles.viewport}
        // Opened, a long one scrolls here: reachable from the keyboard (WCAG 2.1.1).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={open ? 0 : undefined}
        role="group"
        aria-label={label}
      >
        <pre className={styles.text}>{children}</pre>
      </div>
      {(clipped || open) && (
        <button
          type="button"
          className={styles.more}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((was) => !was)}
        >
          {open ? 'Show less' : 'Show all'}
          <ChevronDown aria-hidden />
        </button>
      )}
    </div>
  );
}
