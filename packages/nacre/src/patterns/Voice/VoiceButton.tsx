import { Mic, Square } from 'lucide-react';
import type { CSSProperties } from 'react';

import { IconButton, type IconButtonProps } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import styles from './Voice.module.css';

export type VoiceButtonState = 'idle' | 'listening' | 'working';

export interface VoiceButtonProps extends Omit<IconButtonProps, 'children' | 'label'> {
  state?: VoiceButtonState;
  /** Loudness, 0–1, while listening: a soft ring that follows your voice. */
  level?: number;
  label?: string;
}

/**
 * Dictation in the composer: press, speak, press again (or Escape). While it
 * listens, a ring breathes with your voice; while the words are being made,
 * it rests on a spinner. The state is in its name, never in colour alone.
 */
export function VoiceButton({
  state = 'idle',
  level = 0,
  label,
  className,
  ...props
}: VoiceButtonProps) {
  const name =
    label ??
    (state === 'listening'
      ? 'Stop dictation'
      : state === 'working'
        ? 'Writing down what you said'
        : 'Dictate');
  return (
    <IconButton
      label={name}
      shape="circle"
      variant={state === 'listening' ? 'solid' : 'ghost'}
      loading={state === 'working'}
      aria-pressed={state === 'listening'}
      data-state={state}
      className={cx(styles.voiceButton, className)}
      style={{ '--vb-level': Math.max(0, Math.min(1, level)) } as CSSProperties}
      {...props}
    >
      {state === 'listening' ? <Square /> : <Mic />}
    </IconButton>
  );
}
