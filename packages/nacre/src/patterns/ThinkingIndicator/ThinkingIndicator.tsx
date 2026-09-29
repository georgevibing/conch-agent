import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './ThinkingIndicator.module.css';

export interface ThinkingIndicatorProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** What the agent is doing, e.g. "Thinking", "Reading 3 files". */
  label?: ReactNode;
  /** Optional secondary detail shown after the label. */
  detail?: ReactNode;
  /** Epoch ms when work started — renders a live elapsed timer. */
  startedAt?: number;
  size?: 'sm' | 'md';
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

function useNow(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

/**
 * "Claude is thinking…" — a luminous iridescent orb and a label with a slow
 * pearl shimmer. Announced politely to assistive tech.
 */
export function ThinkingIndicator({
  label = 'Thinking',
  detail,
  startedAt,
  size = 'md',
  className,
  ...props
}: ThinkingIndicatorProps) {
  const now = useNow(startedAt !== undefined);
  return (
    <div
      role="status"
      aria-live="polite"
      data-size={size}
      className={cx(styles.root, className)}
      {...props}
    >
      <span className={styles.orb} aria-hidden>
        <span className={styles.core} />
      </span>
      <span className={styles.label}>{label}</span>
      {detail != null && <span className={styles.detail}>{detail}</span>}
      {startedAt !== undefined && (
        <span className={styles.elapsed} aria-hidden>
          {formatElapsed(now - startedAt)}
        </span>
      )}
    </div>
  );
}
