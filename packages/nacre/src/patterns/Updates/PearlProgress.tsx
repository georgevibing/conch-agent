import type { ComponentProps } from 'react';

import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import styles from './PearlProgress.module.css';

export type PearlProgressState =
  /** Waiting to be asked: the pearl rests, no ring. */
  | 'resting'
  /** Working: the ring fills with `value`, or turns when it can't be known. */
  | 'working'
  /** Starting again: the ring is whole and ripples spread from it. */
  | 'restarting'
  /** Arrived: the ring closes and blooms once. */
  | 'done'
  /** Didn't work: a still, tinted stone. */
  | 'failed';

export interface PearlProgressProps extends Omit<ComponentProps<'span'>, 'children'> {
  state?: PearlProgressState;
  /** 0–100; omit while working when it can't be known. */
  value?: number;
  size?: 'md' | 'lg';
}

/**
 * The pearl inside a ring of nacre: how far Conch's own update has come.
 * The ring is drawn in the pearl's own iridescence, so the update reads as
 * the pearl growing a new layer, not as a loading bar. Decorative: the words
 * beside it say where things stand.
 */
export function PearlProgress({
  state = 'resting',
  value,
  size = 'lg',
  className,
  style,
  ...props
}: PearlProgressProps) {
  const known = value !== undefined && state === 'working';
  const filled = state === 'restarting' || state === 'done' ? 100 : known ? value : 0;
  return (
    <span
      aria-hidden
      data-state={state}
      data-size={size}
      data-indeterminate={state === 'working' && !known ? '' : undefined}
      className={cx(styles.root, className)}
      style={{ ...style, ['--pp-value' as string]: Math.max(0, Math.min(100, filled ?? 0)) }}
      {...props}
    >
      <span className={styles.ripple} />
      <span className={styles.ripple} />
      <span className={styles.ripple} />
      <span className={styles.bloom} />
      <span className={styles.track} />
      <span className={styles.arc} />
      <span className={styles.pearl}>
        <Pearl
          size={size === 'lg' ? 'xl' : 'lg'}
          state={state === 'failed' ? 'error' : state === 'resting' ? 'idle' : 'thinking'}
          label={null}
        />
      </span>
    </span>
  );
}
