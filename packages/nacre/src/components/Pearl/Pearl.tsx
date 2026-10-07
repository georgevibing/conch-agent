import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './Pearl.module.css';

export type PearlState = 'idle' | 'thinking' | 'streaming' | 'attention' | 'error';
export type PearlSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface PearlProps extends Omit<ComponentProps<'span'>, 'children'> {
  state?: PearlState;
  size?: PearlSize;
  /**
   * Accessible status text. Defaults to a label for the state; pass `null`
   * when surrounding text already announces what the agent is doing.
   */
  label?: string | null;
  /**
   * One bright turn of light across the pearl, for a moment worth a smile
   * (something finished). It plays each time this becomes true.
   */
  glint?: boolean;
}

const defaultLabels: Record<PearlState, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  streaming: 'Responding',
  attention: 'Needs you',
  error: 'Something went wrong',
};

/**
 * The Pearl — Nacre's signature mark for an agent's presence.
 *
 * A small luminous sphere of mother-of-pearl: two counter-rotating films of
 * iridescence drift over a softly shaded body, lit by a fixed specular
 * highlight. It rests when idle, breathes while thinking, quickens and glows
 * while streaming, warms to amber and sways when it needs you, and dims to a
 * still, tinted stone on error.
 */
export function Pearl({
  state = 'idle',
  size = 'md',
  label,
  glint,
  className,
  ...props
}: PearlProps) {
  const text = label === undefined ? defaultLabels[state] : label;
  return (
    <span
      role={text ? 'status' : undefined}
      aria-label={text ?? undefined}
      aria-hidden={text ? undefined : true}
      data-state={state}
      data-size={size}
      data-glint={glint || undefined}
      className={cx(styles.pearl, className)}
      {...props}
    >
      <span className={styles.halo} aria-hidden />
      <span className={styles.core} aria-hidden>
        <span className={styles.body} />
        <span className={styles.film} />
        <span className={styles.swirl} />
        <span className={styles.specular} />
        <span className={styles.sheen} />
      </span>
    </span>
  );
}
