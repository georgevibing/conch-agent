import { Archive } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import styles from './ChatList.module.css';

export interface TidyCardProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** How many chats haven't been opened in a while. */
  count: number;
  /** How long “a while” is, in days. */
  days: number;
  /** Archive them all (the app can offer Undo). */
  onTidy: () => void;
  /** Not now: the app decides when to ask again. */
  onDismiss: () => void;
}

/** “a month” for 30 days, otherwise the days themselves. */
export function tidySpan(days: number): string {
  if (days === 30) return 'a month';
  if (days === 7) return 'a week';
  if (days === 1) return 'a day';
  return `${days} days`;
}

/**
 * A quiet offer at the end of the list to put away chats you haven't opened
 * in a while. Never a warning, never a badge: it only says what it saw, and
 * Not now means not now.
 */
export function TidyCard({ count, days, onTidy, onDismiss, className, ...props }: TidyCardProps) {
  return (
    <div role="group" aria-label="Tidy up" className={cx(styles.tidy, className)} {...props}>
      <p className={styles.tidyText}>
        <Archive aria-hidden className={styles.tidyIcon} />
        <span>
          {count} {count === 1 ? 'chat' : 'chats'} you haven’t opened in {tidySpan(days)}
        </span>
      </p>
      <div className={styles.tidyActions}>
        <Button size="sm" variant="soft" onClick={onTidy}>
          {count === 1 ? 'Archive it' : 'Archive them'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Not now
        </Button>
      </div>
    </div>
  );
}
