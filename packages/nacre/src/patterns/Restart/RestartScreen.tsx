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
  /**
   * `waiting` (the default): Conch is on its way back, the pearl breathes.
   * `stopped`: Conch was quit on purpose, the pearl rests; the page still
   * comes back by itself when Conch is opened again.
   */
  state?: 'waiting' | 'stopped';
}

/**
 * While Conch starts itself again (after an update or a restore): the whole
 * window rests, the pearl breathes, and the page comes back by itself when
 * Conch does. Nothing to press, nothing to worry about.
 */
export function RestartScreen({
  title,
  detail,
  slow,
  state = 'waiting',
  className,
  ...props
}: RestartScreenProps) {
  return (
    <div
      className={cx(styles.screen, className)}
      role="status"
      aria-live="polite"
      data-state={state}
      {...props}
    >
      <div className={styles.center}>
        <Pearl state={state === 'stopped' ? 'idle' : 'thinking'} size="lg" label={null} />
        <p className={styles.title}>{title}</p>
        {detail && <p className={styles.detail}>{detail}</p>}
        {slow && <p className={styles.slow}>{slow}</p>}
      </div>
    </div>
  );
}
