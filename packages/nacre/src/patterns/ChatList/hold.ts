import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

import { edgeScroll, HOLD_MS, HOLD_SLOP, scrollerOf, SETTLE_MS, touchDrag } from './touchDrag';

/**
 * - `lifted`: held long enough; the row has risen under the finger.
 * - `dragging`: the finger moved off with it; a copy follows the finger.
 * - `returning`: let go somewhere that takes nothing; the copy goes home.
 * - `dropped`: let go on a place that took it; the copy settles in.
 */
export type HoldPhase = 'idle' | 'lifted' | 'dragging' | 'returning' | 'dropped';

interface Press {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** Where on the row the finger is, so the copy stays under it as it was. */
  dx: number;
  dy: number;
  width: number;
  height: number;
  timer: number | undefined;
  scroller: HTMLElement | null;
  frame: number | undefined;
}

function prefersStill(el: Element | null): boolean {
  if (el?.closest('[data-nacre-motion="reduced"]')) return true;
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Press and hold a row on a phone to pick it up. Held still for a moment,
 * the row lifts (with a tap of haptics where the phone has them); moved, it
 * comes along under the finger, the list scrolling by itself near its edges,
 * and whatever place takes chats lights up beneath it. Let go on one and the
 * chats move there; anywhere else, they stay. Let go without moving and the
 * row's menu opens, as a hold always did.
 *
 * A finger that moves before the row lifts is scrolling or swiping, and is
 * left alone. Only touch: a mouse drags the browser's own way.
 */
export function useHold({
  itemRef,
  ghostRef,
  ids,
  enabled,
  onMenu,
  onLift,
}: {
  itemRef: RefObject<HTMLElement | null>;
  /** The copy that follows the finger, placed here without re-rendering. */
  ghostRef: RefObject<HTMLElement | null>;
  /** The chats that come along. */
  ids: string[] | undefined;
  enabled: boolean;
  /** Let go without moving: the row's menu, where the finger is. */
  onMenu?: (x: number, y: number) => void;
  /** The row lifted: anything else following the finger (the swipe) lets go. */
  onLift?: () => void;
}) {
  const press = useRef<Press | null>(null);
  const phaseRef = useRef<HoldPhase>('idle');
  const [phase, setPhaseState] = useState<HoldPhase>('idle');
  const suppress = useRef(false);
  const lastTouch = useRef(0);
  const timers = useRef<number[]>([]);
  const idsRef = useRef(ids);
  useEffect(() => {
    idsRef.current = ids;
  }, [ids]);

  const setPhase = (next: HoldPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  /** Puts the copy where the finger is (or anywhere, given). */
  const place = (x: number, y: number) => {
    const p = press.current;
    const ghost = ghostRef.current;
    if (!p || !ghost) return;
    ghost.style.setProperty('--cl-ghost-x', `${x - p.dx}px`);
    ghost.style.setProperty('--cl-ghost-y', `${y - p.dy}px`);
  };

  const stopScrolling = () => {
    const p = press.current;
    if (p?.frame !== undefined) cancelAnimationFrame(p.frame);
    if (p) p.frame = undefined;
  };

  /** Near the list's top or bottom edge, it scrolls by itself, and what's under the finger is looked at again. */
  const scrollTick = () => {
    const p = press.current;
    if (!p || phaseRef.current !== 'dragging') return;
    p.frame = undefined;
    const scroller = p.scroller;
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const by = edgeScroll(p.y, rect.top, rect.bottom);
    if (!by) return;
    const before = scroller.scrollTop;
    scroller.scrollTop = before + by;
    if (scroller.scrollTop !== before) touchDrag.moveTo(p.x, p.y);
    p.frame = requestAnimationFrame(scrollTick);
  };

  const finish = (outcome: 'returning' | 'dropped') => {
    stopScrolling();
    const item = itemRef.current;
    const p = press.current;
    if (!item || !p || prefersStill(item)) {
      press.current = null;
      setPhase('idle');
      return;
    }
    if (outcome === 'returning') {
      // Home: back to where the row is now (the list may have scrolled under it).
      const rect = item.getBoundingClientRect();
      p.dx = 0;
      p.dy = 0;
      requestAnimationFrame(() => place(rect.left, rect.top));
    }
    setPhase(outcome);
    later(
      () => {
        if (phaseRef.current !== outcome) return;
        press.current = null;
        setPhase('idle');
      },
      outcome === 'returning' ? 420 : 260,
    );
  };

  const release = () => {
    const p = press.current;
    if (p?.timer !== undefined) window.clearTimeout(p.timer);
    // If no click follows, don't let the hold eat the next real tap.
    if (suppress.current) later(() => (suppress.current = false), 400);
  };

  // The finger keeps the page from scrolling once the row is up. Only a
  // listener that isn't passive can say so, and it must be in place before
  // the touch starts, so it lives on the row for as long as it can lift.
  useEffect(() => {
    const el = itemRef.current;
    if (!el || !enabled) return;
    const block = (e: TouchEvent) => {
      const now = phaseRef.current;
      if ((now === 'lifted' || now === 'dragging') && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, [itemRef, enabled]);

  // A row that goes away mid-drag takes the drag with it.
  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
      const p = press.current;
      if (p?.timer !== undefined) window.clearTimeout(p.timer);
      if (p?.frame !== undefined) cancelAnimationFrame(p.frame);
      if (phaseRef.current === 'dragging') touchDrag.cancel();
    },
    [],
  );

  return {
    phase,
    /** True once if the click that just came is the end of a hold. */
    consumeClick() {
      if (!suppress.current) return false;
      suppress.current = false;
      return true;
    },
    /**
     * A context menu the phone opens by itself on a long press (Android) is
     * the hold's to open, on letting go; a right-click is left alone.
     */
    blocksMenu() {
      return enabled && Date.now() - lastTouch.current < 2000;
    },
    down(e: PointerEvent<HTMLElement>) {
      if (!enabled || e.pointerType !== 'touch' || !e.isPrimary) return;
      lastTouch.current = Date.now();
      if (phaseRef.current !== 'idle') return;
      const item = itemRef.current;
      if (!item) return;
      const rect = item.getBoundingClientRect();
      const p: Press = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        x: e.clientX,
        y: e.clientY,
        dx: e.clientX - rect.left,
        dy: e.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        timer: undefined,
        scroller: null,
        frame: undefined,
      };
      p.timer = window.setTimeout(() => {
        if (press.current !== p) return;
        p.timer = undefined;
        suppress.current = true;
        touchDrag.buzz(10);
        onLift?.();
        setPhase('lifted');
        // From here the hold owns the finger: the menu's own long press (Radix's,
        // at 700ms) lets go, the way a finger that moved would have made it.
        // Never `preventDefault` on `pointerdown` for that — a tap would stop
        // opening the chat. The id is nobody's, so nothing else reads it.
        item.dispatchEvent(
          new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', pointerId: -1 }),
        );
      }, HOLD_MS);
      press.current = p;
    },
    move(e: PointerEvent<HTMLElement>) {
      const p = press.current;
      if (!p || e.pointerId !== p.id) return;
      p.x = e.clientX;
      p.y = e.clientY;
      const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
      const now = phaseRef.current;
      if (now === 'idle') {
        // Moved before it lifted: a scroll or a swipe, not a hold.
        if (moved > HOLD_SLOP) {
          window.clearTimeout(p.timer);
          press.current = null;
        }
        return;
      }
      if (now === 'lifted') {
        if (moved <= HOLD_SLOP || !idsRef.current?.length) return;
        p.scroller = scrollerOf(itemRef.current);
        touchDrag.begin(idsRef.current);
        setPhase('dragging');
        // The copy appears next frame, exactly over the row; then it follows.
        requestAnimationFrame(() => place(p.x, p.y));
      } else if (now !== 'dragging') return;
      place(p.x, p.y);
      touchDrag.moveTo(p.x, p.y);
      if (p.frame === undefined && p.scroller) p.frame = requestAnimationFrame(scrollTick);
    },
    up(e: PointerEvent<HTMLElement>) {
      const p = press.current;
      if (!p || e.pointerId !== p.id) return;
      release();
      const now = phaseRef.current;
      if (now === 'idle') {
        press.current = null;
        return;
      }
      if (now === 'lifted') {
        press.current = null;
        setPhase('idle');
        onMenu?.(p.x, p.y);
        return;
      }
      if (now === 'dragging') {
        // Nothing to settle into when motion is reduced: the chats move at once.
        const settle = prefersStill(itemRef.current) ? 0 : SETTLE_MS;
        finish(touchDrag.end(settle) ? 'dropped' : 'returning');
      }
    },
    cancel(e: PointerEvent<HTMLElement>) {
      const p = press.current;
      if (!p || e.pointerId !== p.id) return;
      release();
      const now = phaseRef.current;
      if (now === 'dragging') {
        touchDrag.cancel();
        finish('returning');
        return;
      }
      press.current = null;
      if (now === 'lifted') setPhase('idle');
    },
    /** The size of the row when it lifted, for the copy. */
    size(): { width: number; height: number } | undefined {
      const p = press.current;
      return p ? { width: p.width, height: p.height } : undefined;
    },
  };
}
