import { Eraser } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import styles from './SummaryDivider.module.css';

export interface ClearedDividerProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Who forgets: the assistant's name ("Conch"). */
  name?: ReactNode;
  /** Put the conversation back in its memory. Offered only while nothing new was sent. */
  onUndo?: () => void;
  /** Undo is on its way. */
  undoing?: boolean;
}

/**
 * Where `/clear` happened: a quiet line in the chat, the same kind as the
 * summary's. Everything above stays for the person; the assistant reads none
 * of it from here on, whichever provider answers. Until something new is
 * sent, **Undo** puts it back.
 */
export function ClearedDivider({
  name,
  onUndo,
  undoing = false,
  className,
  ...props
}: ClearedDividerProps) {
  return (
    <div role="note" className={cx(styles.root, className)} {...props}>
      <div className={styles.rule}>
        <span className={styles.line} aria-hidden />
        <span className={styles.static}>
          <Eraser aria-hidden className={styles.icon} />
          <span>Context cleared: {name ?? 'the assistant'} starts fresh from here</span>
          {onUndo && (
            <Button
              size="sm"
              variant="ghost"
              className={styles.undo}
              loading={undoing}
              onClick={onUndo}
              aria-label="Undo clearing the context"
            >
              Undo
            </Button>
          )}
        </span>
        <span className={styles.line} aria-hidden />
      </div>
    </div>
  );
}
