import { useEffect, useState, type CSSProperties } from 'react';

import { cx } from '../../utils/cx';
import styles from './Story.module.css';

export interface MorphTextProps {
  text: string;
  /** Play the change. Off, a new text is simply there (history, reduced motion is CSS's job). */
  animate?: boolean;
  className?: string;
}

/** How long the change takes in the CSS (the last new word lands by 345ms), with a frame to spare. */
const LEAVE_MS = 360;

/** The words, and the spaces between them. */
const split = (text: string) => text.split(/(\s+)/).filter(Boolean);
const isSpace = (w: string) => !/\S/.test(w);

/**
 * A line whose words change in place: the words before the change stay still,
 * the rest rise out of the line and fade, and the new ones rise into it a beat
 * later, one after another, all clipped to the same box, so the two never
 * overlap and nothing around it moves. 350ms in all. For a headline that the
 * rules wrote and a small model rewrote, or "Running" turning into "Ran".
 */
export function MorphText({ text, animate = true, className }: MorphTextProps) {
  const [state, setState] = useState({ text, prev: undefined as string | undefined, n: 0 });
  // Derived from the prop during render (React's "storing information from
  // previous renders"), so the new words and the leaving ones paint together.
  if (state.text !== text) {
    setState({ text, prev: animate ? state.text : undefined, n: state.n + 1 });
  }
  const { prev, n } = state;
  useEffect(() => {
    if (prev === undefined) return;
    const id = setTimeout(() => setState((s) => ({ ...s, prev: undefined })), LEAVE_MS);
    return () => clearTimeout(id);
  }, [prev, n]);

  const words = split(state.text);
  const before = prev === undefined ? undefined : split(prev);
  // Only the words before the first change hold still: from there on everything
  // has moved, so it all crossfades rather than jumping sideways.
  let same = 0;
  if (before) while (same < words.length && words[same] === before[same]) same++;
  let fresh = 0;
  return (
    <span className={cx(styles.morph, className)}>
      {before && (
        <span key={`out${n}`} className={styles.morphOut} aria-hidden>
          {before.map((w, i) =>
            isSpace(w) ? (
              w
            ) : (
              <span key={i} data-same={i < same || undefined}>
                {w}
              </span>
            ),
          )}
        </span>
      )}
      <span key={`in${n}`} className={styles.morphIn}>
        {words.map((w, i) => {
          // Spaces stay text between the words, so assistive tech reads one line.
          if (isSpace(w)) return w;
          const changed = before !== undefined && i >= same;
          return (
            <span
              key={i}
              data-fresh={changed || undefined}
              style={changed ? ({ '--i': fresh++ } as CSSProperties) : undefined}
            >
              {w}
            </span>
          );
        })}
      </span>
    </span>
  );
}
