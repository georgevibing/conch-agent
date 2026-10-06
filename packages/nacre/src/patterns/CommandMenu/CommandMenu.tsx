import { ArrowLeft, Check, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { IconButton } from '../../components/IconButton';
import { Kbd } from '../../components/Kbd';
import { cx } from '../../utils/cx';
import styles from './CommandMenu.module.css';
import { filterCommands, type CommandMatch } from './match';

export interface CommandItem {
  id: string;
  /** What's typed: a command without its slash ("effort"), or one of its values ("high"). */
  name: string;
  /**
   * Shown instead of `name` when what's typed isn't what people read: a model's
   * name ("Opus 4.6") for its id. Matched as well as `name`.
   */
  title?: string;
  description?: string;
  /** e.g. "[instructions]" — shown as ghost text after the name. */
  argumentHint?: string;
  group: string;
  icon?: ReactNode;
  keywords?: string[];
  /**
   * The one in use now (this chat's thinking level): marked with a tick and
   * “Current”, and where the selection starts while nothing is typed.
   */
  current?: boolean;
}

/** What the menu is choosing for, once a command is picked: its values. */
export interface CommandMenuHeading {
  /** The command, as typed: "effort". */
  name: string;
  /** What it does, in a few words: "How hard the model thinks". */
  description?: string;
}

export interface UseCommandMenuOptions {
  items: CommandItem[];
  /** Text typed after "/" (or after the command, for its values), or `null` when closed. */
  query: string | null;
  onSelect(item: CommandItem): void;
  onClose(): void;
  /** What the list holds, as its accessible name. Default “Commands”. */
  label?: string;
  /**
   * Choosing a command's value: the menu says which command, and offers a way
   * back to every command (`onBack`).
   */
  heading?: CommandMenuHeading;
  onBack?(): void;
  /**
   * The first match is chosen by Enter or Tab (default). Off where the items
   * are only suggestions for free text (a goal): Enter sends what was typed
   * until an arrow key picks one.
   */
  autoActivate?: boolean;
  /** What to say when nothing matches. Default “No command called /…”. */
  empty?: ReactNode;
}

export interface CommandMenuProps {
  id: string;
  open: boolean;
  query: string;
  matches: CommandMatch[];
  activeId?: string;
  onActivate(id: string): void;
  onSelect(item: CommandItem): void;
  label?: string;
  heading?: CommandMenuHeading;
  onBack?(): void;
  onClose?(): void;
  empty?: ReactNode;
  className?: string;
}

const optionId = (menuId: string, itemId: string) => `${menuId}-opt-${itemId}`;

/**
 * State and keyboard handling for a slash-command menu driven from a text
 * field. Focus never leaves the field: the menu is announced through
 * `aria-activedescendant`, and arrow keys, Enter/Tab and Escape are claimed
 * only while it's open. The same menu then offers the chosen command's values
 * (`heading`), so `/effort` goes on to the thinking levels, the current one
 * marked.
 */
export function useCommandMenu({
  items,
  query,
  onSelect,
  onClose,
  label = 'Commands',
  heading,
  onBack,
  autoActivate = true,
  empty,
}: UseCommandMenuOptions) {
  const id = useId();
  const open = query !== null;
  const matches = useMemo(() => (open ? filterCommands(items, query) : []), [items, query, open]);
  /** Where the selection starts: the current value while nothing is typed, else the best match. */
  const start = (): number => {
    if (!autoActivate) return -1;
    if (!query) {
      const current = matches.findIndex((m) => m.item.current);
      if (current !== -1) return current;
    }
    return 0;
  };
  const [activeIndex, setActiveIndex] = useState(start);

  // A new query, or another list (a command's values) → start again. Derived during render.
  const key = `${heading?.name ?? ''}\u0000${query ?? ''}\u0000${matches.length}`;
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setActiveIndex(start());
  }

  const active =
    activeIndex < 0 ? undefined : matches[Math.min(activeIndex, matches.length - 1)]?.item;

  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (!open || event.nativeEvent.isComposing) return false;
    const count = matches.length;
    switch (event.key) {
      case 'ArrowDown':
        if (!count) return false;
        event.preventDefault();
        setActiveIndex((i) => (i < 0 ? 0 : (i + 1) % count));
        return true;
      case 'ArrowUp':
        if (!count) return false;
        event.preventDefault();
        setActiveIndex((i) => (i <= 0 ? count - 1 : i - 1));
        return true;
      case 'Enter':
      case 'Tab':
        if (!active || event.shiftKey) return false;
        event.preventDefault();
        onSelect(active);
        return true;
      case 'Escape':
        event.preventDefault();
        onClose();
        return true;
      default:
        return false;
    }
  };

  return {
    open,
    filtered: matches.map((m) => m.item),
    activeId: active?.id,
    onKeyDown,
    inputProps: {
      'aria-autocomplete': 'list' as const,
      // Only while there is a list: nothing matching draws a message instead.
      'aria-controls': open && matches.length ? `${id}-list` : undefined,
      'aria-activedescendant': open && active ? optionId(id, active.id) : undefined,
    },
    menuProps: {
      id,
      open,
      query: query ?? '',
      matches,
      activeId: active?.id,
      onActivate: (itemId: string) =>
        setActiveIndex(matches.findIndex((m) => m.item.id === itemId)),
      onSelect,
      label,
      ...(heading && { heading }),
      ...(onBack && { onBack }),
      onClose,
      ...(empty !== undefined && { empty }),
    } satisfies CommandMenuProps,
  };
}

