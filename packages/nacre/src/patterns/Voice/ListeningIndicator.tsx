import { Mic, MicOff } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import styles from './Voice.module.css';

export interface ListeningIndicatorProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** What it's listening for: “Hey Conch”. */
  phrase: string;
  /** Hearing something right now: the dot glows. */
  hearing?: boolean;
  /**
   * It stopped by itself to save the battery (a phone, ADR 0108): the
   * microphone is off, and one press listens again.
   */
  paused?: boolean;
  onResume?: () => void;
  onStop: () => void;
}

/**
 * Says, wherever you are, that the microphone is listening for the wake
 * phrase (ADR 0078), with one press to stop. Always in words, never only a
 * light: it's there for as long as the microphone is. On a phone it stops by
 * itself after a while, says so, and listens again with one press.
 */
export function ListeningIndicator({
  phrase,
  hearing = false,
  paused = false,
  onResume,
  onStop,
  className,
  ...props
}: ListeningIndicatorProps) {
  return (
    <div
      role="status"
      className={cx(styles.listening, className)}
      data-hearing={(hearing && !paused) || undefined}
      data-paused={paused || undefined}
      {...props}
    >
      <span className={styles.listeningDot} aria-hidden>
        {paused ? <MicOff /> : <Mic />}
      </span>
      <span className={styles.listeningText}>
        {paused ? `Stopped listening for ${phrase}` : `Listening for ${phrase}`}
      </span>
      {paused && onResume ? (
        <Button size="sm" variant="ghost" onClick={onResume}>
          Listen again
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={onStop}>
          Stop
        </Button>
      )}
    </div>
  );
}
