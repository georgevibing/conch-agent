import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cx } from '../../utils/cx';
import styles from './CommandMenu.module.css';
import { filterCommands, type CommandMatch } from './match';

export interface CommandItem {
  id: string;
  /** Without the leading slash. */
  name: string;
  description?: string;
  /** e.g. "[instructions]" — shown as ghost text after the name. */
  argumentHint?: string;
  group: string;
  icon?: ReactNode;
  keywords?: string[];
}

export interface UseCommandMenuOptions {
  items: CommandItem[];
  /** Text typed after "/", or `null` when the menu should be closed. */
  query: string | null;
  onSelect(item: CommandItem): void;
  onClose(): void;
}

export interface CommandMenuProps {
  id: string;
  open: boolean;
  query: string;
  matches: CommandMatch[];
  activeId?: string;
  onActivate(id: string): void;
  onSelect(item: CommandItem): void;
  className?: string;
}

const optionId = (menuId: string, itemId: string) => `${menuId}-opt-${itemId}`;

/**
 * State and keyboard handling for a slash-command menu driven from a text
 * field. Focus never leaves the field: the menu is announced through
 * `aria-activedescendant`, and arrow keys, Enter/Tab and Escape are claimed
 * only while it's open.
 */
export function useCommandMenu({ items, query, onSelect, onClose }: UseCommandMenuOptions) {
  const id = useId();
  const open = query !== null;
  const matches = useMemo(() => (open ? filterCommands(items, query) : []), [items, query, open]);
  const [activeIndex, setActiveIndex] = useState(0);

  // New query → first result. (Derived during render; no effect needed.)
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setActiveIndex(0);
  }

  const active = matches[Math.min(activeIndex, matches.length - 1)]?.item;

  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (!open || event.nativeEvent.isComposing) return false;
    const count = matches.length;
    switch (event.key) {
      case 'ArrowDown':
        if (!count) return false;
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % count);
        return true;
      case 'ArrowUp':
        if (!count) return false;
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + count) % count);
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
      'aria-controls': open ? `${id}-list` : undefined,
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

/** The slash-command list. Render inside the composer (`overlay`), fed by `useCommandMenu`. */
export function CommandMenu({
  id,
  open,
  query,
  matches,
  activeId,
  onActivate,
  onSelect,
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

  return (
    <div className={cx(styles.menu, className)}>
      {matches.length === 0 ? (
        <div className={styles.empty} role="status">
          No command called <code className={styles.emptyName}>/{query}</code>
        </div>
      ) : (
        <div
          id={`${id}-list`}
          ref={listRef}
          role="listbox"
          aria-label="Commands"
          className={styles.list}
        >
          {groups.map((group) => (
            <div
              key={group.name}
              role="group"
              aria-labelledby={`${id}-g-${group.name}`}
              className={styles.group}
            >
              <div id={`${id}-g-${group.name}`} className={styles.groupLabel}>
                {group.name}
              </div>
              {group.items.map(({ item, hits }) => (
                // Options are driven by the text field (aria-activedescendant); clicks select.
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                <div
                  key={item.id}
                  id={optionId(id, item.id)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={item.id === activeId}
                  data-active={item.id === activeId || undefined}
                  className={styles.option}
                  onPointerMove={() => item.id !== activeId && onActivate(item.id)}
                  // Keep focus in the text field.
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => onSelect(item)}
                >
                  <span className={styles.icon} aria-hidden>
                    {item.icon ?? <span className={styles.iconDot} />}
                  </span>
                  <span className={styles.name}>
                    /<Highlighted text={item.name} hits={hits} />
                  </span>
                  {item.argumentHint && <span className={styles.hint}>{item.argumentHint}</span>}
                  {item.description && (
                    <span className={styles.description}>{item.description}</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
