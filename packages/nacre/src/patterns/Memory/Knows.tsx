import { Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { IconButton } from '../../components/IconButton';
import { Progress } from '../../components/Progress';
import { cx } from '../../utils/cx';
import { SWIPE_COMMIT_SHARE, SWIPE_SLOP, swipeOffset, swipeOutcome } from '../ChatList/swipe';
import styles from './Knows.module.css';
import type { MemoryKindName } from './Memory';

/*
 * What Conch knows, at a glance (ADR 0032, ADR 0097). Conch learns and tidies
 * quietly, so the page is not a report of what it did: it is what it knows,
 * in one calm summary and one list you can search, change and forget.
 */

/** The order kinds are shown in, everywhere: what you like first. */
export const memoryKindOrder: readonly MemoryKindName[] = [
  'preference',
  'person',
  'project',
  'fact',
];

/** Plural names, for counts and filters. */
export const memoryKindPlurals: Record<MemoryKindName, string> = {
  preference: 'Preferences',
  person: 'People',
  project: 'Projects',
  fact: 'Facts',
};

const singular: Record<MemoryKindName, string> = {
  preference: 'preference',
  person: 'person',
  project: 'project',
  fact: 'fact',
};

const counted = (n: number, kind: MemoryKindName) =>
  `${n} ${n === 1 ? singular[kind] : kind === 'person' ? 'people' : `${singular[kind]}s`}`;

export interface MemoryGlanceProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** How many memories of each kind. */
  counts: Partial<Record<MemoryKindName, number>>;
  /** The kind the list shows, or `null` for everything. */
  filter?: MemoryKindName | null;
  /** Pressing a kind shows only it; pressing it again shows everything. */
  onFilterChange?: (kind: MemoryKindName | null) => void;
  /** Learning from chats is on: the dot breathes. Off: it rests. */
  learning?: boolean;
  /** One short line beside the dot: “Learning quietly · tidied last night”. */
  status?: ReactNode;
}

/**
 * The summary at the top of Memory: how much Conch knows, as one number and
 * one bar, coloured by kind. The kinds under it are also the filter. A
 * breathing dot says it's learning, quietly; no report of what it did.
 */
