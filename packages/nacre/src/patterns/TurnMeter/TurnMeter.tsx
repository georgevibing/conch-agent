import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import { tokensShort } from '../ContextMeter/ContextMeter';
import { useNow } from '../Story/format';
import { Odometer, useCountUp } from '../ThinkingIndicator/Odometer';
import { formatElapsed, formatWorked, tokensLive } from '../ThinkingIndicator/ThinkingIndicator';
import { formatMoney } from '../Usage/format';
import styles from './TurnMeter.module.css';

export interface TurnMeterProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Epoch ms the turn began: the clock ticks from here while it runs. */
  startedAt?: number;
  /** How long it took, once it's over (or so far, without `startedAt`). */
  durationMs?: number;
  /** Tool calls so far. */
  steps: number;
  /** What it has cost, in USD, when the provider charges money. */
  costUsd?: number;
  /** What it has written. */
  tokens?: number;
  running: boolean;
  locale?: string;
}

const nbsp = (s: string) => s.replace(/ /g, '\u00a0');

/**
 * A quiet tally for a turn: how long, how many steps, what it cost, what it
 * wrote — "1m 04s · 12 steps · $0.04 · 41.2k tokens". While it runs the
 * clock ticks and the counts roll on their wheels; once it's over it's a
 * still line. Never loud, never a dashboard.
 */
export function TurnMeter({
  startedAt,
  durationMs,
  steps,
  costUsd,
  tokens,
  running,
  locale = 'en-US',
  className,
  ...props
}: TurnMeterProps) {
  const now = useNow(running && startedAt !== undefined);
  const elapsed = running && startedAt !== undefined ? Math.max(0, now - startedAt) : durationMs;
  const written = useCountUp(tokens ?? 0);

  const time =
    elapsed === undefined ? undefined : running ? formatElapsed(elapsed) : formatWorked(elapsed);
  const stepWord = steps === 1 ? 'step' : 'steps';
  const cost = costUsd === undefined ? undefined : formatMoney(costUsd, 'USD', locale);
  const tokenText = tokens ? (running ? tokensLive(written) : tokensShort(tokens)) : undefined;

  // Said once, plainly; the ticking stays out of the screen reader's way.
  const spoken = [
    running ? 'Working' : 'Worked',
    time && `for ${time}`,
    `${steps} ${stepWord}`,
    cost && `cost ${cost}`,
    tokens ? `${tokensShort(tokens)} tokens written` : undefined,
  ]
    .filter(Boolean)
    .join(', ');

  const parts = [
    time !== undefined && (
      <span key="time" className={styles.part}>
        {running ? <Odometer value={nbsp(time)} /> : nbsp(time)}
      </span>
    ),
    <span key="steps" className={styles.part}>
      {running ? <Odometer value={String(steps)} /> : steps}
      {' '}
      {stepWord}
    </span>,
    cost !== undefined && (
      <span key="cost" className={styles.part}>
        {cost}
      </span>
    ),
    tokenText !== undefined && (
      <span key="tokens" className={styles.part}>
        {running ? <Odometer value={tokenText} /> : tokenText}
        {' '}tokens
      </span>
    ),
  ].filter(Boolean);

  return (
    <div
      role="group"
      aria-label={spoken}
      className={cx(styles.meter, className)}
      data-running={running || undefined}
      {...props}
    >
      <span className={styles.pulse} aria-hidden />
      <span className={styles.parts} aria-hidden>
        {parts.map((part, i) => (
          <span key={i} className={styles.slot}>
            {i > 0 && <span className={styles.sep}>·</span>}
            {part}
          </span>
        ))}
      </span>
    </div>
  );
}
