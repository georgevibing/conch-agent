import { ArrowLeft, ArrowRight, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import { DropdownMenu } from '../../components/DropdownMenu';
import { cx } from '../../utils/cx';
import type { AgentFace } from '../AgentAvatar/presets';
import { AgentCard } from './AgentCard';
import styles from './Agents.module.css';

export interface AgentGalleryItem {
  id: string;
  name: string;
  role?: string;
  avatar?: AgentFace | string;
  isDefault?: boolean;
}

export interface AgentGalleryProps {
  agents: readonly AgentGalleryItem[];
  /** A face pressed: open that agent. */
  onOpen: (id: string) => void;
  /** The last tile, a +: make another. Left out (at the limit, say), there's no tile. */
  onCreate?: () => void;
  /** The new order, by id, after a drag, a long press and a drag, or Alt and an arrow. */
  onReorder?: (ids: string[]) => void;
  onMakeDefault?: (id: string) => void;
  /** Left out, or with one agent, there's nothing to delete. */
  onDelete?: (id: string) => void;
  /** An agent to land with a spring (just made). */
  arrived?: string;
  /** Read as the list's name. */
  label?: string;
  className?: string;
}

/** How far a pointer moves before a press becomes a drag (px), and how long a finger holds to lift one (ms). */
const DRAG_AFTER = 6;
const HOLD = 380;

interface Drag {
  id: string;
  pointer: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Each cell's middle, by place, measured when it was lifted. */
  cells: { x: number; y: number }[];
  from: number;
  over: number;
}

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/**
 * Who's here, as a wall of faces: every agent large, its name under it, the
 * default one marked, and a + to make another. Press a face to open it.
 *
 * The order is the pickers' order. Drag a face to move it (on a phone, hold
 * it a moment first); the others make room as it passes and it settles where
 * it's let go. From the keyboard, Alt and an arrow move the focused face.
 * Each face's ⋯ (or a right-click) offers the rest: make it the default,
 * move it, delete it.
 */
export function AgentGallery({
  agents,
  onOpen,
  onCreate,
  onReorder,
  onMakeDefault,
  onDelete,
  arrived,
  label = 'Agents',
  className,
}: AgentGalleryProps) {
  const list = useRef<HTMLUListElement>(null);
  const hint = useId();
  const [drag, setDrag] = useState<Drag>();
  const [said, setSaid] = useState('');
  const press = useRef<{
    id: string;
    pointer: number;
    x: number;
    y: number;
    touch: boolean;
    timer?: ReturnType<typeof setTimeout>;
  }>(undefined);
  const dragged = useRef(false);
  const [menuFor, setMenuFor] = useState<string>();

  const ids = agents.map((a) => a.id);
  const idsKey = ids.join(' ');
  // Let go somewhere new: shown there at once, until the new order comes back.
  const [kept, setKept] = useState<{ base: string; order: string[] }>();
  const resting = kept?.base === idsKey ? kept.order : ids;
  const [base, setBase] = useState(resting);
  const order = drag ? moved(base, drag.from, drag.over) : resting;
  const reorderable = Boolean(onReorder) && agents.length > 1;

  // The others glide to their new places (FLIP): measured before and after each move.
  const before = useRef(new Map<string, DOMRect>());
  const orderKey = order.join(' ');
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const now = new Map<string, DOMRect>();
    for (const item of el.querySelectorAll<HTMLElement>('[data-agent]'))
      now.set(item.dataset.agent ?? '', item.getBoundingClientRect());
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    for (const [id, box] of now) {
      const was = before.current.get(id);
      if (!was || still || id === drag?.id) continue;
      const dx = was.left - box.left;
      const dy = was.top - box.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.querySelector<HTMLElement>(`[data-agent="${CSS.escape(id)}"]`)?.animate?.(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: 320, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.1)' },
      );
    }
    before.current = now;
  }, [orderKey, drag?.id]);

  const say = (text: string) => setSaid(text);

  const lift = (id: string, pointer: number, x: number, y: number) => {
    const el = list.current;
    if (!el) return;
    // Each place's middle, in the order they show.
    const cells = order.map((at) => {
      const box = el
        .querySelector<HTMLElement>(`[data-agent="${CSS.escape(at)}"]`)
        ?.getBoundingClientRect();
      return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: 0, y: 0 };
    });
    const from = order.indexOf(id);
    dragged.current = true;
    setBase(order);
    setDrag({ id, pointer, x, y, dx: 0, dy: 0, cells, from, over: from });
    navigator.vibrate?.(8);
  };

  const cancelPress = () => {
    if (press.current?.timer) clearTimeout(press.current.timer);
    press.current = undefined;
  };

  // While a finger drags a face, the page mustn't scroll under it.
  useLayoutEffect(() => {
    if (!drag) return;
    const hold = (e: TouchEvent) => e.preventDefault();
    document.addEventListener('touchmove', hold, { passive: false });
    return () => document.removeEventListener('touchmove', hold);
  }, [drag]);

  const down = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (!reorderable || (event.pointerType === 'mouse' && event.button !== 0)) return;
    dragged.current = false;
    const touch = event.pointerType !== 'mouse';
    const at = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, touch };
    press.current = touch
      ? { ...at, timer: setTimeout(() => lift(id, at.pointer, at.x, at.y), HOLD) }
      : at;
  };

  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag) {
      if (event.pointerId !== drag.pointer) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      const me = drag.cells[drag.from];
      if (!me) return;
      const here = { x: me.x + dx, y: me.y + dy };
      let over = drag.from;
      let best = Infinity;
      drag.cells.forEach((cell, i) => {
        const d = (cell.x - here.x) ** 2 + (cell.y - here.y) ** 2;
        if (d < best) {
          best = d;
          over = i;
        }
      });
      setDrag({ ...drag, dx, dy, over });
      return;
    }
    const p = press.current;
    if (!p || p.pointer !== event.pointerId) return;
    const far = Math.hypot(event.clientX - p.x, event.clientY - p.y) > DRAG_AFTER;
    if (!far) return;
    // A finger that moves before it has held is scrolling; a mouse that moves is dragging.
    if (p.touch) cancelPress();
    else {
      event.currentTarget.setPointerCapture(event.pointerId);
      lift(p.id, p.pointer, p.x, p.y);
      cancelPress();
    }
  };

  const up = (event: PointerEvent<HTMLButtonElement>) => {
    cancelPress();
    if (!drag || event.pointerId !== drag.pointer) return;
    const next = moved(base, drag.from, drag.over);
    const name = agents.find((a) => a.id === drag.id)?.name ?? '';
    // Where it was let go, so it glides from there into its place.
    const item = list.current?.querySelector<HTMLElement>(`[data-agent="${CSS.escape(drag.id)}"]`);
    if (item) before.current.set(drag.id, item.getBoundingClientRect());
    setDrag(undefined);
    if (drag.over !== drag.from) {
      setKept({ base: idsKey, order: next });
      onReorder?.(next);
      say(`${name} moved to ${drag.over + 1} of ${next.length}.`);
    }
  };

  const nudge = (id: string, by: number) => {
    const from = order.indexOf(id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= order.length) return;
    const next = moved(order, from, to);
    setKept({ base: idsKey, order: next });
    onReorder?.(next);
    say(`${agents.find((a) => a.id === id)?.name ?? ''} moved to ${to + 1} of ${next.length}.`);
    requestAnimationFrame(() =>
      list.current?.querySelector<HTMLElement>(`[data-agent="${CSS.escape(id)}"] button`)?.focus(),
    );
  };

  const keys = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (!reorderable || !event.altKey) return;
    const by =
      event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? -1
        : event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : 0;
    if (!by) return;
    event.preventDefault();
    nudge(id, by);
  };

  const canDelete = Boolean(onDelete) && agents.length > 1;

  return (
    <div className={cx(styles.gallery, className)} data-dragging={drag ? '' : undefined}>
      <ul ref={list} className={styles.wall} aria-label={label}>
        {/* The page keeps them in one order while a face is dragged (a node moved
            in the page would let go of the pointer); where each shows is its `order`. */}
        {agents.map((agent) => {
          const index = order.indexOf(agent.id);
          const lifted = drag?.id === agent.id;
          const cell = drag?.cells[index];
          const home = drag?.cells[drag.from];
          const offset =
            lifted && cell && home
              ? { x: drag.dx + home.x - cell.x, y: drag.dy + home.y - cell.y }
              : undefined;
          return (
            <li
              key={agent.id}
              data-agent={agent.id}
              className={styles.wallItem}
              data-lifted={lifted || undefined}
              style={
                {
                  order: index,
                  ...(offset && { '--ag-x': `${offset.x}px`, '--ag-y': `${offset.y}px` }),
                } as CSSProperties
              }
            >
              <button
                type="button"
                className={styles.wallButton}
                aria-label={agent.isDefault ? `${agent.name}, default` : agent.name}
                aria-describedby={`${hint}-${agent.id}`}
                onClick={() => {
                  if (dragged.current) {
                    dragged.current = false;
                    return;
                  }
                  onOpen(agent.id);
                }}
                onPointerDown={(e) => down(e, agent.id)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onKeyDown={(e) => keys(e, agent.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  // A long press that lifted a face isn't asking for the menu.
                  if (!dragged.current) setMenuFor(agent.id);
                }}
              >
                <AgentCard
                  name={agent.name}
                  about={agent.role}
                  avatar={agent.avatar}
                  isDefault={agent.isDefault}
                  arrived={arrived === agent.id}
                  style={{ '--ag-i': index } as CSSProperties}
                />
              </button>
              <span id={`${hint}-${agent.id}`} hidden>
                {[agent.role, reorderable && 'Alt and an arrow key move it.']
                  .filter(Boolean)
                  .join(' ')}
              </span>
              <DropdownMenu.Root
                open={menuFor === agent.id}
                onOpenChange={(open) => setMenuFor(open ? agent.id : undefined)}
              >
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className={styles.wallMore}
                    aria-label={`More for ${agent.name}`}
                  >
                    <MoreHorizontal aria-hidden />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                  <DropdownMenu.Item icon={<Pencil />} onSelect={() => onOpen(agent.id)}>
                    Edit
                  </DropdownMenu.Item>
                  {onMakeDefault && !agent.isDefault && (
                    <DropdownMenu.Item icon={<Star />} onSelect={() => onMakeDefault(agent.id)}>
                      Make default
                    </DropdownMenu.Item>
                  )}
                  {reorderable && index > 0 && (
                    <DropdownMenu.Item icon={<ArrowLeft />} onSelect={() => nudge(agent.id, -1)}>
                      Move earlier
                    </DropdownMenu.Item>
                  )}
                  {reorderable && index < order.length - 1 && (
                    <DropdownMenu.Item icon={<ArrowRight />} onSelect={() => nudge(agent.id, 1)}>
                      Move later
                    </DropdownMenu.Item>
                  )}
                  {canDelete && (
                    <>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item
                        icon={<Trash2 />}
                        tone="danger"
                        onSelect={() => onDelete?.(agent.id)}
                      >
                        Delete
                      </DropdownMenu.Item>
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </li>
          );
        })}
        {onCreate && (
          <li className={styles.wallItem} style={{ order: agents.length }}>
            <button type="button" className={styles.wallButton} onClick={onCreate}>
              <span className={styles.card} data-size="2xl">
                <span className={styles.addFace} aria-hidden>
                  <Plus />
                </span>
                <span className={styles.cardName}>New agent</span>
              </span>
            </button>
          </li>
        )}
      </ul>
      <span className="nc-visually-hidden" role="status" aria-live="polite">
        {said}
      </span>
    </div>
  );
}
