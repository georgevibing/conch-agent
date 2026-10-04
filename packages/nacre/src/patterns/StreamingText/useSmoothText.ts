import { useReducedMotionConfig } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface SmoothText {
  /** The part of the text revealed so far — always ends on a word boundary while streaming. */
  text: string;
  /**
   * Offset where "fresh" words begin: everything at or after it was revealed in
   * the last `freshMs` and is still settling in. `null` when nothing animates.
   */
  freshFrom: number | null;
  /** This text has animated (it arrived live rather than from history). */
  live: boolean;
  /**
   * When the word at `offset` was revealed (`performance.now()` time), or
   * undefined for text that was never revealed live. Stable for a word, so
   * `revealWords` can stamp it on the word's element and `useSettleOnce` can
   * carry a remounted word's settle on from where it was.
   */
  revealedAt: (offset: number) => number | undefined;
}

export interface SmoothTextOptions {
  /** More text is still arriving. */
  streaming: boolean;
  /** How long a revealed word counts as fresh (must outlast the CSS reveal). */
  freshMs?: number;
}

/** Text already present when a stream mounts is revealed (not dumped) if shorter than this. */
const REVEAL_ON_MOUNT = 600;

/** Index just past the whole word at `index`, including the spaces after it. */
export function wordEnd(text: string, index: number): number {
  let i = index;
  while (i < text.length && !/\s/.test(text.charAt(i))) i++;
  while (i < text.length && /\s/.test(text.charAt(i))) i++;
  return i;
}

/** Characters per second: proportional to the backlog so the reveal never lags far behind. */
export function revealSpeed(backlog: number, streaming: boolean): number {
  return streaming ? Math.min(1200, Math.max(40, backlog / 0.8)) : Math.max(180, backlog / 0.35);
}

interface State {
  shown: string;
  freshFrom: number | null;
  live: boolean;
}

/**
 * Turns bursty network deltas into an even, word-by-word flow.
 *
 * Models stream in clumps — twenty words, a pause, three words — and painting
 * each clump as it lands reads as stutter. This paces the reveal on animation
 * frames at a speed proportional to the backlog, only ever releases whole
 * words, and reports which words are fresh so the renderer can let them settle
 * in. Under reduced motion (or without rAF) everything shows at once.
 */
export function useSmoothText(
  target: string,
  { streaming, freshMs = 700 }: SmoothTextOptions,
): SmoothText {
  const reduced = useReducedMotionConfig() === true;
  const canAnimate = !reduced && typeof requestAnimationFrame === 'function';

  const [state, setState] = useState<State>(() => {
    const reveal = canAnimate && streaming && target.length < REVEAL_ON_MOUNT;
    return { shown: reveal ? '' : target, freshFrom: reveal ? 0 : null, live: reveal };
  });
  const pos = useRef(state.shown.length);
  const marks = useRef<{ at: number; length: number }[]>([]);
  // Every reveal, in order: words from `length` on were revealed at `at`.
  const history = useRef<{ at: number; length: number }[]>([]);
  const revealedAt = useCallback((offset: number) => {
    let at: number | undefined;
    for (const mark of history.current) {
      if (mark.length > offset) break;
      at = mark.at;
    }
    return at;
  }, []);

  let current = state;
  if (!target.startsWith(state.shown)) {
    // Replaced rather than extended: show it as is.
    current = { shown: target, freshFrom: null, live: state.live };
    setState(current);
  } else if ((!canAnimate || (!streaming && !state.live)) && state.shown !== target) {
    // Nothing to animate, or text that was never live (history catching up, e.g.
    // a reload replaying its deltas): show it as it is.
    current = { ...state, shown: target, freshFrom: null };
    setState(current);
  }

  const shownLength = current.shown.length;
  const wasLive = current.live;
  useEffect(() => {
    pos.current = Math.max(pos.current, shownLength);
    if (!canAnimate || shownLength >= target.length || (!streaming && !wasLive)) return;
    let frame = 0;
    let last = performance.now();
    const step = () => {
      // Read the clock here: rAF timestamps don't share an origin everywhere.
      const now = performance.now();
      const dt = Math.min(64, Math.max(0, now - last)) / 1000;
      last = now;
      pos.current = Math.min(
        target.length,
        pos.current + revealSpeed(target.length - pos.current, streaming) * dt,
      );
      let length = shownLength;
      let held = false;
      while (length < target.length) {
        const end = wordEnd(target, length);
        if (streaming && end === target.length && !/\s$/.test(target)) {
          held = true; // the last word may still be growing
          break;
        }
        if (end > pos.current) break;
        length = end;
      }
      if (length > shownLength) {
        history.current.push({ at: now, length: shownLength });
        marks.current = [...marks.current, { at: now, length: shownLength }].filter(
          (m) => now - m.at < freshMs,
        );
        const freshFrom = marks.current[0]?.length ?? shownLength;
        setState({ shown: target.slice(0, length), freshFrom, live: true });
        return;
      }
      if (held) {
        pos.current = length; // caught up; wait for more text
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [canAnimate, freshMs, shownLength, streaming, target, wasLive]);

  return { text: current.shown, freshFrom: current.freshFrom, live: current.live, revealedAt };
}

/** How long a word's settle runs: `nc-settle` in motion.css. */
const SETTLE_MS = 640;

/**
 * Plays each streamed word's settle once, however often its element is
 * remounted. Markdown that changes shape as it arrives (an italic closing,
 * a link completing, a list starting) makes React mount new elements for
 * words already on screen; without this, those words would blur in again.
 * Each newly mounted word stamped with `data-nc-at` (by `revealWords`)
 * has its settle moved on to its real age: still settling, it carries on;
 * already settled, it simply shows.
 */
export function useSettleOnce(ref: RefObject<HTMLElement | null>): void {
  const seen = useRef(new WeakSet<Element>());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const now = performance.now();
    for (const el of root.querySelectorAll<HTMLElement>('[data-nc-at]')) {
      if (seen.current.has(el)) continue;
      seen.current.add(el);
      const age = now - Number(el.dataset.ncAt);
      if (!(age > 0) || typeof el.getAnimations !== 'function') continue;
      for (const animation of el.getAnimations())
        if ((animation as CSSAnimation).animationName === 'nc-settle')
          animation.currentTime = Math.min(age, SETTLE_MS);
    }
  });
}
