import { Slot } from 'radix-ui';
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { Checkbox } from '../../components/Checkbox';
import { ContextMenu } from '../../components/ContextMenu';
import { Pearl } from '../../components/Pearl';
import { Skeleton } from '../../components/Skeleton';
import { cx } from '../../utils/cx';
import { useMediaQuery } from '../../utils/useMediaQuery';
import styles from './ChatList.module.css';
import { CHAT_DRAG_TYPE } from './drag';
import { useHold } from './hold';
import { SWIPE_COMMIT_SHARE, SWIPE_SLOP, swipeOffset, swipeOutcome, type SwipeSide } from './swipe';

/**
 * Where a chat is, at a glance:
 * - `working`: Conch is on it right now.
 * - `waiting`: it stopped to ask you something (an approval, a question).
 * - `unread`: something new arrived since you last looked.
 * - `error`: the last turn didn't finish.
 */
export type ChatStatus = 'working' | 'waiting' | 'unread' | 'error';

/** What screen readers hear for each status, after the chat's title. */
export const CHAT_STATUS_WORDS: Record<ChatStatus, string> = {
  working: 'Working',
  waiting: 'Needs you',
  unread: 'New',
  error: 'Didn’t finish',
};

/** One thing a swipe can do on a phone: Pin, Archive. */
export interface SwipeAction {
  /** Said under the icon as the row slides: “Pin”, “Archive”. */
  label: string;
  icon: ReactNode;
  /** The colour behind the row: `accent` (default) for keeping, `danger` for putting away. */
  tone?: 'accent' | 'neutral' | 'danger';
  onAction: () => void;
}

type SelectEvent = MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>;

export interface ChatRowProps extends Omit<ComponentProps<'li'>, 'children' | 'contextMenu'> {
  /**
   * The row's link, with the chat's title inside: `<NavLink to="/c/1">Plan a
   * trip</NavLink>`. The row gives it its look, and wraps the title so a long
   * one ends in “…”. A router's NavLink marks the open chat itself (with
   * `aria-current`); don't give it a className function.
   */
  children: ReactElement<{ children?: ReactNode }>;
  /** The open chat, for a link that doesn't mark itself (anything but a NavLink). */
  active?: boolean;
  /** Working, needs you, new, or didn't finish. Shown and said, never colour alone. */
  status?: ChatStatus;
  /** Before the title: where the chat came from (a chat app's `IntegrationLogo`). */
  leading?: ReactNode;
  /** After the title, inside the link: a count, a small note. */
  trailing?: ReactNode;
  /** Quieter than a chat: the way into the archive at the end of the list. */
  quiet?: boolean;
  /** The ⋯ menu (a `DropdownMenu`), at the row's end. Shows on hover and focus, always on touch. */
  menu?: ReactNode;
  /** `ContextMenu` items. Given, a right-click (or a long press on touch) opens them. */
  contextMenu?: ReactNode;
  /** The list is choosing several: a tick box shows, and pressing the row ticks it instead of opening it. */
  selecting?: boolean;
  /** Ticked, while `selecting`. */
  selected?: boolean;
  /** The row was ticked or unticked. The event says whether Shift was held, for ranges. */
  onSelectedChange?: (selected: boolean, event: SelectEvent) => void;
  /**
   * Shift-, ⌘- or Ctrl-click while not choosing: the app starts choosing
   * (with this row ticked). Without it, those clicks open the chat as a link
   * normally would.
   */
  onSelectRequest?: (event: MouseEvent<HTMLElement>) => void;
  /**
   * The chats that move when this row is dragged (this one, or every ticked
   * one). Given, the row can be dragged onto a folder or Pinned: with a mouse
   * or trackpad, or on a phone by holding it until it lifts and then moving
   * the finger (letting go without moving opens `contextMenu`).
   */
  dragIds?: string[];
  /** On touch, swiping towards the line's end (right, in English) reveals and does this: Pin. */
  swipeStart?: SwipeAction;
  /** On touch, swiping towards the line's start (left, in English) reveals and does this: Archive. */
  swipeEnd?: SwipeAction;
  /** Shown instead of the link while renaming: the app's own field. */
  editing?: ReactNode;
  /**
   * A dragged chat would land just above this row: an accent line along its
   * top edge says where. The app sets it during `dragover` (passing
   * `onDragOver` and `onDrop` to the row itself); the row only draws it.
   */
  dropBefore?: boolean;
  /**
   * Under the row, inside its item: what belongs to this chat and opens on its
   * own (its tasks, `ChatTasks`). Not part of the link, so it has its own controls.
   */
  below?: ReactNode;
  /**
   * On the row, just before the ⋯, outside the link: a control of the chat's
   * own that opens what's `below` (its tasks' badge, `ChatTasksToggle`). The
   * row's gestures leave it alone.
   */
  disclosure?: ReactNode;
}

