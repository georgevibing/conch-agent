import { Keyboard, Mic, MicOff, X } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Pearl } from '../../components/Pearl';
import styles from './Voice.module.css';

export type TalkState = 'listening' | 'hearing' | 'thinking' | 'speaking' | 'paused' | 'error';

export interface TalkModeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: TalkState;
  /** Loudness, 0–1: the pearl swells with your voice, and with its own. */
  level?: number;
  /** What it heard you say, as you say it. */
  heard?: ReactNode;
  /** What it's saying back. */
  reply?: ReactNode;
  /** The assistant's name: "Talking with Pearl". */
  name?: string;
  /** Something stopped it: one sentence. */
  problem?: ReactNode;
  /** Tap the pearl: interrupt it while it speaks, or start listening again. */
  onPearl?: () => void;
  onMute?: () => void;
  /** Back to typing, in the same chat. */
  onKeyboard?: () => void;
  /** Speaking over it interrupts it (barge-in), so it says so while it speaks. */
  bargeIn?: boolean;
}

const STATES: Record<TalkState, string> = {
  listening: 'Listening…',
  hearing: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking… tap to interrupt',
  paused: 'Paused. Tap to talk.',
  error: 'Something stopped. Tap to try again.',
};

/**
 * Talking, hands free: the whole screen rests, the pearl listens, thinks and
 * speaks. You talk; it answers aloud and listens again. Talk over it (or tap
 * the pearl) to cut it short, Escape (or ×) to end, the keyboard to type instead.
 */
export function TalkMode({
  open,
  onOpenChange,
  state,
  level = 0,
  heard,
  reply,
  name = 'Conch',
  problem,
  onPearl,
  onMute,
  onKeyboard,
  bargeIn = false,
}: TalkModeProps) {
  const pearl =
    state === 'thinking'
      ? 'thinking'
      : state === 'speaking'
        ? 'streaming'
        : state === 'error'
          ? 'error'
          : 'idle';
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className={styles.talk}
          data-state={state}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <VisuallyHidden.Root asChild>
            <DialogPrimitive.Title>Talking with {name}</DialogPrimitive.Title>
          </VisuallyHidden.Root>
          <div className={styles.talkTop}>
            <DialogPrimitive.Close asChild>
              <IconButton label="End talking" shape="circle" variant="surface">
                <X />
              </IconButton>
            </DialogPrimitive.Close>
          </div>
          <div className={styles.talkCenter}>
            <button
              type="button"
              className={styles.orb}
              style={{ '--tm-level': Math.max(0, Math.min(1, level)) } as CSSProperties}
              onClick={onPearl}
              aria-label={
                state === 'speaking'
                  ? 'Interrupt'
                  : state === 'paused' || state === 'error'
                    ? 'Talk'
                    : 'Stop listening'
              }
            >
              <Pearl state={pearl} size="xl" label={null} />
            </button>
            <p className={styles.talkState} role="status" aria-live="polite">
              {problem ??
                (state === 'speaking' && bargeIn
                  ? 'Speaking… just talk to interrupt'
                  : STATES[state])}
            </p>
            {heard && <p className={styles.heard}>{heard}</p>}
            {reply && <p className={styles.reply}>{reply}</p>}
          </div>
          <div className={styles.talkBottom}>
            {onMute && (
              <Button
                variant="surface"
                leadingIcon={state === 'paused' ? <Mic /> : <MicOff />}
                onClick={onMute}
              >
                {state === 'paused' ? 'Listen' : 'Pause'}
              </Button>
            )}
            {onKeyboard && (
              <Button variant="ghost" leadingIcon={<Keyboard />} onClick={onKeyboard}>
                Type instead
              </Button>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
