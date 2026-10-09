import { ChevronLeft } from 'lucide-react';
import { type DropdownMenu as MenuPrimitive } from 'radix-ui';
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';

import { useMediaQuery } from '../../utils/useMediaQuery';
import styles from './menu.module.css';

/**
 * Nested menus on a phone: drilling in.
 *
 * A side submenu needs room beside the menu and a pointer to steer into it; on
 * a phone it opens over the menu, or off the screen. So there, choosing an
 * item with more inside slides the same popover's content to reveal the
 * nested choices, with a back row (‹ Answering) at its top. The menu only
 * ever holds the level you're on, so arrows, typeahead and a screen reader
 * see that level alone; the level you left plays out as a still picture of
 * itself while it slides away.
 */

/** A phone, or a screen used only by touch: where a menu drills in. */
export const DRILL_QUERY = '(max-width: 40rem), (hover: none) and (pointer: coarse)';

/** How a menu shows what's nested in it. `auto` drills in on a phone and opens beside on a desktop. */
export type SubmenuMode = 'auto' | 'side' | 'drill';

type ItemComponent = ComponentType<ComponentProps<typeof MenuPrimitive.Item>>;

interface Level {
  id: string;
  /** What the back row says: the trigger's words, unless the submenu says otherwise. */
  label: string;
}

interface Drill {
  /** The levels open below the menu's own, outermost first. */
  path: readonly Level[];
  top: string;
  host: HTMLElement | null;
  open: (level: Level, by: 'keyboard' | 'pointer') => void;
  back: () => void;
  Item: ItemComponent;
}

const ROOT = 'root';
const DrillContext = createContext<Drill | null>(null);
const LevelContext = createContext<string>(ROOT);
const SubContext = createContext<string | null>(null);

/** The drill-in state, or null while submenus open beside. */
export const useDrill = () => useContext(DrillContext);

/**
 * Whether a part of the menu is on the level being shown. Parts on another
 * level draw nothing, so they're out of the arrows' and typeahead's way.
 */
export function useOnShownLevel(): boolean {
  const drill = useContext(DrillContext);
  const level = useContext(LevelContext);
  return !drill || drill.top === level;
}

export function useSubmenuMode(mode: SubmenuMode): 'side' | 'drill' {
  const narrow = useMediaQuery(DRILL_QUERY);
  if (mode === 'auto') return narrow ? 'drill' : 'side';
  return mode;
}

const prefersStill = (el: Element) =>
  el.closest('[data-nacre-motion="reduced"]') !== null ||
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

// A level's own choices: every item but its back row.
const CHOICE = ['menuitem', 'menuitemcheckbox', 'menuitemradio']
  .map((role) => `[role="${role}"]:not([data-menu-back]):not([data-disabled])`)
  .join(',');

function timing(el: Element): KeyframeAnimationOptions {
  const css = getComputedStyle(el);
  const duration = parseFloat(css.getPropertyValue('--nc-spring-snappy-duration')) || 400;
  const easing = css.getPropertyValue('--nc-spring-snappy').trim() || 'ease-out';
  return { duration, easing };
}

interface Pending {
  dir: 'in' | 'out';
  ghost: HTMLElement;
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * The drill-in state for one menu's content. Its `ref` and key handlers go
 * on the Radix content, and `render` lays out the levels inside it.
 */
export function useDrillContent(Item: ItemComponent, enabled: boolean) {
  const [path, setPath] = useState<readonly Level[]>([]);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const pending = useRef<Pending | null>(null);
  const by = useRef<'keyboard' | 'pointer'>('keyboard');
  const cameFrom = useRef<string | null>(null);
  const top = path.at(-1)?.id ?? ROOT;

  const panelOf = (id: string) =>
    contentRef.current?.querySelector<HTMLElement>(`[data-menu-level="${CSS.escape(id)}"]`) ?? null;

  // Before the level changes: a still picture of the level being left, and the size of it all.
  const snapshot = useCallback(
    (dir: 'in' | 'out') => {
      const content = contentRef.current;
      const from = panelOf(path.at(-1)?.id ?? ROOT);
      if (!content || !from || typeof content.animate !== 'function' || prefersStill(content)) {
        pending.current = null;
        return;
      }
      const ghost = from.cloneNode(true) as HTMLElement;
      ghost.removeAttribute('data-menu-level');
      ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
      pending.current = {
        dir,
        ghost,
        top: from.offsetTop,
        left: from.offsetLeft,
        width: from.offsetWidth,
        height: content.offsetHeight,
      };
      // The menu keeps at least the width it opened at, so it never jumps sideways.
      content.style.minInlineSize = `${content.offsetWidth}px`;
    },
    [path],
  );

  const open = useCallback(
    (level: Level, how: 'keyboard' | 'pointer') => {
      by.current = how;
      cameFrom.current = null;
      snapshot('in');
      setPath((p) => [...p, level]);
    },
    [snapshot],
  );

  const back = useCallback(() => {
    if (path.length === 0) return;
    by.current = 'keyboard';
    cameFrom.current = path.at(-1)?.id ?? null;
    snapshot('out');
    setPath((p) => p.slice(0, -1));
  }, [path, snapshot]);

  // After it changed: the focus, then the slide.
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const to = panelOf(top);
    // Back out: to the row that opened the level. In: its first choice, or
    // the menu itself after a press, as when the menu first opened.
    if (cameFrom.current) {
      content
        .querySelector<HTMLElement>(`[data-menu-opens="${CSS.escape(cameFrom.current)}"]`)
        ?.focus();
    } else if (path.length > 0) {
      const first = to?.querySelector<HTMLElement>(CHOICE);
      if (by.current === 'keyboard' && first) first.focus();
      else content.focus();
    }
    const move = pending.current;
    pending.current = null;
    if (!move || !to) return;
    content.scrollTop = 0;
    const { ghost, dir } = move;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    if (styles.ghost) ghost.classList.add(styles.ghost);
    Object.assign(ghost.style, {
      top: `${move.top}px`,
      left: `${move.left}px`,
      width: `${move.width}px`,
    });
    content.append(ghost);
    const height = content.offsetHeight;
    const t = timing(content);
    const away = dir === 'in' ? '-100%' : '100%';
    const from = dir === 'in' ? '100%' : '-100%';
    const moves = [
      ghost.animate(
        [
          { transform: 'translateX(0)', opacity: 1 },
          { transform: `translateX(${away})`, opacity: 0 },
        ],
        t,
      ),
      to.animate(
        [
          { transform: `translateX(${from})`, opacity: 0 },
          { transform: 'translateX(0)', opacity: 1 },
        ],
        t,
      ),
      content.animate([{ blockSize: `${move.height}px` }, { blockSize: `${height}px` }], t),
    ];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ghost.remove();
    };
    void Promise.allSettled(moves.map((m) => m.finished)).then(finish);
    return () => {
      moves.forEach((m) => m.cancel());
      finish();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const drill = useMemo<Drill | null>(
    () => (enabled ? { path, top, host, open, back, Item } : null),
    [enabled, path, top, host, open, back, Item],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!drill || path.length === 0) return;
    const rtl = event.currentTarget.getAttribute('dir') === 'rtl';
    if (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) {
      event.preventDefault();
      back();
    }
  };