/**
 * One chat in the list: its title, where it came from, and where it is
 * (working, needs you, new, didn't finish). A press opens it; its ⋯ (and a
 * right-click) has the rest. While the list is choosing several it becomes a
 * tick box. On a computer it drags onto a folder or Pinned; on a phone a
 * swipe pins or archives it, and a hold lifts it to be dragged there.
 */
export function ChatRow({
  children,
  active,
  status,
  leading,
  trailing,
  quiet,
  menu,
  contextMenu,
  selecting,
  selected,
  onSelectedChange,
  onSelectRequest,
  dragIds,
  swipeStart,
  swipeEnd,
  editing,
  dropBefore,
  below,
  disclosure,
  className,
  onClickCapture,
  onKeyDown,
  onDragStart,
  onDragEnd,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onContextMenu,
  ref,
  ...props
}: ChatRowProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLSpanElement>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  const disclosureRef = useRef<HTMLSpanElement>(null);
  /** The ⋯ and the badge are buttons of their own: no hold, no tick, no link. */
  const inControls = (target: EventTarget | null) =>
    Boolean(
      moreRef.current?.contains(target as Node) || disclosureRef.current?.contains(target as Node),
    );
  /** What's under the row has its own controls: the row's gestures leave it alone. */
  const belowRef = useRef<HTMLDivElement>(null);
  const inBelow = (target: EventTarget | null) =>
    Boolean(belowRef.current?.contains(target as Node));
  const finePointer = useMediaQuery('(pointer: fine)');
  const [dragging, setDragging] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLLIElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const menuFromHold = useRef(false);
  const [lift, setLift] = useState<{ label: string; rect: DOMRect; host: Element }>();
  const swipe = useSwipe({
    rowRef,
    start: swipeStart,
    end: swipeEnd,
    enabled: Boolean(swipeStart || swipeEnd) && !selecting && !editing,
  });
  const hold = useHold({
    itemRef,
    ghostRef,
    ids: dragIds,
    enabled: Boolean(dragIds?.length) && !editing,
    onLift: () => {
      swipe.abandon();
      const item = itemRef.current;
      if (item)
        setLift({
          label: titleRef.current?.textContent ?? '',
          rect: item.getBoundingClientRect(),
          host: item.closest('[data-nacre-theme]:not(:root)') ?? document.body,
        });
    },
    // Let go without moving: the menu a hold has always opened, where the finger is.
    onMenu: (x, y) => {
      const item = itemRef.current;
      if (!contextMenu || selecting || !item) return;
      menuFromHold.current = true;
      item.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
      );
      menuFromHold.current = false;
    },
  });

  const canDrag = Boolean(dragIds?.length) && finePointer && !editing;
  const dot = status === 'waiting' || status === 'unread' || status === 'error';
  const showMenu = Boolean(menu) && !selecting && !editing;
  const showDisclosure = Boolean(disclosure) && !selecting && !editing;

  const toggle = (event: SelectEvent) => onSelectedChange?.(!selected, event);

  // Every click on the row passes through here first, so the link never
  // opens when it shouldn't: while choosing, on a modified click, or at the
  // end of a swipe.
  const handleClickCapture = (e: MouseEvent<HTMLLIElement>) => {
    onClickCapture?.(e);
    const target = e.target as Node;
    // Clicks inside a menu's portal bubble here through React; they aren't the row's.
    if (!e.currentTarget.contains(target) || inControls(target) || inBelow(target)) return;
    const swiped = swipe.consumeClick();
    const held = hold.consumeClick();
    if (swiped || held) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (editing) return;
    if (selecting) {
      e.preventDefault();
      e.stopPropagation();
      toggle(e);
      return;
    }
    if (onSelectRequest && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      onSelectRequest(e);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || !selecting || e.key !== ' ') return;
    // Space on the tick box clicks it (handled above); on the link, it ticks too.
    if ((e.target as HTMLElement).closest('a,[data-chat-link]')) {
      e.preventDefault();
      toggle(e);
    }
  };

  const handleDragStart = (e: DragEvent<HTMLLIElement>) => {
    onDragStart?.(e);
    if (inBelow(e.target)) {
      e.preventDefault();
      return;
    }
    if (!dragIds?.length || e.defaultPrevented) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(CHAT_DRAG_TYPE, JSON.stringify(dragIds));
    e.dataTransfer.setData('text/plain', titleRef.current?.textContent ?? '');
    if (dragIds.length > 1) setCountDragImage(e, dragIds.length);
    setDragging(true);
  };

  const handleDragEnd = (e: DragEvent<HTMLLIElement>) => {
    onDragEnd?.(e);
    setDragging(false);
  };

  const content =
    isValidElement(children) && typeof children.props.children !== 'function'
      ? cloneElement(
          children,
          undefined,
          <>
            {status === 'working' && (
              <Pearl size="xs" state="thinking" label={null} className={styles.pearl} />
            )}
            {leading && <span className={styles.leading}>{leading}</span>}
            <span id={titleId} ref={titleRef} className={styles.title}>
              {children.props.children}
            </span>
            {/* A space, so a screen reader hears “Archived 12 chats”, not “Archived12”. */}
            {trailing && ' '}
            {trailing && <span className={styles.trailing}>{trailing}</span>}
            {status && <span className="nc-visually-hidden">, {CHAT_STATUS_WORDS[status]}</span>}
          </>,
        )
      : children;

  const action = swipe.side === 'start' ? swipeStart : swipe.side === 'end' ? swipeEnd : undefined;

  const item = (
    // The row's own controls (the link, the tick box, the ⋯) take the keyboard;
    // these listeners only catch what passes through on its way to them.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <li
      data-status={status}
      data-dot={dot || undefined}
      data-quiet={quiet || undefined}
      data-selecting={selecting || undefined}
      data-selected={(selecting && selected) || undefined}
      data-dragging={dragging || undefined}
      data-held={hold.phase === 'idle' ? undefined : hold.phase}
      data-holdable={(Boolean(dragIds?.length) && !editing) || undefined}
      data-swiping={swipe.phase === 'idle' ? undefined : swipe.phase}
      data-swipeable={swipe.enabled || undefined}
      data-has-menu={showMenu || undefined}
      data-disclosure={showDisclosure || undefined}
      data-drop-before={dropBefore || undefined}
      data-below={below ? '' : undefined}
      draggable={canDrag || undefined}
      ref={(el) => {
        itemRef.current = el;
        if (typeof ref === 'function') return ref(el);
        if (ref) ref.current = el;
      }}
      className={cx(styles.item, className)}
      onClickCapture={handleClickCapture}
      onContextMenu={(e) => {
        onContextMenu?.(e);
        // A phone's own long-press menu waits for the hold to end (it opens it then).
        if (!menuFromHold.current && hold.blocksMenu()) e.preventDefault();
      }}
      onKeyDown={handleKeyDown}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        if (inBelow(e.target)) return;
        swipe.down(e);
        // Not from the ⋯ or the badge: those are buttons of their own.
        if (!inControls(e.target)) hold.down(e);
      }}
      onPointerMove={(e) => {
        onPointerMove?.(e);
        swipe.move(e);
        hold.move(e);
      }}
      onPointerUp={(e) => {
        onPointerUp?.(e);
        swipe.up(e);
        hold.up(e);
      }}
      onPointerCancel={(e) => {
        onPointerCancel?.(e);
        swipe.cancel(e);
        hold.cancel(e);
      }}
      {...props}
    >
      {action && (
        <div
          aria-hidden
          className={styles.swipeBack}
          data-side={swipe.side}
          data-tone={action.tone ?? 'accent'}
          data-armed={swipe.armed || undefined}
        >
          <span className={styles.swipeAction}>
            <span className={styles.swipeIcon}>{action.icon}</span>
            <span className={styles.swipeLabel}>{action.label}</span>
          </span>
        </div>
      )}
      <div ref={rowRef} className={styles.row}>
        {selecting && !editing && (
          <Checkbox
            size="sm"
            checked={Boolean(selected)}
            aria-labelledby={titleId}
            className={styles.check}
          />
        )}
        {editing ? (
          <div className={styles.editing}>{editing}</div>
        ) : (
          <Slot.Root
            className={styles.link}
            data-chat-link=""
            data-active={active || undefined}
            aria-current={active ? 'page' : undefined}
            tabIndex={selecting ? -1 : undefined}
          >
            {content}
          </Slot.Root>
        )}
        {showDisclosure && (
          <span ref={disclosureRef} className={styles.disclosure}>
            {disclosure}
          </span>
        )}
        {dot && !editing && <span aria-hidden className={styles.dot} data-status={status} />}
        {showMenu && (
          <span ref={moreRef} className={styles.more}>
            {menu}
          </span>
        )}
      </div>
      {below && (
        // Its own right-click: the chat's menu is for the chat's row.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div ref={belowRef} className={styles.below} onContextMenu={(e) => e.stopPropagation()}>
          {below}
        </div>
      )}
      {lift && hold.phase !== 'idle' && hold.phase !== 'lifted' && (
        <DragGhost
          ref={ghostRef}
          host={lift.host}
          label={lift.label}
          rect={lift.rect}
          count={dragIds?.length ?? 1}
          leaving={hold.phase === 'dragging' ? undefined : hold.phase}
        />
      )}
    </li>
  );

  if (!contextMenu) return item;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{item}</ContextMenu.Trigger>
      <ContextMenu.Content>{contextMenu}</ContextMenu.Content>
    </ContextMenu.Root>
  );
}

