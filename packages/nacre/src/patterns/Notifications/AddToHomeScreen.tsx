import { Share, SquarePlus } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import styles from './Notifications.module.css';

export interface AddToHomeScreenProps extends ComponentProps<'ol'> {
  /** What it's called on the Home Screen. */
  name?: string;
}

/**
 * The three taps that put Conch on an iPhone's Home Screen, drawn the way
 * Safari shows them: Share, then Add to Home Screen, then open it from there.
 */
export function AddToHomeScreen({ name = 'Conch', className, ...props }: AddToHomeScreenProps) {
  return (
    <ol
      className={cx(styles.steps, className)}
      aria-label="Add Conch to your Home Screen"
      {...props}
    >
      <li>
        <span className={styles.glyph} aria-hidden>
          <Share />
        </span>
        <span>
          Tap <strong>Share</strong> in Safari’s toolbar.
        </span>
      </li>
      <li>
        <span className={styles.glyph} aria-hidden>
          <SquarePlus />
        </span>
        <span>
          Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
        </span>
      </li>
      <li>
        <span className={styles.glyph} data-app aria-hidden>
          <Pearl size="sm" label={null} />
        </span>
        <span>
          Open <strong>{name}</strong> from your Home Screen and come back here.
        </span>
      </li>
    </ol>
  );
}
