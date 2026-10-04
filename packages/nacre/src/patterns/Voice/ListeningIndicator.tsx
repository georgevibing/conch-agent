import { Mic } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import styles from './Voice.module.css';

export interface ListeningIndicatorProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** What it's listening for: “Hey Conch”. */
  phrase: string;
  /** Hearing something right now: the dot glows. */
  hearing?: boolean;
  onStop: () => void;
}

/**
 * Says, wherever you are, that the microphone is listening for the wake
 * phrase (ADR 0078), with one press to stop. Always in words, never only a
 * light: it's there for as long as the microphone is.
 */
export function ListeningIndicator({
  phrase,
  hearing = false,
  onStop,
  className,
  ...props
}: ListeningIndicatorProps) {
  return (
    <div
      role="status"
      className={cx(styles.listening, className)}
      data-hearing={hearing || undefined}
      {...props}
    >
      <span className={styles.listeningDot} aria-hidden>
        <Mic />
      </span>
      <span className={styles.listeningText}>Listening for {phrase}</span>
      <Button size="sm" variant="ghost" onClick={onStop}>
        Stop
      </Button>
    </div>
  );
}
