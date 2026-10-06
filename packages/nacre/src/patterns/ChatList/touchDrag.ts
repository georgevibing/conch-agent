import { useSyncExternalStore } from 'react';

/**
 * Dragging chats with a finger. A phone has no drag and drop of its own, so
 * a row held long enough lifts, and from then on this carries it: the places
 * that take chats (a folder, Pinned) register here, the row says where the
 * finger is, and whichever place is under it lights up and takes the chats
 * when the finger lets go. Anywhere else, and nothing happens.
 */

/** How long a finger rests on a row before it lifts. Shorter than a menu's hold, longer than a tap. */
export const HOLD_MS = 450;
/** A finger that moves this far before the row lifts is scrolling or swiping: the hold is off. */
export const HOLD_SLOP = 8;
/** How close to the list's top or bottom edge, in px, before it starts scrolling by itself. */
export const EDGE_ZONE = 56;
/** The fastest it scrolls by itself, in px per frame, with the finger right at the edge. */
export const EDGE_SPEED = 16;

export interface TouchDragSession {
  /** The chats on the finger. */
  ids: string[];
  /** The place under the finger that takes them, if any. */
  over: HTMLElement | null;
}

type Drop = (ids: string[]) => void;

const targets = new Map<HTMLElement, Drop>();
const listeners = new Set<() => void>();
let session: TouchDragSession | null = null;

function publish(next: TouchDragSession | null) {
  session = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => session;

/** The drag in progress, if a finger is carrying chats. Re-renders only when it starts, moves to another place, or ends. */
export function useTouchDrag(): TouchDragSession | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** Makes an element a place a finger can drop chats on. Returns how to stop. */
export function registerTouchDrop(el: HTMLElement, onDrop: Drop): () => void {
  targets.set(el, onDrop);
  return () => {
    if (targets.get(el) === onDrop) targets.delete(el);
    if (session?.over === el) publish({ ...session, over: null });
  };
}

/** The place under a point that takes chats: the nearest registered element around what's there. */
export function dropTargetAt(x: number, y: number): HTMLElement | null {
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function')
    return null;
  let el: Element | null = document.elementFromPoint(x, y);
  while (el) {
    if (el instanceof HTMLElement && targets.has(el)) return el;
    el = el.parentElement;
  }
  return null;
}

function buzz(ms: number) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(ms);
    } catch {
      /* Some browsers refuse without a reason; a missing tap is fine. */
    }
  }
}

export const touchDrag = {
  /** A light tap of haptics where the phone has them (Android); nothing where it doesn't. */
  buzz,
  get active() {
    return session !== null;
  },
  begin(ids: string[]) {
    publish({ ids, over: null });
  },
  /** The finger is here: light up what's under it. Returns that place. */
  moveTo(x: number, y: number): HTMLElement | null {
    if (!session) return null;
    const over = dropTargetAt(x, y);
    if (over !== session.over) {
      if (over) buzz(6);
      publish({ ...session, over });
    }
    return over;
  },
  /** The finger let go: the place under it takes the chats. True when one did. */
  end(): boolean {
    const current = session;
    publish(null);
    if (!current?.over) return false;
    const drop = targets.get(current.over);
    if (!drop) return false;
    buzz(12);
    drop(current.ids);
    return true;
  },
  /** Called off (the touch was taken away, the row went): nothing moves. */
  cancel() {
    if (session) publish(null);
  },
};

/** The nearest ancestor that scrolls up and down: where the list scrolls by itself near its edges. */
export function scrollerOf(el: Element | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight)
      return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * How far to scroll this frame with the finger at `y` in a list from `top`
 * to `bottom`: nothing in the middle, faster the closer it is to an edge.
 * Negative is up.
 */
export function edgeScroll(y: number, top: number, bottom: number): number {
  const zone = Math.min(EDGE_ZONE, (bottom - top) / 4);
  if (!(zone > 0)) return 0;
  if (y < top + zone) return -Math.ceil(EDGE_SPEED * Math.min(1, (top + zone - y) / zone));
  if (y > bottom - zone) return Math.ceil(EDGE_SPEED * Math.min(1, (y - (bottom - zone)) / zone));
  return 0;
}
