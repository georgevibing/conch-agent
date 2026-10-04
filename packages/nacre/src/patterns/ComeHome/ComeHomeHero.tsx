import type { ComponentProps } from 'react';

import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import styles from './ComeHome.module.css';

export interface ComeHomeHeroProps extends ComponentProps<'header'> {
  /** The other assistant: "OpenClaw". */
  from: string;
  /** Its folder on this computer: `~/.openclaw`. */
  path: string;
  /** The heading; "Bring your things from OpenClaw" when left out. */
  title?: string;
}

/**
 * The top of Come home (ADR 0035): the other assistant's mark, a path of
 * light flowing to Conch's pearl, and one sentence of reassurance. It says
 * at a glance what's about to happen, and that nothing over there changes.
 */
export function ComeHomeHero({ from, path, title, className, ...props }: ComeHomeHeroProps) {
  return (
    <header className={cx(styles.hero, className)} {...props}>
      <div className={styles.journey} aria-hidden>
        <span className={styles.fromMark}>{from.trim().charAt(0).toUpperCase() || '?'}</span>
        <span className={styles.path}>
          <span className={styles.spark} />
          <span className={styles.spark} />
          <span className={styles.spark} />
        </span>
        <Pearl size="lg" label={null} className={styles.toMark} />
      </div>
      <div className={styles.heroText}>
        <h2 className={styles.heroTitle}>{title ?? `Bring your things from ${from}`}</h2>
        <p className={styles.heroNote}>
          From <code>{path}</code>. Nothing there changes, and you can undo it all.
        </p>
      </div>
    </header>
  );
}