export function MemoryGlance({
  counts,
  filter = null,
  onFilterChange,
  learning = true,
  status,
  className,
  ...props
}: MemoryGlanceProps) {
  const titleId = useId();
  const total = memoryKindOrder.reduce((sum, k) => sum + (counts[k] ?? 0), 0);
  const present = memoryKindOrder.filter((k) => (counts[k] ?? 0) > 0);
  const described = present.map((k) => counted(counts[k] ?? 0, k)).join(', ');
  return (
    <section
      aria-labelledby={titleId}
      className={cx(styles.glance, className)}
      data-empty={total === 0 || undefined}
      data-lustre=""
      {...props}
    >
      <div className={styles.glanceTop}>
        <p className={styles.total} id={titleId}>
          <span className={styles.number}>{total.toLocaleString()}</span>{' '}
          <span className={styles.noun}>{total === 1 ? 'memory' : 'memories'}</span>
        </p>
        {status && (
          <p className={styles.status} data-learning={learning || undefined}>
            <span className={styles.pulse} aria-hidden />
            <span>{status}</span>
          </p>
        )}
      </div>
      <div
        className={styles.bar}
        role="img"
        aria-label={total ? described : 'Nothing remembered yet'}
        data-filtered={filter ?? undefined}
      >
        {present.map((k) => (
          <span
            key={k}
            className={styles.segment}
            data-kind={k}
            data-dim={(filter && filter !== k) || undefined}
            style={{ '--kg-share': counts[k] ?? 0 } as CSSProperties}
          />
        ))}
      </div>
      {total > 0 && (
        <div className={styles.kinds} role="group" aria-label="Show only">
          {memoryKindOrder.map((k) => {
            const n = counts[k] ?? 0;
            const on = filter === k;
            return (
              <button
                key={k}
                type="button"
                className={styles.kind}
                data-kind={k}
                aria-pressed={on}
                disabled={!n && !on}
                onClick={() => onFilterChange?.(on ? null : k)}
              >
                <span className={styles.dot} aria-hidden />
                <span>{memoryKindPlurals[k]}</span>
                <span className={styles.count}>{n}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** The list of memories: one quiet, inset group. */
export function MemoryCells({ className, ...props }: ComponentProps<'ul'>) {
  return <ul className={cx(styles.cells, className)} {...props} />;
}

export interface MemoryCellProps extends Omit<ComponentProps<'li'>, 'children'> {
  /** What it remembers; an editor while `editing`. */
  children: ReactNode;
  /** Its words as plain text, for labels (“Forget: …”). */
  label: string;
  kind: MemoryKindName;
  /** One short line under it: “Learned in a chat · 2 days ago”. */
  meta?: ReactNode;
  /** Pressing the words, or the pencil, edits it. */
  onEdit?: () => void;
  /**
   * The trash, or a swipe on a phone. The cell folds away first, then this
   * runs; the page offers Undo.
   */
  onForget?: () => void;
  editing?: boolean;
  /** Its place in the list: the first few rise in one after another. */
  index?: number;
}

const prefersStill = (el: Element | null) =>
  Boolean(el?.closest('[data-nacre-motion="reduced"]')) ||
  (typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);

/**
 * One memory: a dot for its kind, its words, and a quiet line about where it
 * came from. Edit and Forget show on hover or focus; on a phone, press the
 * words to change them and swipe to forget. Forgetting folds the cell away
 * before it goes, so the list never jumps.
 */
export function MemoryCell({
  children,
  label,
  kind,
  meta,
  onEdit,
  onForget,
  editing = false,
  index = 0,
  className,
  style,
  ...props
}: MemoryCellProps) {
  const ref = useRef<HTMLLIElement>(null);
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);
  const leave = () => setLeaving(true);
  const swipe = useSwipeToForget(ref, Boolean(onForget) && !editing && !leaving, leave);

  useEffect(() => {
    if (!leaving) return;
    const finish = () => {
      if (done.current) return;
      done.current = true;
      onForget?.();
    };
    if (prefersStill(ref.current)) return finish();
    const timer = window.setTimeout(finish, 420);
    return () => window.clearTimeout(timer);
    // `onForget` is read once, when the fold ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  return (
    <li
      ref={ref}
      className={cx(styles.cell, className)}
      data-kind={kind}
      data-editing={editing || undefined}
      data-leaving={leaving || undefined}
      data-swiping={swipe.phase === 'idle' ? undefined : swipe.phase}
      data-swipeable={swipe.enabled || undefined}
      style={{ '--kc-i': Math.min(index, 12), ...style } as CSSProperties}
      onPointerDown={swipe.down}
      onPointerMove={swipe.move}
      onPointerUp={swipe.up}
      onPointerCancel={swipe.cancel}
      onClickCapture={(e) => {
        // The click at the end of a swipe isn't a press.
        if (swipe.consumeClick()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      {...props}
    >
      {onForget && (
        <div className={styles.swipeBack} data-armed={swipe.armed || undefined} aria-hidden>
          <Trash2 />
          <span>Forget</span>
        </div>
      )}
      <div className={styles.cellFold}>
        <div className={styles.cellRow}>
          <span className={styles.dot} data-kind={kind} aria-hidden />
          <div className={styles.cellBody}>
            <span className="nc-visually-hidden">{singular[kind]}: </span>
            {editing || !onEdit ? (
              <div className={styles.words}>{children}</div>
            ) : (
              <button
                type="button"
                className={cx(styles.words, styles.wordsButton)}
                onClick={onEdit}
                aria-label={`Edit: ${label}`}
              >
                {children}
              </button>
            )}
            {meta && !editing && <p className={styles.meta}>{meta}</p>}
          </div>
          {(onEdit || onForget) && !editing && (
            <div className={styles.cellActions}>
              {onEdit && (
                <IconButton size="sm" label={`Edit: ${label}`} tooltip={false} onClick={onEdit}>
                  <Pencil />
                </IconButton>
              )}
              {onForget && (
                <IconButton
                  size="sm"
                  label={`Forget: ${label}`}
                  tooltip={false}
                  onClick={leave}
                  disabled={leaving}
                >
                  <Trash2 />
                </IconButton>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export interface MemoryAddProps extends Omit<ComponentProps<'li'>, 'children' | 'onClick'> {
  /** What would be remembered. */
  text: string;
  onAdd: () => void;
  busy?: boolean;
}

/** At the top of the list while you type: remember what you typed, in one press (or Enter). */
export function MemoryAdd({ text, onAdd, busy = false, className, ...props }: MemoryAddProps) {
  return (
    <li className={cx(styles.add, className)} {...props}>
      <button type="button" className={styles.addButton} onClick={onAdd} disabled={busy}>
        <span className={styles.addIcon} aria-hidden>
          <Plus />
        </span>
        <span className={styles.addWords}>
          Remember <q>{text}</q>
        </span>
      </button>
    </li>
  );
}

export type MeaningHintState = 'offer' | 'getting' | 'indexing' | 'problem';

export interface MeaningHintProps extends Omit<ComponentProps<'div'>, 'title'> {
  state: MeaningHintState;
  /** The download, in words: “23 MB”. */
  size?: string;
  progress?: number;
  indexed?: number;
  total?: number;
  /** Why getting it failed, in a sentence. */
  problem?: ReactNode;
  /** Get it, or Try again. */
  action?: ReactNode;
}

/**
 * Under the search: the one thing that makes it smarter (ADR 0041), in a
 * single line. Nothing at all once search understands meaning.
 */
export function MeaningHint({
  state,
  size,
  progress,
  indexed = 0,
  total = 0,
  problem,
  action,
  className,
  ...props
}: MeaningHintProps) {
  const words = {
    offer: `Search by meaning, too${size ? ` · ${size}, stays on this computer` : ''}`,
    getting: 'Getting search by meaning…',
    indexing: 'Making memories searchable by meaning…',
    problem: problem ?? 'Couldn’t get search by meaning.',
  }[state];
  return (
    <div className={cx(styles.hint, className)} data-state={state} {...props}>
      <Sparkles aria-hidden className={styles.hintIcon} />
      <span className={styles.hintWords} aria-live="polite">
        {words}
      </span>
      {/* The words say what's happening, so the bar needs only a name. */}
      {state === 'getting' && (
        <Progress
          className={styles.hintProgress}
          size="sm"
          value={progress ?? null}
          aria-label="Downloaded"
        />
      )}
      {state === 'indexing' && (
        <Progress
          className={styles.hintProgress}
          size="sm"
          value={indexed}
          max={Math.max(total, 1)}
          aria-label="Memories ready"
        />
      )}
      {action && <span className={styles.hintAction}>{action}</span>}
    </div>
  );
}

/**
 * A swipe towards the start (left, in English) forgets, on touch only. The
 * cell follows the finger over red; far enough, or a quick flick, and
 * letting go forgets it. A finger that moves up or down first is scrolling.
 */
function useSwipeToForget(
  ref: RefObject<HTMLLIElement | null>,
  enabled: boolean,
  onForget: () => void,
) {
  const track = useRef<{
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
  } | null>(null);
  const suppress = useRef(false);
  const [phase, setPhase] = useState<'idle' | 'tracking' | 'settling'>('idle');
  const [armed, setArmed] = useState(false);

  const place = (offset: number, rtl: boolean) =>
    ref.current?.style.setProperty('--kc-swipe-x', `${rtl ? -offset : offset}px`);

  const settle = (offset: number, rtl: boolean) => {
    setPhase('settling');
    requestAnimationFrame(() => {
      place(offset, rtl);
      window.setTimeout(() => {
        setPhase('idle');
        setArmed(false);
      }, 420);
    });
  };

  return {
    phase,
    armed,
    enabled,
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
      const raw = e.clientX - t.x0;
      const dx = t.rtl ? -raw : raw;
      const dy = e.clientY - t.y0;
      if (!t.tracking) {
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
      const offset = swipeOffset(dx, t.width, { start: false, end: true });
      t.offset = offset;
      place(offset, t.rtl);
      const dt = e.timeStamp - t.lastT;
      if (dt > 0) t.velocity = 0.7 * ((dx - t.lastDx) / dt) + 0.3 * t.velocity;
      t.lastDx = dx;
      t.lastT = e.timeStamp;
      setArmed(offset < 0 && Math.abs(offset) >= t.width * SWIPE_COMMIT_SHARE);
    },
    up(e: PointerEvent<HTMLElement>) {
      const t = track.current;
      if (!t || e.pointerId !== t.id) return;
      track.current = null;
      if (!t.tracking) return;
      window.setTimeout(() => {
        suppress.current = false;
      }, 400);
      if (swipeOutcome(t.offset, t.velocity, t.width) !== 'end') return settle(0, t.rtl);
      if (typeof navigator !== 'undefined') navigator.vibrate?.(8);
      setArmed(true);
      settle(-t.width, t.rtl);
      onForget();
    },
    cancel(e: PointerEvent<HTMLElement>) {
      const t = track.current;
      if (!t || e.pointerId !== t.id) return;
      track.current = null;
      if (t.tracking) settle(0, t.rtl);
    },
  };
}
