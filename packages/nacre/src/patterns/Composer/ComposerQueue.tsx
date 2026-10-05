import { GripVertical, Pencil, Send, X, Zap } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import styles from './ComposerQueue.module.css';

export interface ComposerQueueItem {
  id: string;
  /** What it says. */
  text: string;
  /** What else goes with it, e.g. "2 files". */
  meta?: string;
}

export interface ComposerQueueProps {
  items: readonly ComposerQueueItem[];
  /** The new order, by id, after a drag or an arrow key. */
  onReorder: (ids: string[]) => void;
  /** Send this one now: stop what's running and give it this. */
  onSteer: (id: string) => void;
  /** Take it back into the box to change it. */
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  /** Something is running (Steer stops it first); otherwise the first one just sends. */
  running?: boolean;
  /** The queue waits instead of sending by itself (the reply was stopped). */
  paused?: boolean;
  /** Who it waits for: "Conch". */
  name?: string;
  className?: string;
}

interface Drag {
  id: string;
  pointer: number;
  startY: number;
  dy: number;
  /** Where each row sits (top, height), measured when the drag began. */
  rows: { id: string; top: number; height: number }[];
  over: number;
}

/** Where the dragged row would land: after every other row whose middle it has passed. */
function landing(drag: Drag): number {
  const from = drag.rows.findIndex((r) => r.id === drag.id);
  const row = drag.rows[from];
  if (!row) return from;
  const middle = row.top + row.height / 2 + drag.dy;
  return drag.rows.filter((r, i) => i !== from && r.top + r.height / 2 < middle).length;
}

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/**
 * Messages written while the assistant works, waiting their turn above the
 * box. Each goes by itself, one at a time, as soon as the reply before it is
 * over. Drag one by its handle (or move it with the arrow keys) to change the
 * order; **Steer** sends one at once, stopping what's running so it reads it
 * now; the pencil takes it back into the box. While a drag is on, the others
 * make room as it passes, and the one in hand lifts off the page.
 */
export function ComposerQueue({
  items,
  onReorder,
  onSteer,
  onEdit,
  onRemove,
  running = true,
  paused = false,
  name = 'the assistant',
  className,
}: ComposerQueueProps) {
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<Drag>();
  const [said, setSaid] = useState('');
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    if (!settling) return;
    const frame = requestAnimationFrame(() => setSettling(false));
    return () => cancelAnimationFrame(frame);
  }, [settling]);

  const start = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0 || items.length < 2) return;
    const rows = [...(list.current?.children ?? [])].map((el, i) => {
      const box = el.getBoundingClientRect();
      return { id: items[i]?.id ?? '', top: box.top, height: box.height };
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    const from = rows.findIndex((r) => r.id === id);
    setDrag({ id, pointer: event.pointerId, startY: event.clientY, dy: 0, rows, over: from });
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const next = { ...drag, dy: event.clientY - drag.startY };
    setDrag({ ...next, over: landing(next) });
  };
  const drop = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const from = items.findIndex((i) => i.id === drag.id);
    setDrag(undefined);
    // Let go where it was: it springs back. Somewhere new: it's already there.
    if (from >= 0 && drag.over !== from) {
      setSettling(true);
      onReorder(moved(items, from, drag.over).map((i) => i.id));
      setSaid(`Moved to ${drag.over + 1} of ${items.length}.`);
    }
  };
  const nudge = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : -1;
    if (to < 0 || to >= items.length) return;
    event.preventDefault();
    onReorder(moved(items, index, to).map((i) => i.id));
    setSaid(`Moved to ${to + 1} of ${items.length}.`);
    // Focus stays on the same message's handle, wherever it went.
    const id = items[index]?.id;
    requestAnimationFrame(() =>
      list.current?.querySelector<HTMLButtonElement>(`[data-handle="${id}"]`)?.focus(),
    );
  };

  /** How far a row moves aside for the one being dragged past it. */
  const shift = (index: number): number => {
    if (!drag) return 0;
    const from = drag.rows.findIndex((r) => r.id === drag.id);
    const height = (drag.rows[from]?.height ?? 0) + 4;
    if (index === from) return drag.dy;
    if (from < index && index <= drag.over) return -height;
    if (drag.over <= index && index < from) return height;
    return 0;
  };

  const note: ReactNode = paused
    ? `Waiting: the reply was stopped. Send one when you’re ready.`
    : items.length > 1
      ? `Sends one at a time when ${name} is done · drag to reorder`
      : `Sends when ${name} is done`;

  return (
    <section
      className={cx(styles.queue, className)}
      aria-label={items.length > 1 ? `${items.length} messages waiting` : 'A message waiting'}
      data-dragging={drag ? '' : undefined}
      data-settling={settling || undefined}
    >
      <ol ref={list} className={styles.list}>
        {items.map((item, index) => {
          const lifted = drag?.id === item.id;
          const steer = running && !paused;
          return (
            <li
              key={item.id}
              className={styles.item}
              data-lifted={lifted || undefined}
              style={{ '--q-shift': `${shift(index)}px` } as CSSProperties}
            >
              {items.length > 1 ? (
                <button
                  type="button"
                  className={styles.handle}
                  data-handle={item.id}
                  aria-label={`Move “${item.text.slice(0, 40)}”, ${index + 1} of ${items.length}. Arrow keys move it.`}
                  onPointerDown={(e) => start(e, item.id)}
                  onPointerMove={move}
                  onPointerUp={drop}
                  onPointerCancel={drop}
                  onKeyDown={(e) => nudge(e, index)}
                >
                  <GripVertical aria-hidden />
                </button>
              ) : (
                <span className={styles.place} aria-hidden>
                  1
                </span>
              )}
              <span className={styles.text}>
                <span className={styles.message}>{item.text}</span>
                {item.meta && <span className={styles.meta}>{item.meta}</span>}
              </span>
              <span className={styles.actions}>
                <IconButton
                  size="sm"
                  shape="circle"
                  variant="soft"
                  tone="accent"
                  className={styles.steer}
                  label={
                    steer
                      ? `Steer: stop ${name} and send this now`
                      : index === 0
                        ? 'Send this now'
                        : 'Send this now, before the others'
                  }
                  onClick={() => onSteer(item.id)}
                >
                  {steer ? <Zap /> : <Send />}
                </IconButton>
                <IconButton
                  size="sm"
                  shape="circle"
                  label="Edit: take it back into the box"
                  onClick={() => onEdit(item.id)}
                >
                  <Pencil />
                </IconButton>
                <IconButton
                  size="sm"
                  shape="circle"
                  label="Don’t send it"
                  onClick={() => onRemove(item.id)}
                >
                  <X />
                </IconButton>
              </span>
            </li>
          );
        })}
      </ol>
      <p className={styles.note} data-paused={paused || undefined}>
        {note}
      </p>
      <span className="nc-visually-hidden" role="status" aria-live="polite">
        {said}
      </span>
    </section>
  );
}
