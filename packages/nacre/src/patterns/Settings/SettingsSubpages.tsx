import { ChevronRight } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './SettingsSubpages.module.css';

export interface SettingsRowProps extends Omit<ComponentProps<'button'>, 'value'> {
  /** What the page it opens is called: “Topics”, “Limits”. */
  label: ReactNode;
  /** A few words under the label, when the name alone doesn't say enough. */
  description?: ReactNode;
  /** Where things stand, at the row's end: “4 of 6”, “On”. */
  value?: ReactNode;
  /** A mark before the label. */
  icon?: ReactNode;
  /**
   * The page it opens, as `SettingsSubpages` names it. Coming back from that
   * page puts the focus on this row again.
   */
  page?: string;
  /** `plain` inside a card that already draws the edge; `boxed` on a page. */
  variant?: 'boxed' | 'plain';
}

/**
 * One row that leads to a page of its own (NACRE.md § Settings): its name, a
 * few words, where things stand, and a chevron. The whole row is the button.
 */
export function SettingsRow({
  label,
  description,
  value,
  icon,
  page,
  variant = 'boxed',
  className,
  type = 'button',
  ...props
}: SettingsRowProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      data-subpage-row={page}
      className={cx(styles.row, className)}
      {...props}
    >
      {icon != null && (
        <span className={styles.icon} aria-hidden>
          {icon}
        </span>
      )}
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {description != null && <span className={styles.description}>{description}</span>}
      </span>
      {value != null && <span className={styles.value}>{value}</span>}
      <ChevronRight aria-hidden className={styles.chevron} />
    </button>
  );
}

export interface SettingsSubpagesProps extends ComponentProps<'div'> {
  /**
   * The page inside the place that's showing, or nothing for the place
   * itself. Changing it slides the new page in: from the end going in, from
   * the start coming back.
   */
  page?: string | null;
  /** The place itself (`page` empty), or the page it names. */
  children: ReactNode;
}

type Direction = 'in' | 'out';

/**
 * A place in Settings with pages inside it, the way a phone's settings drill
 * in: a `SettingsRow` opens a page, which slides in from the side it points
 * to, and stepping back slides the place in from the other side, with the
 * focus back on the row it came from.
 *
 * Its way back is the trail above it (Notifications › Topics), never a back
 * button of its own (NACRE.md § Where you are). Arriving by an address, a
 * reload or a link, the page is simply there: only a change plays the slide,
 * and reduced motion makes it instant.
 */
export function SettingsSubpages({ page, children, className, ...props }: SettingsSubpagesProps) {
  const at = page ?? null;
  const ref = useRef<HTMLDivElement>(null);
  const [was, setWas] = useState(at);
  const [direction, setDirection] = useState<Direction>();
  const [left, setLeft] = useState<string | null>(null);
  // Which way it moved, worked out while drawing (no frame in the old place).
  if (was !== at) {
    setWas(at);
    setDirection(at === null ? 'out' : 'in');
    setLeft(was);
  }

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !direction) return;
    // A page opened from far down the place starts at its top.
    if (root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: 'start' });
    const lost = !document.activeElement || document.activeElement === document.body;
    // Back where it came from: the row that opened the page it left.
    if (direction === 'out' && left && lost)
      [...root.querySelectorAll<HTMLElement>('[data-subpage-row]')]
        .find((row) => row.dataset.subpageRow === left)
        ?.focus();
  }, [at, direction, left]);

  return (
    <div
      ref={ref}
      key={at ?? ''}
      data-direction={direction}
      data-page={at ?? undefined}
      className={cx(styles.pages, className)}
      {...props}
    >
      {children}
    </div>
  );
}
