import {
  VAULT_TEMPLATES,
  type VaultItemSummary,
  VaultItemType,
  VaultProblem,
  VaultSourceId,
} from '@conch/protocol';
import {
  AlertDialog,
  Button,
  Callout,
  ContextMenu,
  DropdownMenu,
  EmptyState,
  IconButton,
  Input,
  Stack,
  Text,
  toast,
  useMediaQuery,
  VaultConnectedSources,
  VaultHealth,
  VaultKindGlyph,
  VaultListHeading,
  VaultRow,
  VaultRowSkeleton,
  VaultSelectionBar,
  VaultSourceBadge,
  VaultSourceFilter,
  vaultSourceName,
  VirtualList,
  type VirtualListHandle,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownUp,
  ChevronDown,
  Download,
  KeyRound,
  Layers,
  ListChecks,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router';
import { z } from 'zod';

import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { errorText } from '../integrations/queries';
import { copyTargets, mayHaveCode, useItemActions } from './actions';
import { vaultApi } from './api';
import {
  ago,
  counts,
  filterName,
  indexItems,
  listRows,
  range,
  titleRanges,
  twins,
  TYPE_NAMES,
  type VaultFilter,
  type VaultFrom,
  type VaultListRow,
  type VaultSort,
  visibleItems,
} from './filter';
import { ImportDialog } from './ImportDialog';
import { ItemDetail } from './ItemDetail';
import { ItemEditor } from './ItemEditor';
import { LockDialog, LockScreen } from './Lock';
import styles from './Passwords.module.css';
import { useVault, vaultItemQuery, vaultKeys } from './queries';
import { RowMenu } from './RowMenu';
import { SourcesDialog } from './SourcesDialog';

type Mode =
  { kind: 'view' } | { kind: 'edit' } | { kind: 'new'; type: VaultItemType } | { kind: 'pick' };

/** A row's height in rem: a `VaultRow` is 3.5, and the rest is the gap to the next one. */
const ROW_REM = 3.625;
const HEADING_REM = 2;
const rowHeight = (row: VaultListRow) => (row.kind === 'header' ? HEADING_REM : ROW_REM);
const rowKey = (row: VaultListRow) => (row.kind === 'header' ? row.id : row.item.id);
const isHeading = (row: VaultListRow) => row.kind === 'header';

/** How long the pointer rests on a row before its item is fetched, ahead of the click. */
const HOVER_MS = 80;

/** One item in the list. Memoised: scrolling redraws the list, not the rows still in view. */
const PasswordRow = memo(function PasswordRow({
  item,
  selected,
  selecting,
  checked,
  sort,
  query,
  sourceMark,
  onPress,
  onKeyDown,
  onRest,
}: {
  item: VaultItemSummary;
  selected: boolean;
  /** The list is choosing several. */
  selecting: boolean;
  checked: boolean;
  sort: VaultSort;
  /** What was searched for, to mark it in the title. */
  query: string;
  sourceMark: boolean;
  /** A press, with the keys held: ⌘/Ctrl adds it to the chosen, Shift chooses up to it. */
  onPress: (id: string, how: { toggle: boolean; extend: boolean }) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  /** The pointer came to rest on this row (or left it). */
  onRest: (item: VaultItemSummary | undefined) => void;
}) {
  const menu = useContext(RowMenuContext);
  const ranges = useMemo(() => titleRanges(item.title, query), [item.title, query]);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <ContextMenu.Root onOpenChange={setMenuOpen}>
      <ContextMenu.Trigger asChild>
        <VaultRow
          data-id={item.id}
          kind={item.type}
          title={item.title}
          titleRanges={ranges}
          subtitle={item.subtitle}
          domain={item.domains[0]}
          source={item.source}
          sourceMark={sourceMark}
          container={item.container}
          selecting={selecting}
          checked={checked}
          favorite={item.favorite}
          totp={item.totp}
          passkey={item.passkey}
          issues={item.problems}
          selected={selected}
          note={item.deletedAt ? `Deleted ${ago(item.deletedAt)}` : undefined}
          meta={
            item.deletedAt
              ? undefined
              : sort === 'recent'
                ? item.updatedAt
                  ? `Edited ${ago(item.updatedAt)}`
                  : 'No edit date'
                : sort === 'used'
                  ? item.usedAt
                    ? `Used ${ago(item.usedAt)}`
                    : 'Not used yet'
                  : undefined
          }
          onClick={(e: ReactMouseEvent) =>
            onPress(item.id, { toggle: e.metaKey || e.ctrlKey, extend: e.shiftKey })
          }
          // Shift-click chooses a run of rows; it shouldn't also select their text.
          onMouseDown={(e: ReactMouseEvent) => e.shiftKey && e.preventDefault()}
          onKeyDown={onKeyDown}
          onPointerEnter={(e) => e.pointerType !== 'touch' && onRest(item)}
          onPointerLeave={() => onRest(undefined)}
        />
      </ContextMenu.Trigger>
      {menuOpen && menu(item)}
    </ContextMenu.Root>
  );
});