function Highlighted({ text, hits }: { text: string; hits: number[] }) {
  if (!hits.length) return <>{text}</>;
  const set = new Set(hits);
  return (
    <>
      {[...text].map((ch, i) =>
        set.has(i) ? (
          <mark key={i} className={styles.hit}>
            {ch}
          </mark>
        ) : (
          ch
        ),
      )}
    </>
  );
}

/** A press that keeps focus (and a phone's keyboard) in the text field. */
const keepFocus = (event: { preventDefault(): void }) => event.preventDefault();

/**
 * The slash-command list. Render inside the composer (`overlay`), fed by
 * `useCommandMenu`. On a phone it's a sheet above the keyboard: rows big
 * enough for a thumb, descriptions on their own line, and a close button,
 * since there's no Escape key.
 */
export function CommandMenu({
  id,
  open,
  query,
  matches,
  activeId,
  onActivate,
  onSelect,
  label = 'Commands',
  heading,
  onBack,
  onClose,
  empty,
  className,
}: CommandMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeId) return;
    document.getElementById(optionId(id, activeId))?.scrollIntoView?.({ block: 'nearest' });
  }, [id, activeId]);

  if (!open) return null;

  const groups: { name: string; items: CommandMatch[] }[] = [];
  for (const match of matches) {
    const group = groups.find((g) => g.name === match.item.group);
    if (group) group.items.push(match);
    else groups.push({ name: match.item.group, items: [match] });
  }
  // A list of values is one group: its label would only repeat the heading.
  const showGroups = !heading || groups.length > 1;
  const count = matches.length;

  return (
    <div className={cx(styles.menu, className)} data-values={heading ? '' : undefined}>
      {(heading || onClose) && (
        <div className={styles.header} data-heading={heading ? '' : undefined}>
          {heading && onBack && (
            <IconButton
              label="All commands"
              tooltip={false}
              size="sm"
              className={styles.headerButton}
              onPointerDown={keepFocus}
              onClick={onBack}
            >
              <ArrowLeft />
            </IconButton>
          )}
          {!heading && (
            <span className={styles.headerTitle} aria-hidden>
              {label}
            </span>
          )}
          {heading && (
            <div className={styles.heading}>
              <span className={styles.headingName}>/{heading.name}</span>
              {heading.description && (
                <span className={styles.headingDescription}>{heading.description}</span>
              )}
            </div>
          )}
          {onClose && (
            <IconButton
              label="Close commands"
              tooltip={false}
              size="sm"
              className={cx(styles.headerButton, styles.close)}
              onPointerDown={keepFocus}
              onClick={onClose}
            >
              <X />
            </IconButton>
          )}
        </div>
      )}
      {count === 0 ? (
        <div className={styles.empty} role="status">
          {empty ?? (
            <>
              No command called <code className={styles.emptyName}>/{query}</code>
            </>
          )}
        </div>
      ) : (
        <>
          <div
            id={`${id}-list`}
            ref={listRef}
            role="listbox"
            aria-label={label}
            // What scrolls must be reachable from the keyboard (WCAG 2.1.1), even
            // though the field drives this list: arrows move the selection and
            // scroll it into view, and Tab here chooses rather than moving focus.
            tabIndex={0}
            className={styles.list}
          >
            {groups.map((group, index) => (
              <div
                key={group.name}
                role="group"
                // By place, not name: a name with a space would be two ids.
                aria-labelledby={`${id}-g-${index}`}
                className={styles.group}
              >
                <div
                  id={`${id}-g-${index}`}
                  className={styles.groupLabel}
                  data-hidden={showGroups ? undefined : ''}
                >
                  {group.name}
                </div>
                {group.items.map(({ item, hits }) => (
                  // Options are driven by the text field (aria-activedescendant); presses select.
                  // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                  <div
                    key={item.id}
                    id={optionId(id, item.id)}
                    role="option"
                    tabIndex={-1}
                    aria-selected={item.id === activeId}
                    data-active={item.id === activeId || undefined}
                    data-current={item.current || undefined}
                    className={styles.option}
                    // Only a mouse moves the selection: a finger scrolling the list mustn't.
                    onPointerMove={(event) =>
                      event.pointerType === 'mouse' && item.id !== activeId && onActivate(item.id)
                    }
                    onPointerDown={keepFocus}
                    onClick={() => onSelect(item)}
                  >
                    <span className={styles.icon} aria-hidden>
                      {item.current ? (
                        <Check />
                      ) : (
                        (item.icon ?? <span className={styles.iconDot} />)
                      )}
                    </span>
                    <span className={styles.main}>
                      <span className={styles.line}>
                        <span className={cx(styles.name, item.title && styles.title)}>
                          {!heading && !item.title && '/'}
                          <Highlighted text={item.title ?? item.name} hits={hits} />
                        </span>
                        {item.argumentHint && (
                          <span className={styles.hint}>{item.argumentHint}</span>
                        )}
                        {item.current && <span className={styles.current}>Current</span>}
                      </span>
                      {item.description && (
                        <span className={styles.description}>{item.description}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className={styles.footer} aria-hidden>
            <span>
              <Kbd keys="up" size="sm" />
              <Kbd keys="down" size="sm" /> to move
            </span>
            <span>
              <Kbd keys="tab" size="sm" /> or <Kbd keys="enter" size="sm" /> to choose
            </span>
            <span>
              <Kbd keys="esc" size="sm" /> to close
            </span>
          </div>
        </>
      )}
      <span className="nc-visually-hidden" aria-live="polite">
        {count === 0 ? '' : count === 1 ? '1 result' : `${count} results`}
      </span>
    </div>
  );
}
