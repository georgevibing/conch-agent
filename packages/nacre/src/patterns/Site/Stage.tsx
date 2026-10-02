import type { ComponentProps, CSSProperties, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Stage.module.css';

export interface StageProps extends Omit<ComponentProps<'figure'>, 'title'> {
  /** What the picture shows, in a sentence: it's all a screen reader gets of it. */
  label: string;
  /** A title bar across the top, like a window's: who is speaking, a status. */
  bar?: ReactNode;
  /** Something is happening in it: the rim slowly orbits. */
  alive?: boolean;
  /** A slow tide of pearl light behind it. For the one picture a page leads with. */
  tide?: boolean;
  /** The least room it takes, so the page doesn't jump as the picture plays. */
  minHeight?: number | string;
  /** Where its content sits when there's room to spare. */
  align?: 'start' | 'center' | 'end';
  /** No padding: the content brings its own frame. */
  bare?: boolean;
}

/**
 * A porcelain window for showing the product at work: real components,
 * playing a scripted moment. It's a picture, not a control — nothing in it
 * can be focused or is read out; the label says what it shows.
 */
export function Stage({
  label,
  bar,
  alive,
  tide,
  minHeight,
  align = 'center',
  bare,
  className,
  style,
  children,
  ...props
}: StageProps) {
  return (
    <figure
      aria-label={label}
      className={cx(styles.stage, className)}
      data-tide={tide || undefined}
      style={
        {
          '--stage-min': typeof minHeight === 'number' ? `${minHeight}px` : minHeight,
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      {tide && <span className={styles.tide} aria-hidden />}
      <div
        className={styles.window}
        data-lustre=""
        data-lustre-ambient={alive ? '' : undefined}
        data-align={align}
        data-bare={bare || undefined}
        inert
        aria-hidden
      >
        {bar != null && <div className={styles.bar}>{bar}</div>}
        <div className={styles.body}>{children}</div>
      </div>
    </figure>
  );
}
