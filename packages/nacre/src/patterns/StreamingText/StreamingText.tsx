import { useState, type ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './StreamingText.module.css';

export interface StreamingTextProps extends Omit<ComponentProps<'span'>, 'children' | 'ref'> {
  /** The full text received so far. Append to it as chunks arrive. */
  text: string;
  /** Show the pearl caret at the end while more text is expected. */
  streaming?: boolean;
  as?: 'span' | 'p' | 'div';
}

interface Segment {
  id: number;
  text: string;
  /** Settled segments are merged and no longer animate. */
  settled?: boolean;
}

interface State {
  text: string;
  segments: Segment[];
  nextId: number;
}

/** Keep the DOM small on long streams: merge all but the freshest chunks. */
const LIVE_SEGMENTS = 24;

function advance(prev: State, text: string): State {
  if (!text.startsWith(prev.text) || prev.text === '') {
    // Replaced (or first render): show everything at once, no animation.
    return {
      text,
      segments: text ? [{ id: prev.nextId, text, settled: true }] : [],
      nextId: prev.nextId + 1,
    };
  }
  const delta = text.slice(prev.text.length);
  let segments = [...prev.segments, { id: prev.nextId, text: delta }];
  if (segments.length > LIVE_SEGMENTS * 2) {
    const cut = segments.length - LIVE_SEGMENTS;
    const merged = segments
      .slice(0, cut)
      .map((s) => s.text)
      .join('');
    segments = [{ id: segments[0]?.id ?? 0, text: merged, settled: true }, ...segments.slice(cut)];
  }
  return { text, segments, nextId: prev.nextId + 1 };
}

/**
 * Renders text that arrives incrementally. Each new chunk surfaces with a
 * brief fade + de-blur so streaming feels fluid rather than jittery. Motion
 * collapses to an instant reveal under reduced-motion.
 */
export function StreamingText({
  text,
  streaming = false,
  as: Comp = 'span',
  className,
  ...props
}: StreamingTextProps) {
  const [state, setState] = useState<State>(() =>
    advance({ text: '', segments: [], nextId: 0 }, text),
  );
  // Derive segments during render (React's "adjust state on prop change").
  let current = state;
  if (text !== state.text) {
    current = advance(state, text);
    setState(current);
  }

  return (
    <Comp data-streaming={streaming || undefined} className={cx(styles.root, className)} {...props}>
      {current.segments.map((segment) => (
        <span key={segment.id} className={segment.settled ? undefined : styles.chunk}>
          {segment.text}
        </span>
      ))}
      {streaming && <span className={styles.caret} aria-hidden />}
    </Comp>
  );
}
