import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';

export type PanelSide = 'left' | 'right' | 'bottom' | 'top';

export interface PanelPresenceProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Whether the panel is showing. Closing plays the exit before it goes. */
  open: boolean;
  /** The edge the panel lives on, so it arrives from (and leaves toward) it. */
  side?: PanelSide;
  /**
   * Keep the panel in the page while closed (it's only faded out) — for a
   * panel that keeps its place and state, like the sidebar. Hide or `inert`
   * it yourself once closed.
   */
  keepMounted?: boolean;
  /** Play the entrance when the panel is already open on first paint. */
  appear?: boolean;
  children: ReactNode;
}

/**
 * The light that crosses a panel as it arrives ("glint", motion.css). Put it
 * inside anything with `data-side` and `data-state` that isn't a
 * `PanelPresence` (which brings its own) — a Sheet already has one.
 */
export function PanelGlint() {
  return <span data-nc-glint="" aria-hidden />;
}

/**
 * Every panel that appears and leaves — a dock beside the chat, a drawer under
 * it, the sidebar — does it with this one motion: it surfaces from its edge
 * with a glint of pearl light, and sinks back quicker. Closing keeps what was
 * in it on screen until the exit has played, then lets it go.
 *
 * Don't animate panels any other way; see packages/nacre/AGENTS.md.
 */
export function PanelPresence({
  open,
  side = 'right',
  keepMounted = false,
  appear = true,
  children,
  ref,
  ...props
}: PanelPresenceProps) {
  const own = useRef<HTMLDivElement>(null);
  const [wasOpen, setWasOpen] = useState(open);
  const [animate, setAnimate] = useState(appear && open);
  const [leaving, setLeaving] = useState(false);
  // What was in the panel while open, still shown while it leaves (the caller
  // has usually emptied it by then).
  const [kept, setKept] = useState<ReactNode>(children);
  if (open !== wasOpen) {
    setWasOpen(open);
    setAnimate(true);
    setLeaving(!open);
  }
  if (open && kept !== children) setKept(children);

  // Gone once the exit has finished. With nothing to play (reduced motion
  // everywhere at once, or no animations at all, as in tests), at once.
  useLayoutEffect(() => {
    if (!leaving) return;
    const el = own.current;
    const running = el?.getAnimations?.() ?? [];
    if (running.length === 0) {
      setLeaving(false);
      return;
    }
    let live = true;
    void Promise.all(running.map((a) => a.finished)).then(
      () => live && setLeaving(false),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [leaving]);

  if (!open && !leaving && !keepMounted) return null;

  return (
    <div
      {...props}
      ref={(node) => {
        own.current = node;
        if (typeof ref === 'function') return ref(node);
        if (ref) ref.current = node;
      }}
      data-nc-panel=""
      data-side={side}
      data-state={open ? 'open' : 'closed'}
      data-animate={animate || undefined}
    >
      {open || keepMounted ? children : kept}
      <PanelGlint />
    </div>
  );
}
