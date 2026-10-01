import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './DocsHero.module.css';

export interface DocsHeroProps extends Omit<ComponentProps<'header'>, 'title'> {
  /** A small line above the title: a version, a mark. */
  eyebrow?: ReactNode;
  /** The one sentence, in the display serif. */
  title: ReactNode;
  /** What it is, in a breath. */
  lede?: ReactNode;
  /** The first thing to do: a command to copy, a button. */
  actions?: ReactNode;
  /** The thing itself, shown beside the words (and under them when narrow). */
  media?: ReactNode;
}

/**
 * The opening of a set of pages: one sentence in the display serif, what to
 * do first, and the thing itself beside it. Each part surfaces in turn, once;
 * behind the picture a slow tide of pearl light is the only thing that keeps
 * moving.
 */
export function DocsHero({
  eyebrow,
  title,
  lede,
  actions,
  media,
  className,
  ...props
}: DocsHeroProps) {
  return (
    <header className={cx(styles.hero, className)} {...props}>
      {/* The header is the container; the layout inside it answers to its width. */}
      <div className={styles.layout} data-media={media != null || undefined}>
        <div className={styles.words}>
          {eyebrow != null && <div className={styles.eyebrow}>{eyebrow}</div>}
          <h1 className={styles.title}>{title}</h1>
          {lede != null && <p className={styles.lede}>{lede}</p>}
          {actions != null && <div className={styles.actions}>{actions}</div>}
        </div>
        {media != null && (
          <div className={styles.media}>
            <span className={styles.tide} aria-hidden />
            {media}
          </div>
        )}
      </div>
    </header>
  );
}
