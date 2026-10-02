import {
  VAULT_TEMPLATES,
  type VaultItemSummary,
  type VaultItemType,
  type VaultProblem,
} from '@conch/protocol';
import {
  AlertDialog,
  Button,
  Callout,
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
  LockKeyhole,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { errorText } from '../integrations/queries';
import { vaultApi } from './api';
import {
  ago,
  counts,
  filterName,
  indexItems,
  listRows,
  titleRanges,
  TYPE_NAMES,
  type VaultFilter,
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
  sort,
  query,
  sourceMark,
  onOpen,
  onKeyDown,
  onRest,
}: {
  item: VaultItemSummary;
  selected: boolean;
  sort: VaultSort;
  /** What was searched for, to mark it in the title. */
  query: string;
  sourceMark: boolean;
  onOpen: (id: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  /** The pointer came to rest on this row (or left it). */
  onRest: (item: VaultItemSummary | undefined) => void;
}) {
  const ranges = useMemo(() => titleRanges(item.title, query), [item.title, query]);
  return (
    <VaultRow
      data-id={item.id}
      kind={item.type}
      title={item.title}
      titleRanges={ranges}
      subtitle={item.subtitle}
      domain={item.domains[0]}
      source={item.source}
      sourceMark={sourceMark}
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
      onClick={() => onOpen(item.id)}
      onKeyDown={onKeyDown}
      onPointerEnter={(e) => e.pointerType !== 'touch' && onRest(item)}
      onPointerLeave={() => onRest(undefined)}
    />
  );
});

/** The Security check's issues, in the order they matter. */
const ISSUES: VaultProblem[] = ['compromised', 'reused', 'weak', 'expired', 'insecure'];

/**
 * Passwords (ADR 0025): one list of everything — Conch's own vault and the
 * password managers it reads — with a search that finds an item by any word
 * you'd remember it by, one filter at a time, and the item beside it.
 */
export function PasswordsView({ itemId }: { itemId?: string }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data, isLoading, error } = useVault();
  const auth = useAuth();
  const { guard: verify, dialog } = useVerify(auth.data?.method ?? 'none');
  const narrow = useMediaQuery('(max-width: 900px)');
  const [query, setQuery] = useState('');
  // The search box answers each key at once; the list follows when there's a moment.
  const sought = useDeferredValue(query);
  const [filter, setFilter] = useState<VaultFilter>({ kind: 'all' });
  const [sort, setSort] = useState<VaultSort>('name');
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
  const shown = useMemo(
    () => visibleItems(index, { query: sought, filter, sort }),
    [index, sought, filter, sort],
  );
  const rows = useMemo(
    () => listRows(shown, { query: sought, filter, sort }),
    [shown, sought, filter, sort],
  );
  const tally = useMemo(() => counts(items), [items]);
  const chosen = useMemo(() => items.find((i) => i.id === itemId), [items, itemId]);
  // A manager's mark tells managers apart: with one of them, it'd be the same mark on every row.
  const sourceMark = useMemo(
    () =>
      new Set(items.map((i) => i.source).filter((s) => s !== 'conch' && s !== 'system')).size > 1,
    [items],
  );
  const status = data?.status;
  const open = (id: string | undefined, how: { keys?: boolean } = {}) => {
    setMode({ kind: 'view' });
    setSettle(Boolean(how.keys));
    void navigate(id ? `/passwords/${id}` : '/passwords');
  };
  const reveal = (id: string) =>
    list.current?.scrollToIndex(rows.findIndex((r) => r.kind === 'item' && r.item.id === id));
  const toTop = () => list.current?.scrollToIndex(0);

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
    const found = sought === query ? shown : visibleItems(index, { query, filter, sort });
    const at = found.findIndex((i) => i.id === itemId);
    const next = found[Math.min(found.length - 1, Math.max(0, at + by))];
    if (!next) return undefined;
    open(next.id, { keys: true });
    reveal(next.id);
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
      const found = sought === query ? shown : visibleItems(index, { query, filter, sort });
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
                  {(status?.sources.filter((s) => s.id !== 'conch' && s.state === 'ready').length ??
                    0) > 0 && (
                    <>
                      <DropdownMenu.Separator />
                      {status?.sources
                        .filter((s) => s.state === 'ready')
                        .map((s) => (
                          <DropdownMenu.RadioItem
                            key={s.id}
                            value={JSON.stringify({ kind: 'source', source: s.id })}
                          >
                            {s.name} · {s.count ?? 0}
                          </DropdownMenu.RadioItem>
                        ))}
                    </>
                  )}
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
                    <DropdownMenu.RadioItem value="recent">Recently edited</DropdownMenu.RadioItem>
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
          </div>

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
                    sort={sort}
                    query={sought}
                    sourceMark={sourceMark}
                    onOpen={open}
                    onKeyDown={onListKey}
                    onRest={onRest}
                  />
                )
              }
            </VirtualList>
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
              summary={chosen}
              settle={settle}
              guard={guard}
              onEdit={() => setMode({ kind: 'edit' })}
              onBack={narrow ? () => open(undefined) : undefined}
              onDeleted={() => open(undefined)}
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
      {dialog}
    </div>
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