/**
 * What follows the finger while a row is dragged on a phone: the row itself,
 * lifted off the list, with how many come along when there are several.
 * Placed by `useHold` without re-rendering; drawn over everything, sheets too.
 */
function DragGhost({
  ref,
  host,
  label,
  rect,
  count,
  leaving,
}: {
  ref: RefObject<HTMLDivElement | null>;
  host: Element;
  label: string;
  rect: DOMRect;
  count: number;
  leaving?: 'returning' | 'dropped';
}) {
  return createPortal(
    <div
      ref={ref}
      aria-hidden
      className={styles.ghost}
      data-leaving={leaving}
      style={
        {
          '--cl-ghost-x': `${rect.left}px`,
          '--cl-ghost-y': `${rect.top}px`,
          inlineSize: `${rect.width}px`,
          blockSize: `${rect.height}px`,
        } as CSSProperties
      }
    >
      <span className={styles.ghostTitle}>{label}</span>
      {count > 1 && <span className={styles.ghostCount}>{count}</span>}
    </div>,
    host,
  );
}

/** Dragging several chats: a small pill that says how many, instead of one row's picture. */
function setCountDragImage(e: DragEvent<HTMLElement>, count: number) {
  if (typeof e.dataTransfer.setDragImage !== 'function') return;
  const host = e.currentTarget.closest('[data-nacre-theme]') ?? document.body;
  const pill = document.createElement('div');
  pill.className = styles.dragImage ?? '';
  pill.textContent = `${count} chats`;
  host.appendChild(pill);
  e.dataTransfer.setDragImage(pill, 16, 16);
  // The browser takes its picture now; the element can go on the next frame.
  requestAnimationFrame(() => pill.remove());
}

