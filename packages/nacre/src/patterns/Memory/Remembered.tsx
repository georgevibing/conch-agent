import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './Remembered.module.css';

export interface RememberedNoteProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The memory, in full: what it remembered, or what it forgot. */
  text: string;
  /**
   * `kept`: it stands (remembered, or put back); `undone`: you took it back;
   * `forgotten`: the assistant forgot it.
   */
  state: 'kept' | 'undone' | 'forgotten';
  /** Undo: forget what it remembered, or put back what it forgot. Left out when there's nothing to undo. */
  onUndo?: () => void;
  /** Undo is on its way. */
  busy?: boolean;
}

/**
 * What a step that remembered or forgot something said, in the chat's step
 * timeline (ADR 0103): the memory in full, in the reply's own type, with a
 * quiet Undo beside it, worded and placed like the step's Why?. It never asks
 * for anything; memory is the Memory page's (ADR 0097).
 */
export function RememberedNote({
  text,
  state,
  onUndo,
  busy = false,
  className,
  ...props
}: RememberedNoteProps) {
  return (
    <div className={cx(styles.note, className)} data-state={state} {...props}>
      <p className={styles.text}>
        {state === 'undone' ? <s>{text}</s> : text}
        {state === 'undone' && <span className="nc-visually-hidden"> (undone)</span>}
      </p>
      {onUndo && (
        <button
          type="button"
          className={styles.undo}
          aria-label={state === 'forgotten' ? `Undo forgetting “${text}”` : `Undo “${text}”`}
          aria-busy={busy || undefined}
          disabled={busy}
          onClick={onUndo}
        >
          Undo
        </button>
      )}
    </div>
  );
}