/** Each row's right-click menu, drawn only while it's open. */
const RowMenuContext = createContext<(item: VaultItemSummary) => ReactNode>(() => null);

/** The Security check's issues, in the order they matter. */
const ISSUES: VaultProblem[] = ['compromised', 'reused', 'weak', 'expired', 'insecure'];

/** How the list was left: kept in this browser, so Passwords opens the way you use it. */
const VIEW_KEY = 'conch.passwords.view';
interface SavedView {
  filter: VaultFilter;
  sort: VaultSort;
  from: VaultFrom;
}

/**
 * What this browser kept, checked against what Passwords knows: an older or
 * hand-edited value opens the usual way instead of breaking the page.
 * Recently deleted is somewhere you go, not where Passwords should open.
 */
const SavedFilter = z.union([
  z.object({ kind: z.enum(['all', 'favorites', 'codes']) }),
  z.object({ kind: z.literal('type'), type: VaultItemType }),
  z.object({ kind: z.literal('problem'), problem: VaultProblem }),
  z.object({ kind: z.literal('tag'), tag: z.string().min(1).max(100) }),
]);
function savedView(): Partial<SavedView> {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as Record<string, unknown>;
    const filter = SavedFilter.safeParse(raw.filter);
    const sort = z.enum(['name', 'recent', 'used']).safeParse(raw.sort);
    const from = z.union([z.literal('all'), VaultSourceId]).safeParse(raw.from);
    return {
      ...(filter.success && { filter: filter.data }),
      ...(sort.success && { sort: sort.data }),
      ...(from.success && { from: from.data }),
    };
  } catch {
    return {};
  }
}

/** Typing in a field, or text chosen on the page: the keys are theirs, not the list's. */
function typing(e: globalThis.KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  return Boolean(
    target?.closest('input, textarea, select, [contenteditable]') ||
    (window.getSelection()?.toString() ?? ''),
  );
}

/**
 * Passwords (ADR 0025): one list of everything — Conch's own vault and the
 * password managers it reads — with a search that finds an item by any word
 * you'd remember it by, one filter at a time, and the item beside it.
 */
