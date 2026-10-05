import { useEffect, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import styles from './ChatList.module.css';

export interface SelectionBarProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** How many chats are ticked. */
  count: number;
  /** What can be done with them, supplied by the app: Pin, Move to…, Archive, Delete. */
  children?: ReactNode;
  /** Stop choosing. Escape does it too. */
  onDone: () => void;
}

/** Escape inside these belongs to them (a menu closing, a dialog), not to the bar. */
const OWN_ESCAPE =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],input,textarea';

/**
 * The bar at the foot of the list while choosing several chats: how many
 * are ticked (read out as it changes), what can be done with them, and
 * Done. It rises into place, and Escape puts it away.
 */
export function SelectionBar({ count, children, onDone, className, ...props }: SelectionBarProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest(OWN_ESCAPE)) return;
      onDone();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDone]);

  return (
    <div
      role="group"
      aria-label="Chosen chats"
      className={cx(styles.selectionBar, className)}
      {...props}
    >
      <span className={styles.selectionCount} aria-live="polite">
        {count === 0 ? 'Choose chats' : `${count} selected`}
      </span>
      {children && <div className={styles.selectionActions}>{children}</div>}
      <Button size="sm" variant="ghost" onClick={onDone} className={styles.selectionDone}>
        Done
      </Button>
    </div>
  );
}
