import type { ComponentProps, CSSProperties, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './PortalSketch.module.css';

export interface PortalSketchProps extends Omit<ComponentProps<'figure'>, 'title'> {
  /** What the picture shows, for screen readers. */
  label: string;
  /** The address, as the browser would show it ("discord.com/developers"). */
  address: string;
  /** The page's menu, with the item to open. */
  nav?: string[];
  active?: string;
  /** The page's heading. */
  title: string;
  /** Lines of the page, drawn as text or as quiet bars. */
  children?: ReactNode;
  color?: string;
}

/**
 * A sketch of a web page or settings window Conch sends you to (the Discord
 * Developer Portal, Slack's app settings, macOS System Settings): its menu
 * with the right item marked, and the button or switch to press lit up. Not
 * a screenshot — just enough to recognise the place.
 */
function PortalSketchRoot({
  label,
  address,
  nav,
  active,
  title,
  children,
  color,
  className,
  style,
  ...props
}: PortalSketchProps) {
  return (
    <figure
      aria-label={label}
      className={cx(styles.sketch, className)}
      data-lustre=""
      style={{ ...(color && { '--ps-brand': color }), ...style } as CSSProperties}
      {...props}
    >
      <div className={styles.chrome} aria-hidden>
        <span className={styles.dots}>
          <span />
          <span />
          <span />
        </span>
        <span className={styles.address}>{address}</span>
      </div>
      <div className={styles.page}>
        {nav && (
          <ul className={styles.nav}>
            {nav.map((item) => (
              <li key={item} data-active={item === active || undefined}>
                {item}
                {item === active && <span className="nc-visually-hidden"> (open this)</span>}
              </li>
            ))}
          </ul>
        )}
        <div className={styles.main}>
          <p className={styles.title}>{title}</p>
          {children}
        </div>
      </div>
    </figure>
  );
}

/** The button to press, lit up. */
function PortalButton({ children, quiet }: { children: ReactNode; quiet?: boolean }) {
  return (
    <span className={styles.button} data-quiet={quiet || undefined}>
      {children}
      {!quiet && <span className="nc-visually-hidden"> (press this)</span>}
    </span>
  );
}

/** A line of the page that doesn't matter here. */
function PortalBar({ width = 70 }: { width?: number }) {
  return (
    <span className={styles.bar} style={{ '--ps-w': `${width}%` } as CSSProperties} aria-hidden />
  );
}

/** A labelled value on the page (a token, a setting). */
function PortalField({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <span className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children && <span className={styles.fieldValue}>{children}</span>}
    </span>
  );
}

function PortalRow({ children }: { children: ReactNode }) {
  return <span className={styles.row}>{children}</span>;
}

/**
 * A switch in a settings list (System Settings → Full Disk Access): the
 * app's name and its switch. `press` lights up the one to turn on.
 */
function PortalToggle({ label, on, press }: { label: string; on?: boolean; press?: boolean }) {
  return (
    <span className={styles.toggle} data-press={press || undefined}>
      <span>{label}</span>
      <span className={styles.switch} data-on={on || undefined} aria-hidden />
      <span className="nc-visually-hidden">
        {on ? ' (on)' : ' (off)'}
        {press ? ' (turn this on)' : ''}
      </span>
    </span>
  );
}

export const PortalSketch = Object.assign(PortalSketchRoot, {
  Root: PortalSketchRoot,
  Button: PortalButton,
  Bar: PortalBar,
  Field: PortalField,
  Row: PortalRow,
  Toggle: PortalToggle,
});