export function PasswordsView({ itemId }: { itemId?: string }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data, isLoading, error } = useVault({ looking: true });
  const auth = useAuth();
  const { guard: verify, dialog } = useVerify(auth.data?.method ?? 'none');
  const narrow = useMediaQuery('(max-width: 900px)');
  const [query, setQuery] = useState('');
  // The search box answers each key at once; the list follows when there's a moment.
  const sought = useDeferredValue(query);
  const [saved] = useState(savedView);
  const [filter, setFilter] = useState<VaultFilter>(saved.filter ?? { kind: 'all' });
  const [sort, setSort] = useState<VaultSort>(saved.sort ?? 'name');
  const [from, setFrom] = useState<VaultFrom>(saved.from ?? 'all');
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ filter, sort, from }));
    } catch {
      // A private window: it opens the usual way next time.
    }
  }, [filter, sort, from]);
  // Choosing several: ⌘/Ctrl- or Shift-click, Select, or ⌘A.
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string>(undefined);
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  const [importing, setImporting] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  // Reached with the arrow keys: its fields are asked for once the selection rests.
  const [settle, setSettle] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<VirtualListHandle>(null);
  const listId = useId();
  const listPane = useRef<HTMLElement>(null);
  const resting = useRef<ReturnType<typeof setTimeout>>(undefined);
  const location = useLocation();

  // ⌘K's "New password", "Import passwords" and "Check my passwords" arrive here, and
  // 1Password's "Set up" in Apps (the other password managers, ADR 0052).
  const asked = location.state as {
    new?: VaultItemType;
    import?: boolean;
    check?: boolean;
    sources?: boolean;
  } | null;
  const [handled, setHandled] = useState<unknown>(null);
  if (asked && asked !== handled) {
    setHandled(asked);
    if (asked.new) setMode({ kind: 'new', type: asked.new });
    if (asked.import) setImporting(true);
    if (asked.check) setFilter({ kind: 'all' });
    if (asked.sources) setSourcesOpen(true);
  }
  useEffect(() => {
    if (location.state) void navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const guard = async <T,>(task: () => Promise<T>): Promise<T | undefined> => {
    let result: T | undefined;
    const ok = await verify(async () => {
      result = await task();
    });
    return ok ? result : undefined;
  };

  const items = useMemo(() => data?.items ?? [], [data]);
  // Read once when the list arrives, so a key press only compares strings.
  const index = useMemo(() => indexItems(items), [items]);
  // A place that's no longer there (a manager turned off) shows everything again.
  const place: VaultFrom = from === 'all' || items.some((i) => i.source === from) ? from : 'all';
  const shown = useMemo(
    () => visibleItems(index, { query: sought, filter, sort, from: place }),
    [index, sought, filter, sort, place],
  );
  const rows = useMemo(
    () => listRows(shown, { query: sought, filter, sort }),
    [shown, sought, filter, sort],
  );
  const tally = useMemo(() => counts(items, place), [items, place]);
  const open1 = useMemo(() => items.find((i) => i.id === itemId), [items, itemId]);
  const twinsOf = useMemo(() => twins(items), [items]);
  // Where each item lives, on its tile, once the list holds more than one place's items.
  const sourceMark = tally.sources.size > 1;
  const status = data?.status;
  const targets = useMemo(() => copyTargets(status?.sources ?? []), [status?.sources]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const chosenItems = useMemo(
    () => [...chosen].flatMap((id) => byId.get(id) ?? []),
    [chosen, byId],
  );
  const open = (id: string | undefined, how: { keys?: boolean } = {}) => {
    setMode({ kind: 'view' });
    setSettle(Boolean(how.keys));
    void navigate(id ? `/passwords/${id}` : '/passwords');
  };
  const reveal = (id: string) =>
    list.current?.scrollToIndex(rows.findIndex((r) => r.kind === 'item' && r.item.id === id));
  const toTop = () => list.current?.scrollToIndex(0);

  const actions = useItemActions({
    guard,
    onOpen: open,
    onShowConch: () => {
      setFrom('conch');
      setFilter({ kind: 'all' });
      toTop();
    },
  });

  // ── Choosing several ──
  const stopChoosing = useCallback(() => {
    setSelecting(false);
    setChosen(new Set());
    anchor.current = undefined;
  }, []);
  const choose = useCallback((ids: string[], how: 'toggle' | 'add' | 'only') => {
    setSelecting(true);
    setChosen((before) => {
      const next = new Set(how === 'only' ? [] : before);
      for (const id of ids)
        if (how === 'toggle' && next.has(id)) next.delete(id);
        else next.add(id);
      return next;
    });
  }, []);
  // A new filter, place or search: what was chosen and is no longer shown stays chosen
  // only while you can see it, so nothing out of sight is deleted by surprise.
  const shownIds = useMemo(() => new Set(shown.map((i) => i.id)), [shown]);
  const visibleChosen = useMemo(
    () => chosenItems.filter((i) => shownIds.has(i.id)),
    [chosenItems, shownIds],
  );

  const onPress = (id: string, how: { toggle: boolean; extend: boolean }) => {
    if (how.extend) {
      const start = anchor.current ?? itemId ?? id;
      choose(range(shown, start, id), 'add');
      return;
    }
    if (how.toggle || selecting) {
      // ⌘-click from a single open item: it's the first of the chosen.
      const first = !selecting && itemId && itemId !== id ? [itemId] : [];
      choose([...first, id], 'toggle');
      anchor.current = id;
      return;
    }
    anchor.current = id;
    open(id);
  };
  // Stable for the memoised rows: it reads the latest of everything through a ref.
  const pressRef = useRef(onPress);
  useEffect(() => {
    pressRef.current = onPress;
  });
  const press = useCallback(
    (id: string, how: { toggle: boolean; extend: boolean }) => pressRef.current(id, how),
    [],
  );

  const menu = (item: VaultItemSummary) => (
    <RowMenu
      item={item}
      chosen={chosen.has(item.id) ? visibleChosen : undefined}
      actions={actions}
      targets={targets}
      onOpen={(id) => {
        stopChoosing();
        open(id);
      }}
      onEdit={(id) => {
        stopChoosing();
        open(id);
        // The editor starts from the item's fields: have them first.
        void client.fetchQuery(vaultItemQuery(id)).then(
          () => setMode({ kind: 'edit' }),
          () => undefined,
        );
      }}
      onSelect={(id) => {
        choose([id], 'add');
        anchor.current = id;
      }}
      onClearSelection={stopChoosing}
    />
  );

  /** What the keys act on: the chosen, or the row with focus, or the open item. */
  const focusedRow = () =>
    (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('button[data-id]')?.dataset
      .id;
  /**
   * What the keys act on: while choosing, the chosen and nothing else; otherwise the
   * row with focus, or (for copying, `open`) the item that's open.
   */
  const subject = (how: { open: boolean }): VaultItemSummary[] => {
    if (selecting) return visibleChosen;
    const one = byId.get(focusedRow() ?? (how.open ? (itemId ?? '') : ''));
    return one ? [one] : [];
  };
  const onKeys = (e: globalThis.KeyboardEvent) => {
    if (e.defaultPrevented || e.repeat || typing(e)) return;
    if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
    const inList = listPane.current?.contains(document.activeElement) ?? false;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape' && selecting) {
      e.preventDefault();
      stopChoosing();
      return;
    }
    if (mod && key === 'a' && inList && filter.kind !== 'deleted' && shown.length) {
      e.preventDefault();
      choose(
        shown.map((i) => i.id),
        'only',
      );
      return;
    }
    if (mod && key === 'c') {
      const [one, ...more] = subject({ open: true });
      if (!one || more.length || one.deletedAt) return;
      e.preventDefault();
      if (e.altKey) void (mayHaveCode(one) && actions.copyCode(one));
      else if (e.shiftKey) void actions.copyUsername(one);
      else void actions.copyPassword(one);
      return;
    }
    // Delete only where it's plain what it deletes: the chosen, or the row with focus.
    if ((e.key === 'Delete' || (e.key === 'Backspace' && mod)) && (inList || selecting)) {
      const them = subject({ open: false });
      if (!them.length) return;
      e.preventDefault();
      const mine = them.filter((i) => i.source === 'conch' && !i.deletedAt);
      if (them.every((i) => i.deletedAt)) actions.purge(them);
      else if (!mine.length)
        // Another manager's: it's deleted in that manager's own app.
        toast(
          `Delete ${them.length === 1 ? 'it' : 'them'} in ${vaultSourceName(them[0]?.source ?? 'conch')}`,
          {
            description: 'Conch shows what’s there, and changes nothing in it.',
          },
        );
      else {
        void actions.trash(mine);
        if (mine.some((i) => i.id === itemId)) open(undefined);
        stopChoosing();
      }
    }
  };
  const keysRef = useRef(onKeys);
  useEffect(() => {
    keysRef.current = onKeys;
  });
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => keysRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const changeFrom = (next: VaultFrom) => {
    setFrom(next);
    // A filter that has nothing in the new place would show an empty list.
    if (filter.kind === 'source') setFilter({ kind: 'all' });
    open(undefined);
    toTop();
  };

  // Opened by its address: the list starts where that item is.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || !rows.length) return;
    placed.current = true;
    if (itemId)
      list.current?.scrollToIndex(rows.findIndex((r) => r.kind === 'item' && r.item.id === itemId));
  }, [rows, itemId]);

  // The pointer resting on one of Conch's own items fetches it, so the click finds it
  // ready. Never another manager's: asking it for an item nobody chose could put up
  // its own unlock prompt.
  const onRest = useCallback(
    (item: VaultItemSummary | undefined) => {
      clearTimeout(resting.current);
      if (item?.source !== 'conch') return;
      resting.current = setTimeout(
        () => void client.prefetchQuery(vaultItemQuery(item.id)),
        HOVER_MS,
      );
    },
    [client],
  );
  useEffect(() => () => clearTimeout(resting.current), []);

  // "/" anywhere on the page goes to the search, like most lists on the web.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== '/' || target?.closest('input, textarea, [contenteditable]')) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Esc, or a click on empty space in the list, puts the item away: back to the start screen.
  const viewing = Boolean(itemId) && mode.kind === 'view';
  useEffect(() => {
    if (!viewing) return;
    const busy = () =>
      document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]');
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== 'Escape' || e.defaultPrevented || busy()) return;
      if (target?.closest('input, textarea, select, [contenteditable]')) return;
      void navigate('/passwords');
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !listPane.current?.contains(target) || busy()) return;
      if (target.closest('button, a, input, label, [role="listitem"], [role="region"]')) return;
      void navigate('/passwords');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
  }, [viewing, navigate]);

  /** The arrow keys: the item before or after the chosen one, brought into view. */
  const move = (by: 1 | -1) => {
    // The list may be a key press behind the search box: go by what's typed now.
    const found =
      sought === query ? shown : visibleItems(index, { query, filter, sort, from: place });
    const at = found.findIndex((i) => i.id === itemId);
    const next = found[Math.min(found.length - 1, Math.max(0, at + by))];
    if (!next) return undefined;
    open(next.id, { keys: true });
    reveal(next.id);
    // Shift-click chooses from here.
    anchor.current = next.id;
    return next;
  };

  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next = move(e.key === 'ArrowDown' ? 1 : -1);
    if (next)
      requestAnimationFrame(() =>
        [...(listPane.current?.querySelectorAll<HTMLButtonElement>('button[data-id]') ?? [])]
          .find((row) => row.dataset.id === next.id)
          ?.focus(),
      );
  };

  // In the search, the arrows walk the results and Enter opens the best one;
  // the keyboard stays in the box, so you can keep typing.
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      const found =
        sought === query ? shown : visibleItems(index, { query, filter, sort, from: place });
      const best = found[0];
      if (!best || found.some((i) => i.id === itemId)) return;
      e.preventDefault();
      open(best.id);
      reveal(best.id);
    }
  };

  const rowProps = useCallback(
    (row: VaultListRow) =>
      row.kind === 'header'
        ? { role: 'presentation' }
        : { role: 'listitem', 'aria-setsize': shown.length, 'aria-posinset': row.position },
    [shown.length],
  );

  const checkBreaches = async () => {
    setChecking(true);
    try {
      const result = await vaultApi.breaches();
      void client.invalidateQueries({ queryKey: vaultKeys.all });
      if (result.compromised)
        toast.warning(
          `${result.compromised} ${result.compromised === 1 ? 'password was' : 'passwords were'} in a data breach`,
          {
            description: 'They’re listed under “In a data breach”. Change those first.',
          },
        );
      else toast.success(`None of your ${result.checked} passwords are in known breaches`);
    } catch (e) {
      toast.error(errorText(e, 'Couldn’t check right now.'));
    } finally {
      setChecking(false);
    }
  };

  const exportAll = async () => {
    try {
      const blob = await guard(() => vaultApi.exportCsv());
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Conch passwords.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast('Exported', { description: 'Import it where you need it, then delete the file.' });
    } catch (e) {
      toast.error(errorText(e, 'Couldn’t export.'));
    }
  };

  // Managers that are on, at a glance on the start screen.
  const connected = (status?.sources ?? []).flatMap((s) =>
    s.id === 'conch' || s.id === 'system' || s.state === 'off' || s.state === 'missing'
      ? []
      : [{ source: s.id, state: s.state, ...(s.count !== undefined && { count: s.count }) }],
  );

  const showList = !narrow || (!itemId && mode.kind === 'view');
  const showDetail = !narrow || Boolean(itemId) || mode.kind !== 'view';
  const health = status?.health;
  const issueTotal = health
    ? health.compromised + health.reused + health.weak + health.expired + health.insecure
    : 0;

  if (error)
    return (
      <div className={styles.page}>
        <Callout tone="warning" title="Passwords couldn’t open">
          {errorText(error, 'Try again in a moment.')}
        </Callout>
      </div>
    );

  const newMenu = (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button size="sm" leadingIcon={<Plus />}>
          New
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        {VAULT_TEMPLATES.map((t) => (
          <DropdownMenu.Item
            key={t.type}
            icon={<VaultKindGlyph kind={t.type} />}
            onSelect={() => setMode({ kind: 'new', type: t.type })}
          >
            {t.name}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );

  const empty =
    !isLoading && tally.all === 0 && tally.deleted === 0 && filter.kind === 'all' && !query;

  return (
    <div className={styles.page}>
      {showList && (
        <section className={styles.listPane} aria-label="Passwords" ref={listPane}>
          <div className={styles.toolbar}>
            <Input
              ref={search}
              size="sm"
              leading={<Search />}
              placeholder="Search passwords"
              aria-label="Search passwords"
              aria-controls={listId}
              value={query}
              clearable
              onClear={() => {
                setQuery('');
                toTop();
              }}
              onChange={(e) => {
                setQuery(e.target.value);
                // New results start from their best match, not from where the old list was.
                toTop();
              }}
              onKeyDown={onSearchKey}
            />
            {newMenu}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <IconButton size="sm" label="More">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item icon={<Upload />} onSelect={() => setImporting(true)}>
                  Import passwords…
                </DropdownMenu.Item>
                <DropdownMenu.Item icon={<Layers />} onSelect={() => setSourcesOpen(true)}>
                  Password managers…
                </DropdownMenu.Item>
                <DropdownMenu.Item icon={<ShieldCheck />} onSelect={() => void checkBreaches()}>
                  Check for breaches
                </DropdownMenu.Item>
                {status?.lock.enabled && !status.lock.locked && (
                  <DropdownMenu.Item
                    icon={<LockKeyhole />}
                    onSelect={() =>
                      void vaultApi
                        .lock()
                        .then(() => client.invalidateQueries({ queryKey: vaultKeys.all }))
                    }
                  >
                    Lock now
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item icon={<LockKeyhole />} onSelect={() => setLockOpen(true)}>
                  Lock settings…
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item icon={<Download />} onSelect={() => setExporting(true)}>
                  Export as CSV…
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>

          {tally.sources.size > 1 && !selecting && (
            <VaultSourceFilter
              className={styles.sources}
              value={place}
              onValueChange={changeFrom}
              total={tally.everywhere}
              sources={[...tally.sources]
                // Conch first, then the managers, then the keys Conch uses.
                .sort(([a], [b]) => rankSource(a) - rankSource(b))
                .map(([source, count]) => ({ source, count }))}
            />
          )}

          {selecting ? (
            <VaultSelectionBar
              className={styles.selection}
              count={visibleChosen.length}
              total={shown.length}
              onSelectAll={() =>
                choose(
                  shown.map((i) => i.id),
                  'only',
                )
              }
              onDone={stopChoosing}
              actions={
                <SelectionActions
                  items={visibleChosen}
                  targets={targets}
                  actions={actions}
                  onDone={(closes) => {
                    if (closes && visibleChosen.some((i) => i.id === itemId)) open(undefined);
                    stopChoosing();
                  }}
                />
              }
            />
          ) : (
            <div className={styles.filters}>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    trailingIcon={<ChevronDown />}
                    className={styles.filterButton}
                  >
                    {filterName(filter)}
                    {filter.kind !== 'deleted' && !isLoading && (
                      <Text as="span" size="xs" tone="subtle" className={styles.count}>
                        {shown.length}
                      </Text>
                    )}
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="start">
                  <DropdownMenu.RadioGroup
                    value={JSON.stringify(filter)}
                    onValueChange={(v) => {
                      setFilter(JSON.parse(v) as VaultFilter);
                      open(undefined);
                      toTop();
                    }}
                  >
                    <DropdownMenu.RadioItem value={JSON.stringify({ kind: 'all' })}>
                      All items · {tally.all}
                    </DropdownMenu.RadioItem>
                    {tally.favorites > 0 && (
                      <DropdownMenu.RadioItem value={JSON.stringify({ kind: 'favorites' })}>
                        Favourites · {tally.favorites}
                      </DropdownMenu.RadioItem>
                    )}
                    {tally.codes > 0 && (
                      <DropdownMenu.RadioItem value={JSON.stringify({ kind: 'codes' })}>
                        One-time codes · {tally.codes}
                      </DropdownMenu.RadioItem>
                    )}
                    <DropdownMenu.Separator />
                    {[...tally.types.entries()].map(([type, n]) => (
                      <DropdownMenu.RadioItem
                        key={type}
                        value={JSON.stringify({ kind: 'type', type })}
                      >
                        {TYPE_NAMES[type].many} · {n}
                      </DropdownMenu.RadioItem>
                    ))}
                    {tally.tags.length > 0 && (
                      <>
                        <DropdownMenu.Separator />
                        {tally.tags.map(([tag, n]) => (
                          <DropdownMenu.RadioItem
                            key={tag}
                            value={JSON.stringify({ kind: 'tag', tag })}
                          >
                            {tag} · {n}
                          </DropdownMenu.RadioItem>
                        ))}
                      </>
                    )}
                    {issueTotal > 0 && (
                      <>
                        <DropdownMenu.Separator />
                        {ISSUES.filter((p) => (health?.[p as keyof typeof health] ?? 0) > 0).map(
                          (p) => (
                            <DropdownMenu.RadioItem
                              key={p}
                              value={JSON.stringify({ kind: 'problem', problem: p })}
                            >
                              {filterName({ kind: 'problem', problem: p })} ·{' '}
                              {health?.[p as keyof typeof health]}
                            </DropdownMenu.RadioItem>
                          ),
                        )}
                      </>
                    )}
                    <DropdownMenu.Separator />
                    <DropdownMenu.RadioItem value={JSON.stringify({ kind: 'deleted' })}>
                      Recently deleted · {tally.deleted}
                    </DropdownMenu.RadioItem>
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
              <span className={styles.filterTools}>
                {shown.length > 0 && (
                  <IconButton
                    size="sm"
                    label="Select"
                    onClick={() => {
                      setSelecting(true);
                      if (itemId && shownIds.has(itemId)) choose([itemId], 'add');
                    }}
                  >
                    <ListChecks />
                  </IconButton>
                )}
                {filter.kind !== 'deleted' && (
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <IconButton size="sm" label="Sort">
                        <ArrowDownUp />
                      </IconButton>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end">
                      <DropdownMenu.RadioGroup
                        value={sort}
                        onValueChange={(v) => {
                          setSort(v as VaultSort);
                          toTop();
                        }}
                      >
                        <DropdownMenu.RadioItem value="name">By name</DropdownMenu.RadioItem>
                        <DropdownMenu.RadioItem value="recent">
                          Recently edited
                        </DropdownMenu.RadioItem>
                        <DropdownMenu.RadioItem value="used">Recently used</DropdownMenu.RadioItem>
                      </DropdownMenu.RadioGroup>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                )}
                {filter.kind === 'deleted' && tally.deleted > 0 && (
                  <Button size="sm" variant="ghost" tone="danger" onClick={() => setEmptying(true)}>
                    Empty
                  </Button>
                )}
              </span>
            </div>
          )}

          {filter.kind === 'all' && !query && health && tally.all > 0 && issueTotal > 0 && (
            <VaultHealth
              className={styles.health}
              compromised={health.compromised}
              reused={health.reused}
              weak={health.weak}
              expired={health.expired}
              insecure={health.insecure}
              total={tally.all}
              checkedNote={
                health.breachCheckedAt
                  ? `Checked for breaches ${ago(health.breachCheckedAt)}`
                  : 'Not checked for breaches yet'
              }
              onSelect={(problem) => {
                setFilter({ kind: 'problem', problem });
                open(undefined);
                toTop();
              }}
              action={
                <Button
                  size="sm"
                  variant="ghost"
                  loading={checking}
                  onClick={() => void checkBreaches()}
                >
                  Check now
                </Button>
              }
            />
          )}

          {isLoading ? (
            <div className={styles.listStill} aria-busy="true">
              {Array.from({ length: 8 }, (_, i) => (
                <VaultRowSkeleton key={i} />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <div className={styles.listStill}>
              {!empty && (
                <EmptyState
                  size="sm"
                  icon={<Search />}
                  title={
                    sought
                      ? `Nothing matches “${sought}”`
                      : `No ${filterName(filter).toLowerCase()}`
                  }
                  description={sought ? 'Try a site name or a username.' : undefined}
                />
              )}
            </div>
          ) : (
            <RowMenuContext.Provider value={menu}>
              <VirtualList
                id={listId}
                role="list"
                className={styles.list}
                handle={list}
                items={rows}
                rowHeight={rowHeight}
                getKey={rowKey}
                sticky={isHeading}
                rowProps={rowProps}
              >
                {(row) =>
                  row.kind === 'header' ? (
                    <VaultListHeading>{row.label}</VaultListHeading>
                  ) : (
                    <PasswordRow
                      item={row.item}
                      selected={row.item.id === itemId}
                      selecting={selecting}
                      checked={chosen.has(row.item.id)}
                      sort={sort}
                      query={sought}
                      sourceMark={sourceMark}
                      onPress={press}
                      onKeyDown={onListKey}
                      onRest={onRest}
                    />
                  )
                }
              </VirtualList>
            </RowMenuContext.Provider>
          )}
          {status?.protectionNote && (
            <Text size="xs" tone="subtle" className={styles.protection}>
              {status.protectionNote}
            </Text>
          )}
        </section>
      )}

      {showDetail && (
        <section className={styles.detailPane} aria-label="Item">
          {status?.lock.locked && !(itemId && !itemId.startsWith('pw_')) ? (
            <LockScreen />
          ) : (empty || (!narrow && !itemId)) && mode.kind === 'view' ? (
            <EmptyState
              icon={<KeyRound />}
              title={empty ? 'Keep your passwords here' : 'Your passwords'}
              description={
                empty
                  ? 'Conch keeps them encrypted on this computer, fills them in for your assistant when you say so, and tells you when one turns up in a breach.'
                  : 'Choose one on the left, press / to search, or add another. They’re encrypted on this computer, and your assistant only uses them with your OK.'
              }
              actions={
                <Stack direction="row" gap={2} wrap justify="center">
                  <Button
                    leadingIcon={<Plus />}
                    onClick={() => setMode({ kind: 'new', type: 'login' })}
                  >
                    Add a password
                  </Button>
                  <Button
                    variant="surface"
                    leadingIcon={<Upload />}
                    onClick={() => setImporting(true)}
                  >
                    Import passwords
                  </Button>
                  <Button
                    variant="ghost"
                    leadingIcon={<Layers />}
                    onClick={() => setSourcesOpen(true)}
                  >
                    {connected.length ? 'Manage password managers' : 'Connect a password manager'}
                  </Button>
                </Stack>
              }
            >
              <VaultConnectedSources sources={connected} onOpen={() => setSourcesOpen(true)} />
            </EmptyState>
          ) : mode.kind === 'new' ? (
            <ItemEditor
              key={`new-${mode.type}`}
              type={mode.type}
              guard={guard}
              onCancel={() => setMode({ kind: 'view' })}
              onDone={(id) => open(id)}
            />
          ) : mode.kind === 'edit' && itemId ? (
            <EditLoader id={itemId} guard={guard} onDone={() => setMode({ kind: 'view' })} />
          ) : itemId ? (
            <ItemDetail
              key={itemId}
              id={itemId}
              summary={open1}
              settle={settle}
              guard={guard}
              onEdit={() => setMode({ kind: 'edit' })}
              onBack={narrow ? () => open(undefined) : undefined}
              onDeleted={() => open(undefined)}
              actions={actions}
              targets={targets}
              twins={twinsOf.get(itemId) ?? []}
              onOpenItem={(id) => {
                open(id);
                reveal(id);
              }}
            />
          ) : (
            !narrow && (
              <EmptyState
                size="sm"
                icon={<KeyRound />}
                title="Choose an item"
                description="Or press / to search."
              />
            )
          )}
        </section>
      )}

      <ImportDialog open={importing} onOpenChange={setImporting} />
      {status && (
        <LockDialog open={lockOpen} onOpenChange={setLockOpen} lock={status.lock} guard={guard} />
      )}
      <SourcesDialog
        open={sourcesOpen}
        onOpenChange={setSourcesOpen}
        sources={status?.sources ?? []}
        guard={guard}
      />
      <AlertDialog.Root open={exporting} onOpenChange={setExporting}>
        <AlertDialog.Content tone="danger" icon={<Download />}>
          <AlertDialog.Title>Export every password in plain text?</AlertDialog.Title>
          <AlertDialog.Description>
            The file isn’t encrypted: anyone who gets it can read every password. Import it where
            you need it, then delete it. Don’t open it in a spreadsheet. To move Conch to another
            computer, use a backup with a passphrase instead.
          </AlertDialog.Description>
          <AlertDialog.Footer>
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button tone="danger" onClick={() => void exportAll()}>
                Export
              </Button>
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
      <AlertDialog.Root open={emptying} onOpenChange={setEmptying}>
        <AlertDialog.Content tone="danger" icon={<Trash2 />}>
          <AlertDialog.Title>Empty Recently deleted?</AlertDialog.Title>
          <AlertDialog.Description>
            {tally.deleted} {tally.deleted === 1 ? 'item is' : 'items are'} deleted for good. This
            can’t be undone.
          </AlertDialog.Description>
          <AlertDialog.Footer>
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                tone="danger"
                onClick={() =>
                  void guard(() => vaultApi.purge()).then((r) => {
                    if (!r) return;
                    void client.invalidateQueries({ queryKey: vaultKeys.all });
                    open(undefined);
                  })
                }
              >
                Empty
              </Button>
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
      {actions.dialogs}
      {dialog}
    </div>
  );
}

/** Conch first, then the managers in their usual order, then the keys Conch uses. */
function rankSource(source: VaultFrom): number {
  return source === 'conch' ? 0 : source === 'system' ? 2 : 1;
}

const many = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

/**
 * What can be done with the chosen items, each button saying how many it
 * applies to: a manager's items can be copied into Conch but are deleted in
 * their own app; Conch's own can be copied to a manager that takes them.
 */
function SelectionActions({
  items,
  targets,
  actions,
  onDone,
}: {
  items: VaultItemSummary[];
  targets: ReturnType<typeof copyTargets>;
  actions: ReturnType<typeof useItemActions>;
  /** Done with them; `closes` when they left the list (deleted). */
  onDone: (closes: boolean) => void;
}) {
  const mine = items.filter((i) => i.source === 'conch' && !i.deletedAt);
  const theirs = items.filter((i) => i.readOnly && i.source !== 'conch' && i.source !== 'system');
  const deleted = items.filter((i) => i.deletedAt);
  if (!items.length) return null;
  return (
    <>
      {theirs.length > 0 && (
        <Button
          size="sm"
          variant="surface"
          leadingIcon={<VaultSourceBadge source="conch" />}
          onClick={() => {
            void actions.copyIntoConch(theirs);
            onDone(false);
          }}
        >
          {mine.length ? `Copy ${many(theirs.length)} into Conch` : 'Copy into Conch'}
        </Button>
      )}
      {mine.length > 0 && targets.length > 0 && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button size="sm" variant="surface" trailingIcon={<ChevronDown />}>
              {theirs.length ? `Copy ${many(mine.length)} to…` : 'Copy to…'}
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="start">
            {targets.flatMap((t) =>
              (t.places.length > 1 ? t.places : [undefined]).map((p) => (
                <DropdownMenu.Item
                  key={`${t.id}:${p?.id ?? ''}`}
                  icon={<VaultSourceBadge source={t.id} />}
                  onSelect={() => {
                    void actions.copyTo(mine, t, p ?? t.places[0]);
                    onDone(false);
                  }}
                >
                  {p && t.places.length > 1 ? `${t.name} · ${p.name}` : t.name}
                </DropdownMenu.Item>
              )),
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      )}
      {mine.length > 0 && (
        <Button
          size="sm"
          variant="ghost"
          tone="danger"
          leadingIcon={<Trash2 />}
          onClick={() => {
            void actions.trash(mine);
            onDone(true);
          }}
        >
          {theirs.length ? `Delete ${many(mine.length)}` : 'Delete'}
        </Button>
      )}
      {deleted.length > 0 && (
        <>
          <Button
            size="sm"
            variant="surface"
            onClick={() => {
              void actions.restore(deleted);
              onDone(true);
            }}
          >
            Restore
          </Button>
          <Button
            size="sm"
            variant="ghost"
            tone="danger"
            leadingIcon={<Trash2 />}
            onClick={() => actions.purge(deleted)}
          >
            Delete for good
          </Button>
        </>
      )}
      {theirs.length > 0 && mine.length === 0 && deleted.length === 0 && (
        <Text size="xs" tone="subtle" className={styles.selectionNote}>
          {theirs.length === 1 ? 'It’s' : 'They’re'} deleted in{' '}
          {[...new Set(theirs.map((i) => vaultSourceName(i.source)))].join(' or ')}.
        </Text>
      )}
    </>
  );
}

function EditLoader({
  id,
  guard,
  onDone,
}: {
  id: string;
  guard: <T>(task: () => Promise<T>) => Promise<T | undefined>;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const item = client.getQueryData<Parameters<typeof ItemEditor>[0]['item']>(vaultKeys.item(id));
  if (!item) return null;
  return <ItemEditor item={item} guard={guard} onCancel={onDone} onDone={onDone} />;
}
