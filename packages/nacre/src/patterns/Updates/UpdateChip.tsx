import type { ComponentProps, CSSProperties } from 'react';

import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import styles from './UpdateChip.module.css';

export type UpdateChipState =
  /** An update is ready: one press shows what it brings. */
  | 'ready'
  /** Updating now: a small ring says how far. */
  | 'updating'
  /** It's in: a restart finishes it. */
  | 'restart';

export interface UpdateChipProps extends Omit<ComponentProps<'button'>, 'children'> {
  state: UpdateChipState;
  /** 0–100 while updating; omit when it can't be known. */
  value?: number;
  /** The words on it; short ("Update", "Updating", "Restart"). */
  children?: string;
}

const WORDS: Record<UpdateChipState, string> = {
  ready: 'Update',
  updating: 'Updating',
  restart: 'Restart',
};

/**
 * A new Conch, one press away, where you always look: beside your name at
 * the foot of the sidebar. Quiet while it waits, a small ring of nacre while
 * it updates. It opens the update dialog; it never updates by itself.
 */
export function UpdateChip({
  state,
  value,
  children,
  className,
  style,
  ...props
}: UpdateChipProps) {
  const known = state === 'updating' && value !== undefined;
  return (
    <button
      type="button"
      data-state={state}
      data-indeterminate={state === 'updating' && !known ? '' : undefined}
      className={cx(styles.chip, className)}
      style={
        {
          ...style,
          '--uc-value': known ? Math.max(0, Math.min(100, value)) : 25,
        } as CSSProperties
      }
      {...props}
    >
      <span aria-hidden className={styles.mark}>
        {state === 'updating' && <span className={styles.ring} />}
        <Pearl size="xs" state={state === 'updating' ? 'thinking' : 'idle'} label={null} />
      </span>
      <span className={styles.words}>{children ?? WORDS[state]}</span>
    </button>
  );
}
