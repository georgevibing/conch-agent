import { useReducedMotionConfig } from 'motion/react';
import { Toolbar } from 'radix-ui';
import { useEffect, useRef, useState, type ComponentProps, type CSSProperties } from 'react';

import { cx } from '../../utils/cx';
import styles from './ReplyChips.module.css';

export interface ReplyChip {
  /** The words on the chip, and exactly the words sent. */
  text: string;
}

export interface ReplyChipsProps extends Omit<ComponentProps<'div'>, 'children' | 'dir'> {
  /** Up to three; more are left out. */
  replies: readonly ReplyChip[];
  /** Send these words, as the composer would. */
  onSend: (text: string) => void;
  /** What the group is called for screen readers. */
  label?: string;
  /** Rise in one after another as the reply finishes (off for a chat opened from history). */
  entrance?: boolean;
  /** Show it as sent (pressed already): the one sent stays lit, the rest have gone. */
  sent?: string;
}

/** How long a pressed chip stays lit before its words go: a beat, so the tap is felt. */
const SEND_BEAT_MS = 180;

/**
 * Replies to send next, under the latest reply: up to three quiet chips, each
 * holding exactly the words it sends, so nothing hides behind a label. They
 * rise in one after another once the reply is done, sit back from the reply
 * in tone, and wrap onto as many lines as a narrow screen needs. One tab stop
 * for the group; arrow keys move between chips. Pressing one lights it for a
 * beat and fades the rest, then sends it.
 */
export function ReplyChips({
  replies,
  onSend,
  label = 'Replies to send',
  entrance = true,
  sent: sentProp,
  className,
  ...props
}: ReplyChipsProps) {
  const reduced = useReducedMotionConfig() === true;
  const [pressed, setPressed] = useState<string>();
  const sent = sentProp ?? pressed;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const shown = replies.slice(0, 3);
  if (!shown.length) return null;

  const press = (text: string) => {
    if (sent !== undefined) return;
    setPressed(text);
    if (reduced) onSend(text);
    else timer.current = setTimeout(() => onSend(text), SEND_BEAT_MS);
  };

  return (
    <Toolbar.Root
      aria-label={label}
      orientation="horizontal"
      loop
      data-entrance={entrance ? undefined : 'none'}
      data-state={sent === undefined ? 'open' : 'sent'}
      aria-busy={sent !== undefined || undefined}
      className={cx(styles.chips, className)}
      {...props}
    >
      {shown.map((reply, index) => {
        const isSent = sent === reply.text;
        return (
          <Toolbar.Button
            key={reply.text}
            type="button"
            data-lustre
            data-sent={isSent || undefined}
            aria-disabled={sent !== undefined || undefined}
            // Gone from view once another was sent: not for pointers or keys either.
            tabIndex={sent !== undefined && !isSent ? -1 : undefined}
            className={styles.chip}
            style={{ '--rc-i': index } as CSSProperties}
            onClick={() => press(reply.text)}
          >
            {reply.text}
          </Toolbar.Button>
        );
      })}
    </Toolbar.Root>
  );
}