function prefersStill(el: Element | null): boolean {
  if (el?.closest('[data-nacre-motion="reduced"]')) return true;
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

interface SwipeTrack {
  id: number;
  x0: number;
  y0: number;
  width: number;
  rtl: boolean;
  tracking: boolean;
  offset: number;
  lastDx: number;
  lastT: number;
  velocity: number;
}

/**
 * The swipe on a phone. The row follows the finger over the action's
 * colour; far enough (or a quick flick) and letting go does it, with a
 * spring and a light tap of haptics. Otherwise it springs back. A finger
 * that moves up or down first is scrolling, and is left alone.
 */
function useSwipe({
  rowRef,
  start,
  end,
  enabled,
}: {
  /** The part of the row that slides. */
  rowRef: RefObject<HTMLDivElement | null>;
  start?: SwipeAction;
  end?: SwipeAction;
  enabled: boolean;
}) {
  const track = useRef<SwipeTrack | null>(null);
  const suppress = useRef(false);
  const timers = useRef<number[]>([]);
  const [phase, setPhase] = useState<'idle' | 'tracking' | 'settling'>('idle');
  const [side, setSide] = useState<SwipeSide | null>(null);
  const [armed, setArmed] = useState(false);

  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
    },
    [],
  );

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const place = (offset: number, rtl: boolean) => {
    rowRef.current?.style.setProperty('--cl-swipe-x', `${rtl ? -offset : offset}px`);
  };

  /** Animate to `offset`, then call `done`. */
  const settle = (offset: number, rtl: boolean, done: () => void) => {
    const el = rowRef.current;
    if (!el || prefersStill(el)) {
      place(offset, rtl);
      done();
      return;
    }
    setPhase('settling');
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      el.removeEventListener('transitionend', finish);
      done();
    };
    // Next frame, so the settling transition is in place before the row moves.
    requestAnimationFrame(() => {
      place(offset, rtl);
      el.addEventListener('transitionend', finish);
      later(finish, 600);
    });
  };

  const reset = () => {
    setPhase('idle');
    setSide(null);
    setArmed(false);
  };

  return {
    phase,
    side,
    armed,
    enabled,
    /** True once if the click that just came is the end of a swipe. */
    consumeClick() {
      if (!suppress.current) return false;
      suppress.current = false;
      return true;
    },
    down(e: PointerEvent<HTMLElement>) {
      if (!enabled || e.pointerType !== 'touch' || phase === 'settling') return;
      const rect = e.currentTarget.getBoundingClientRect();
      track.current = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        width: rect.width,
        rtl: getComputedStyle(e.currentTarget).direction === 'rtl',
        tracking: false,
        offset: 0,
        lastDx: 0,
        lastT: e.timeStamp,
        velocity: 0,
      };
    },
    move(e: PointerEvent<HTMLElement>) {
      const t = track.current;
      if (!t || e.pointerId !== t.id) return;
      const rawDx = e.clientX - t.x0;
      const dx = t.rtl ? -rawDx : rawDx;
      const dy = e.clientY - t.y0;
      if (!t.tracking) {
        // Up or down first: that's a scroll, not a swipe.
        if (Math.abs(dy) > SWIPE_SLOP && Math.abs(dy) >= Math.abs(dx)) {
          track.current = null;
          return;
        }
        if (Math.abs(dx) < SWIPE_SLOP) return;
        t.tracking = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        suppress.current = true;
        setPhase('tracking');
      }
      const offset = swipeOffset(dx, t.width, { start: Boolean(start), end: Boolean(end) });
      t.offset = offset;
      place(offset, t.rtl);
      const dt = e.timeStamp - t.lastT;
      if (dt > 0) t.velocity = 0.7 * ((dx - t.lastDx) / dt) + 0.3 * t.velocity;
      t.lastDx = dx;
      t.lastT = e.timeStamp;
      const nextSide: SwipeSide | null =
        offset > 0 && start ? 'start' : offset < 0 && end ? 'end' : null;
      setSide(nextSide);
      setArmed(nextSide !== null && Math.abs(offset) >= t.width * SWIPE_COMMIT_SHARE);
    },
    up(e: PointerEvent<HTMLElement>) {
      const t = track.current;
      if (!t || e.pointerId !== t.id) return;
      track.current = null;
      if (!t.tracking) return;
      // If no click follows the swipe, don't let it eat the next real tap.
      later(() => {
        suppress.current = false;
      }, 400);
      const outcome = swipeOutcome(t.offset, t.velocity, t.width);
      const action = outcome === 'start' ? start : outcome === 'end' ? end : undefined;
      if (!action) {
        settle(0, t.rtl, reset);
        return;
      }
      if (typeof navigator !== 'undefined') navigator.vibrate?.(8);
      setArmed(true);
      settle(outcome === 'start' ? t.width : -t.width, t.rtl, () => {
        action.onAction();
        // If the row is still here (a pin moves it, it doesn't remove it), it comes back.
        settle(0, t.rtl, reset);
      });
    },
    cancel(e: PointerEvent<HTMLElement>) {
      const t = track.current;
      if (!t || e.pointerId !== t.id) return;
      track.current = null;
      if (t.tracking) settle(0, t.rtl, reset);
    },
    /** Something else took the finger (a hold lifted the row): let go, and slide home if it moved. */
    abandon() {
      const t = track.current;
      track.current = null;
      if (t?.tracking) settle(0, t.rtl, reset);
    },
  };
}

/** A row's place while the list loads. */
export function ChatRowSkeleton({
  width = '70%',
  className,
  ...props
}: Omit<ComponentProps<'li'>, 'children'> & { width?: string }) {
  return (
    <li aria-hidden className={cx(styles.skeleton, className)} {...props}>
      <Skeleton width={width} />
    </li>
  );
}
