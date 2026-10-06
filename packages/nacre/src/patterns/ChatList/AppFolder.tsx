import { Search } from 'lucide-react';
import {
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { Dialog } from '../../components/Dialog';
import { Input } from '../../components/Input';
import { TOUCH_ONLY, useMediaQuery } from '../../utils/useMediaQuery';
import { AppDockTile, type AppDockItem } from './AppDock';
import styles from './AppFolder.module.css';

/** A point on the screen, in CSS pixels: where the folder grows from and shrinks back to. */
export interface AppFolderOrigin {
  x: number;
  y: number;
}

export interface AppFolderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every app, in the dock's order. */
  items: AppDockItem[];
  /** The folder's name, as its heading. */
  title?: string;
  /**
   * The middle of whatever opened it (the dock's All apps tile), so the folder
   * grows out of it and folds back into it, as a folder on a phone does.
   * Without it, it rises in place.
   */
  origin?: AppFolderOrigin;
  /** At the folder's foot: a way to the place that manages them (Open Apps). */
  actions?: ReactNode;
}

/** Lower case, without accents, so “cafe” finds “Café”. */
function fold(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * The apps a search finds: names that start with it first, then names with a
 * word that does, then anything that has it (in the name or where it's from).
 * Otherwise they keep their order.
 */
export function findApps(items: AppDockItem[], query: string): AppDockItem[] {
  const q = fold(query.trim());
  if (!q) return items;
  const ranked: { item: AppDockItem; rank: number; at: number }[] = [];
  items.forEach((item, at) => {
    const name = fold(item.label);
    const rank = name.startsWith(q)
      ? 0
      : name.split(/[\s\-_/·]+/).some((word) => word.startsWith(q))
        ? 1
        : name.includes(q)
          ? 2
          : fold(item.source).includes(q)
            ? 3
            : -1;
    if (rank >= 0) ranked.push({ item, rank, at });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.at - b.at).map((r) => r.item);
}

/** How many columns the grid is drawing right now, so ↑ and ↓ move by a row. */
function columnsOf(grid: HTMLElement | null) {
  if (!grid || typeof getComputedStyle === 'undefined') return 1;
  const tracks = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
  return Math.max(1, tracks);
}

/**
 * Every pinned app at once, the way a folder opens on a phone: it grows out of
 * the tile that opened it into a grid with a search at the top, and folds back
 * into it. On a computer the search has the focus, so typing finds; ↓ goes
 * into the grid, the arrows move by tile and by row, Home and End go to either
 * end, Enter opens, and typing a letter goes back to the search. On a phone the
 * keyboard stays down until you tap the search. Choosing an app opens it and
 * closes the folder.
 */
export function AppFolder({
  open,
  onOpenChange,
  items,
  title = 'Apps',
  origin,
  actions,
}: AppFolderProps) {
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  const touch = useMediaQuery(TOUCH_ONLY);
  const statusId = useId();
  const found = useMemo(() => findApps(items, query), [items, query]);
  const at = Math.min(current, Math.max(0, found.length - 1));

  const change = (next: boolean) => {
    if (!next) {
      setQuery('');
      setCurrent(0);
    }
    onOpenChange(next);
  };

  const tiles = () =>
    Array.from(grid.current?.querySelectorAll<HTMLButtonElement>('[data-folder-tile]') ?? []);

  const focusTile = (index: number) => {
    const all = tiles();
    const next = Math.max(0, Math.min(all.length - 1, index));
    setCurrent(next);
    all[next]?.focus();
  };

  const openItem = (item: AppDockItem) => {
    item.onOpen();
    change(false);
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && found.length) {
      e.preventDefault();
      focusTile(at);
    } else if (e.key === 'Enter' && found[0]) {
      e.preventDefault();
      openItem(found[0]);
    }
  };

  const onGridKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const columns = columnsOf(grid.current);
    const last = found.length - 1;
    const moves: Record<string, () => number | 'search'> = {
      ArrowRight: () => Math.min(last, at + 1),
      ArrowLeft: () => Math.max(0, at - 1),
      ArrowDown: () => Math.min(last, at + columns),
      ArrowUp: () => (at - columns < 0 ? 'search' : at - columns),
      Home: () => 0,
      End: () => last,
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      const to = move();
      if (to === 'search') search.current?.focus();
      else focusTile(to);
      return;
    }
    // A letter goes back to the search, and lands in it, so typing always finds.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== ' ') {
      e.preventDefault();
      setQuery((q) => q + e.key);
      setCurrent(0);
      search.current?.focus();
    }
  };

  const style = origin
    ? ({ '--af-x': `${origin.x}px`, '--af-y': `${origin.y}px` } as CSSProperties)
    : undefined;
  const said = query.trim()
    ? found.length
      ? `${found.length} ${found.length === 1 ? 'app' : 'apps'}`
      : 'No apps'
    : `${items.length} ${items.length === 1 ? 'app' : 'apps'}`;

  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <Dialog.Content
        size="lg"
        className={styles.folder}
        data-from={origin ? '' : undefined}
        style={style}
        aria-describedby={statusId}
        onOpenAutoFocus={(e) => {
          // On a phone the keyboard would cover the apps: the folder takes the
          // focus, and the search waits for a tap.
          if (touch) return;
          e.preventDefault();
          search.current?.focus();
        }}
      >
        <Dialog.Header className={styles.head}>
          <Dialog.Title className={styles.title}>{title}</Dialog.Title>
          <span id={statusId} className={styles.count} aria-live="polite">
            {said}
          </span>
        </Dialog.Header>
        <div className={styles.search}>
          <Input
            ref={search}
            type="search"
            aria-label={`Search ${title.toLowerCase()}`}
            placeholder="Search"
            leading={<Search aria-hidden />}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCurrent(0);
            }}
            onKeyDown={onSearchKey}
            clearable
            onClear={() => {
              setQuery('');
              setCurrent(0);
            }}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
          />
        </div>
        <div className={styles.body}>
          {found.length ? (
            <ul ref={grid} className={styles.grid}>
              {found.map(({ key, ...item }, index) => (
                <li key={key} className={styles.cell}>
                  <AppDockTile
                    {...item}
                    data-folder-tile=""
                    tabIndex={index === at ? 0 : -1}
                    onFocus={() => setCurrent(index)}
                    onKeyDown={onGridKey}
                    onOpen={() => openItem({ key, ...item })}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>Nothing called “{query.trim()}”.</p>
          )}
        </div>
        {actions && <div className={styles.foot}>{actions}</div>}
      </Dialog.Content>
    </Dialog.Root>
  );
}
