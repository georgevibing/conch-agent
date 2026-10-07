import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react';

/** Long enough for the slowest control spring to settle (`--nc-spring-bouncy`, 780 ms). */
const SETTLE_MS = 1000;
/**
 * A press whose change lands later — after a permission prompt, a save, a
 * confirmation — still moves when it lands, if it lands within this.
 */
const LANDS_MS = 30_000;

/** The handlers a control already has, to run after its motion's. */
export interface PeopleHandlers<E extends Element> {
  onPointerEnter?: (event: PointerEvent<E>) => void;
  onPointerLeave?: (event: PointerEvent<E>) => void;
  onPointerDown?: (event: PointerEvent<E>) => void;
  onClick?: (event: MouseEvent<E>) => void;
}

/**
 * Toggles move when people move them (NACRE.md § Motion). A switch, a
 * checkbox or a segmented control arrives in its place, and a value that
 * changes by itself — data that loaded, a save undone — is simply there.
 *
 * Spread what this returns onto the control (after its own props): it
 * renders `data-moving`, which the control's CSS needs before it moves at
 * all. A pointer coming near, a press, a click, Space or Enter turn it on;
 * it goes off once the change it asked for has settled.
 *
 * `value` is the controlled value, or `undefined` when the control keeps its
 * own (then it changes at the click itself).
 */
export function useMotionFromPeople<E extends Element>(
  value: unknown,
  handlers: PeopleHandlers<E> = {},
) {
  const [moving, setMoving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stopIn = (ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMoving(false), ms);
  };
  const start = (ms: number) => {
    setMoving(true);
    stopIn(ms);
  };
  const was = useRef(value);
  useLayoutEffect(() => {
    if (Object.is(was.current, value)) return;
    was.current = value;
    // The change a person asked for has landed: let it play, then stop.
    if (moving) stopIn(SETTLE_MS);
  }, [value, moving]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Hovering and pressing move it too (a halo, a squash), so a pointer near it arms it.
  const near = (event: PointerEvent<E>, own?: (event: PointerEvent<E>) => void) => {
    start(SETTLE_MS);
    own?.(event);
  };
  return {
    moving,
    'data-moving': moving || undefined,
    onPointerEnter: (event: PointerEvent<E>) => near(event, handlers.onPointerEnter),
    onPointerLeave: (event: PointerEvent<E>) => near(event, handlers.onPointerLeave),
    onPointerDown: (event: PointerEvent<E>) => near(event, handlers.onPointerDown),
    // Every way a person changes it ends in a click: a tap, its label, Space or Enter.
    onClick: (event: MouseEvent<E>) => {
      start(value === undefined ? SETTLE_MS : LANDS_MS);
      handlers.onClick?.(event);
    },
  };
}
