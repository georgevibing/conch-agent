import type { ComponentProps } from 'react';

import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import styles from './RestartScreen.module.css';

export interface RestartScreenProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** "Updating Conch", "Restarting Conch". */
  title: string;
  /** One reassuring line: "This takes a few seconds. Your chats are safe." */
  detail?: string;
  /** Taking longer than it should: say what to do, calmly. */
  slow?: string;
}

/**
 * While Conch starts itself again (after an update or a restore): the whole
 * window rests, the pearl breathes, and the page comes back by itself when
 * Conch does. Nothing to press, nothing to worry about.
 */
export function RestartScreen({ title, detail, slow, className, ...props }: RestartScreenProps) {
  return (
    <div className={cx(styles.screen, className)} role="status" aria-live="polite" {...props}>
      <div className={styles.center}>
        <Pearl state="thinking" size="lg" label={null} />
        <p className={styles.title}>{title}</p>
        {detail && <p className={styles.detail}>{detail}</p>}
        {slow && <p className={styles.slow}>{slow}</p>}
      </div>
    </div>
  );
}
