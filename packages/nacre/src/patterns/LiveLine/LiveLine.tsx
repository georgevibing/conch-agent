import { useEffect, useRef, useState, type ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './LiveLine.module.css';

export type LiveLineSource = 'rule' | 'provider' | 'model';
export type LiveLineTone = 'default' | 'quiet' | 'warning';

export interface LiveLineProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** What's happening now: "Running the server tests", "Reading Transcript.tsx". */
  text: string;
  /**
   * Who wrote it. `provider` is the assistant's own narration ("Let me check
   * the tests first"), set in the serif italic the reasoning trail wears;
   * the rules' and a small model's words are plain.
   */
  source?: LiveLineSource;
  tone?: LiveLineTone;
  /** The light sweeping across the words, while the work goes on. Default on. */
  active?: boolean;
  /**
   * Changes closer together than this (ms) are coalesced: the line moves to
   * the newest text once, rather than flickering through them all.
   */
  throttle?: number;
  /**
   * Tell assistive tech, once the line has held still for a moment. Off when
   * something around it already says what's happening (a `Story` announces
   * its own start and end).
   */
  announce?: boolean;
}

/** How long the outgoing words take to leave before they're removed. */
const LEAVE_MS = 480;
/** How long the line must hold still before a screen reader hears it. */
const SETTLE_MS = 1500;

/**
 * One line that says what's happening now, and changes in place: the old
 * words drift up and blur away as the new ones rise in. Its height is
 * reserved, so nothing below it moves; changes that come faster than the eye
 * can read are coalesced into one; a band of light sweeps across while the
 * work goes on. Polite to screen readers: it speaks only when it settles.
 */
export function LiveLine({
  text,
  source = 'rule',
  tone = 'default',
  active = true,
  throttle = 600,
  announce = true,
  className,
  ...props
}: LiveLineProps) {
  const [shown, setShown] = useState({ text, prev: undefined as string | undefined, n: 0 });
  const lastChange = useRef<number | undefined>(undefined);

  useEffect(() => {
    lastChange.current ??= Date.now();
  }, []);

  // Coalesce: each new text replaces the waiting one, and the line moves no
  // sooner than `throttle` after its last move.
  useEffect(() => {
    if (text === shown.text) return;
    const since = Date.now() - (lastChange.current ?? 0);
    const id = setTimeout(
      () => {
        lastChange.current = Date.now();
        setShown((s) => ({ text, prev: s.text, n: s.n + 1 }));
      },
      Math.max(0, throttle - since),
    );
    return () => clearTimeout(id);
  }, [text, shown.text, throttle]);

  useEffect(() => {
    if (shown.prev === undefined) return;
    const id = setTimeout(() => setShown((s) => ({ ...s, prev: undefined })), LEAVE_MS);
    return () => clearTimeout(id);
  }, [shown.prev, shown.n]);

  // What's there when it mounts is read as content; only later changes are announced.
  const [said, setSaid] = useState(text);
  useEffect(() => {
    if (!announce) return;
    const id = setTimeout(() => setSaid(shown.text), SETTLE_MS);
    return () => clearTimeout(id);
  }, [announce, shown.text]);

  return (
    <div
      className={cx(styles.line, className)}
      data-source={source}
      data-tone={tone}
      data-active={active || undefined}
      {...props}
    >
      {shown.prev !== undefined && (
        <span key={`out${shown.n}`} className={styles.text} data-leaving="" aria-hidden>
          {shown.prev}
        </span>
      )}
      <span
        key={`in${shown.n}`}
        className={styles.text}
        data-entering={shown.n > 0 || undefined}
        aria-hidden={announce || undefined}
      >
        {shown.text}
      </span>
      {announce && (
        <span className="nc-visually-hidden" aria-live="polite">
          {said}
        </span>
      )}
    </div>
  );
}
