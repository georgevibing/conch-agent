import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import styles from './Learning.module.css';

/*
 * Quiet learning (ADR 0088, ADR 0097). Conch learns from your chats silently:
 * nothing is announced in the chat and nothing routine asks, so the only
 * thing left to show is what you told it never to learn again. A memory held
 * for a security reason is Memory's own `MemoryCheck` card.
 */

export interface NeverThing {
  id: string;
  text: string;
  /** “Taken back 3 days ago”. */
  when?: ReactNode;
}

export interface NeverListProps extends Omit<ComponentProps<'ul'>, 'children'> {
  items: NeverThing[];
  /** Let Conch learn it again. */
  onRemove?: (id: string) => void;
  busy?: string;
}

/** Things Conch won't learn again (ADR 0088): each one you took back, with Remove. */
export function NeverList({ items, onRemove, busy, className, ...props }: NeverListProps) {
  return (
    <ul
      aria-label="Things Conch won’t learn again"
      className={cx(styles.never, className)}
      {...props}
    >
      {items.map((item) => (
        <li key={item.id} className={styles.neverItem}>
          <span className={styles.neverText}>{item.text}</span>
          {item.when && <span className={styles.meta}>{item.when}</span>}
          {onRemove && (
            <Button
              size="sm"
              variant="ghost"
              tone="neutral"
              loading={busy === item.id}
              onClick={() => onRemove(item.id)}
              aria-label={`Let Conch learn “${item.text}” again`}
            >
              Remove
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