  /** Escape steps back a level before it closes the menu. */
  const onEscapeKeyDown = (event: globalThis.KeyboardEvent) => {
    if (!drill || path.length === 0) return;
    event.preventDefault();
    back();
  };

  // A menu that closed opens again at its own level.
  const ref = useCallback((el: HTMLElement | null) => {
    contentRef.current = el;
    if (!el) setPath((p) => (p.length ? [] : p));
  }, []);

  const render = (children: ReactNode) =>
    enabled ? (
      <DrillContext.Provider value={drill}>
        <div className={styles.level} data-menu-level={ROOT} hidden={path.length > 0}>
          {children}
        </div>
        <div ref={setHost} />
      </DrillContext.Provider>
    ) : (
      children
    );

  return {
    drilling: enabled,
    ref,
    onKeyDown,
    onEscapeKeyDown,
    render,
  };
}

/** One ref from two, kept the same between renders so neither sees a passing `null`. */
export function useMergedRef<T>(a: Ref<T> | undefined, b: Ref<T> | undefined) {
  return useMemo(
    () => (node: T | null) => {
      for (const ref of [a, b]) {
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }
    },
    [a, b],
  );
}

/** A submenu's state when drilling: its own id, for its trigger and its content. */
export function DrillSub({ children }: { children?: ReactNode }) {
  const id = useId();
  return <SubContext.Provider value={id}>{children}</SubContext.Provider>;
}

export const useSubId = () => useContext(SubContext);

/** The row that opens a submenu, when drilling: an ordinary item that opens the level in place. */
export function DrillTrigger({
  className,
  inset,
  disabled,
  textValue,
  children,
}: {
  className?: string;
  inset?: boolean;
  disabled?: boolean;
  textValue?: string;
  children: ReactNode;
}) {
  const drill = useContext(DrillContext);
  const id = useContext(SubContext);
  if (!drill || !id) return null;
  const { Item } = drill;
  const label = (el: HTMLElement) => textValue ?? el.textContent?.trim() ?? '';
  return (
    <Item
      className={className}
      data-inset={inset || undefined}
      disabled={disabled}
      textValue={textValue}
      aria-haspopup="menu"
      aria-expanded={false}
      data-menu-opens={id}
      onSelect={(event) => {
        event.preventDefault();
        drill.open({ id, label: label(event.currentTarget as HTMLElement) }, 'pointer');
      }}
      onKeyDown={(event) => {
        const rtl = event.currentTarget.closest('[dir="rtl"]') !== null;
        if (['Enter', ' ', rtl ? 'ArrowLeft' : 'ArrowRight'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          drill.open({ id, label: label(event.currentTarget) }, 'keyboard');
        }
      }}
    >
      {children}
    </Item>
  );
}

/** A submenu's choices, when drilling: a level of the same menu, with a way back at its top. */
export function DrillLevel({
  backLabel,
  className,
  children,
}: {
  backLabel?: string;
  className?: string;
  children?: ReactNode;
}) {
  const drill = useContext(DrillContext);
  const id = useContext(SubContext);
  if (!drill || !id) return null;
  const level = drill.path.find((l) => l.id === id);
  if (!level || !drill.host) return null;
  const shown = drill.top === id;
  const label = backLabel ?? level.label;
  const { Item } = drill;
  return createPortal(
    <LevelContext.Provider value={id}>
      <div
        role="group"
        aria-label={label}
        className={[styles.level, className].filter(Boolean).join(' ')}
        data-menu-level={id}
        hidden={!shown}
      >
        {shown && (
          <Item
            className={styles.item}
            data-menu-back=""
            aria-label={`Back from ${label}`}
            textValue={label}
            onSelect={(event) => {
              event.preventDefault();
              drill.back();
            }}
          >
            <span className={styles.icon} aria-hidden>
              <ChevronLeft />
            </span>
            <span className={styles.label}>{label}</span>
          </Item>
        )}
        {shown && <div role="separator" className={styles.separator} />}
        {children}
      </div>
    </LevelContext.Provider>,
    drill.host,
  );
}
