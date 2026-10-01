import { VAULT_TEMPLATES, type VaultItemType, type VaultProblem } from '@conch/protocol';
import {
  AlertDialog,
  Button,
  Callout,
  DropdownMenu,
  EmptyState,
  IconButton,
  Input,
  Skeleton,
  Stack,
  Text,
  toast,
  useMediaQuery,
  VaultConnectedSources,
  VaultHealth,
  VaultKindGlyph,
  VaultRow,
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
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { errorText } from '../integrations/queries';
import { vaultApi } from './api';
import {
  ago,
  counts,
  filterName,
  TYPE_NAMES,
  type VaultFilter,
  type VaultSort,
  visibleItems,
} from './filter';
import { ImportDialog } from './ImportDialog';
import { ItemDetail } from './ItemDetail';
import { ItemEditor } from './ItemEditor';
import { LockDialog, LockScreen } from './Lock';
import styles from './Passwords.module.css';
import { useVault, vaultKeys } from './queries';
import { SourcesDialog } from './SourcesDialog';

type Mode =
  { kind: 'view' } | { kind: 'edit' } | { kind: 'new'; type: VaultItemType } | { kind: 'pick' };

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
  const [filter, setFilter] = useState<VaultFilter>({ kind: 'all' });
  const [sort, setSort] = useState<VaultSort>('name');
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  const [importing, setImporting] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listPane = useRef<HTMLElement>(null);
  const location = useLocation();

  // ⌘K's "New password", "Import passwords" and "Check my passwords" arrive here.
  const asked = location.state as { new?: VaultItemType; import?: boolean; check?: boolean } | null;
  const [handled, setHandled] = useState<unknown>(null);
  if (asked && asked !== handled) {
    setHandled(asked);
    if (asked.new) setMode({ kind: 'new', type: asked.new });
    if (asked.import) setImporting(true);
    if (asked.check) setFilter({ kind: 'all' });
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
  const shown = useMemo(
    () => visibleItems(items, { query, filter, sort }),
    [items, query, filter, sort],
  );
  const tally = useMemo(() => counts(items), [items]);
  const status = data?.status;
  const open = (id: string | undefined) => {
    setMode({ kind: 'view' });
    void navigate(id ? `/passwords/${id}` : '/passwords');
  };

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

  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const at = shown.findIndex((i) => i.id === itemId);
    const next =
      shown[Math.min(shown.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      open(next.id);
      requestAnimationFrame(() =>
        listRef.current
          ?.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(next.id)}"]`)
          ?.focus(),
      );
    }
  };

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
              value={query}
              clearable
              onClear={() => setQuery('')}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  if (shown[0]) open(shown[0].id);
                  listRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
                }
              }}
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
                  {filter.kind !== 'deleted' && (
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
                    onValueChange={(v) => setSort(v as VaultSort)}
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

          <div className={styles.list} ref={listRef} role="list">
            {isLoading
              ? Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} style={{ blockSize: 52, margin: '4px 12px' }} />
                ))
              : shown.map((item) => (
                  <div role="listitem" key={item.id}>
                    <VaultRow
                      data-id={item.id}
                      kind={item.type}
                      title={item.title}
                      subtitle={item.subtitle}
                      domain={item.domains[0]}
                      source={item.source}
                      favorite={item.favorite}
                      totp={item.totp}
                      passkey={item.passkey}
                      issues={item.problems}
                      selected={item.id === itemId}
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
                      onClick={() => open(item.id)}
                      onKeyDown={onListKey}
                    />
                  </div>
                ))}
            {!isLoading && shown.length === 0 && !empty && (
              <EmptyState
                size="sm"
                icon={<Search />}
                title={
                  query ? `Nothing matches “${query}”` : `No ${filterName(filter).toLowerCase()}`
                }
                description={query ? 'Try a site name or a username.' : undefined}
              />
            )}
          </div>
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
