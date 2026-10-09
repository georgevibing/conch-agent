import type { Memory, MemoryKind } from '@conch/protocol';
import {
  Button,
  DropdownMenu,
  EmptyState,
  formatBytes,
  Heading,
  IconButton,
  Input,
  MeaningHint,
  MemoryAdd,
  MemoryCells,
  MemoryGlance,
  memoryKindOrder,
  Page,
  Skeleton,
  Stack,
  toast,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Brain, MoreHorizontal, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { api } from '../../api/client';
import { keys, useAppState, useMemories } from '../../api/queries';
import { useUi } from '../../app/ui';
import { relativeTime } from '../../lib/time';
import { useLearning } from '../learning/api';
import { EarlierDialog, NEVER_INTENT, NeverDialog } from '../learning/LearningSections';
import { downloadMemories, memoryApi } from './api';
import { HeldMemory } from './HeldMemory';
import styles from './Memory.module.css';
import { holdOf, MemoryRow } from './MemoryRow';
import { browserLanguages, memoryKeys, useMemoryIndex, useMemorySearch, useTidy } from './queries';

/** A page of the list at a time: long lists stay quick to scan. */
const PAGE = 60;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** “Learning quietly · tidied last night”: the one line about what it's doing. */
function useStatus(learning: boolean): string {
  const tidy = useTidy().data;
  if (tidy?.running) return 'Tidying…';
  const head = learning ? 'Learning quietly' : 'Remembers only what you ask';
  if (!tidy?.lastAt) return head;
  const at = new Date(tidy.lastAt);
  const today = at.toDateString() === new Date().toDateString();
  const night = at.getHours() < 6;
  const when = today ? (night ? 'last night' : 'today') : relativeTime(tidy.lastAt);
  return `${head} · tidied ${when}`;
}

/** Search by meaning, offered in one line until it's there (ADR 0041). */
function MeaningLine() {
  const index = useMemoryIndex();
  const client = useQueryClient();
  const intent = useUi((s) => s.memoryIntent);
  const setIntent = useUi((s) => s.setMemoryIntent);
  const button = useRef<HTMLButtonElement>(null);
  const status = index.data;
  // ⌘K → Search memories by meaning: the offer, ready to press.
  useEffect(() => {
    if (intent !== 'meaning' || !status) return;
    setIntent(null);
    button.current?.scrollIntoView({ block: 'center' });
    button.current?.focus();
  }, [intent, status, setIntent]);
  if (!status) return null;
  const get = async () => {
    try {
      client.setQueryData(memoryKeys.index, await memoryApi.getModel(browserLanguages()));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const press = (label: string) => (
    <Button ref={button} size="sm" variant="ghost" onClick={() => void get()}>
      {label}
    </Button>
  );
  if (status.getting !== undefined)
    return <MeaningHint state="getting" progress={status.getting} />;
  if (status.mode === 'meaning')
    return status.indexed < status.total ? (
      <MeaningHint state="indexing" indexed={status.indexed} total={status.total} />
    ) : null;
  if (status.problem && status.offer)
    return <MeaningHint state="problem" problem={status.problem} action={press('Try again')} />;
  if (status.offer)
    return (
      <MeaningHint state="offer" size={formatBytes(status.offer.bytes)} action={press('Get it')} />
    );
  return null;
}

/**
 * What Conch knows about you (ADR 0032, ADR 0097). It learns and tidies
 * quietly, so the page is what it knows, not a report: a security question
 * first if there is one, then one calm summary and one list to search, add
 * to, change and forget.
 */
export function MemoryView({ inSettings = false }: { inSettings?: boolean } = {}) {
  const app = useAppState();
  const memories = useMemories();
  const learningStatus = useLearning().data;
  const client = useQueryClient();
  const openSettings = useUi((s) => s.openSettings);
  const intent = useUi((s) => s.memoryIntent);
  const setIntent = useUi((s) => s.setMemoryIntent);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<MemoryKind | null>(null);
  const [shownCount, setShownCount] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  // ⌘K → Things Conch won't learn again: open as the page opens.
  const [never, setNever] = useState(() => useUi.getState().memoryIntent === NEVER_INTENT);
  const [earlier, setEarlier] = useState(false);
  const q = useDebounced(query.trim(), 200);
  const search = useMemorySearch(q);
  const learning = app.data?.preferences.autoMemory ?? true;
  const status = useStatus(learning);

  const all = memories.data ?? [];
  const waiting = all.filter((m) => m.pending);
  const kept = all.filter((m) => !m.pending).sort((a, b) => b.updatedAt - a.updatedAt);
  const results: Memory[] = q ? (search.data?.results ?? []).filter((m) => !m.pending) : kept;
  const shown = results.filter((m) => !kind || m.kind === kind);
  const counts = Object.fromEntries(
    memoryKindOrder.map((k) => [k, kept.filter((m) => m.kind === k).length]),
  );
  const typed = query.trim();
  const offerAdd = typed.length > 0 && !all.some((m) => same(m.content, typed));
  const pastCount = learningStatus?.past.length ?? 0;
  const neverCount = learningStatus?.never.length ?? 0;
  // A page of its own, or a place inside Settings (its column is already the page).
  const Shell = inSettings ? Stack : Page;

  // The last tidy-up's changes stay reversible, one press away (ADR 0097).
  const lastRun = useTidy().data?.runs[0];
  const undoable = lastRun?.changes.filter((c) => c.state === 'applied') ?? [];
  const undoTidy = async () => {
    if (!lastRun) return;
    try {
      let next;
      for (const c of undoable) next = await memoryApi.answer(lastRun.id, c.id, 'undo');
      if (next) client.setQueryData(memoryKeys.tidy, next);
      void client.invalidateQueries({ queryKey: keys.memories });
      toast(undoable.length === 1 ? 'Put back 1 change' : `Put back ${undoable.length} changes`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const tidyNow = async () => {
    try {
      // What it changes arrives as `memory.changed`, like any other change.
      client.setQueryData(memoryKeys.tidy, await memoryApi.tidyNow());
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // ⌘K → Tidy up memories: as the page opens.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    if (intent === 'tidy') void tidyNow();
    if (intent === 'tidy' || intent === NEVER_INTENT) setIntent(null);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async () => {
    if (!offerAdd || adding) return;
    setAdding(true);
    try {
      await api.addMemory(typed, kind ?? 'fact');
      setQuery('');
      void client.invalidateQueries({ queryKey: keys.memories });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Shell gap={5}>
      <header className={styles.header}>
        <Heading level={1} display={!inSettings} size={inSettings ? 'xl' : '3xl'}>
          {inSettings ? 'Memories' : 'What Conch knows about you'}
        </Heading>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton label="More" variant="ghost">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item onSelect={() => void tidyNow()}>Tidy up now</DropdownMenu.Item>
            {undoable.length > 0 && (
              <DropdownMenu.Item onSelect={() => void undoTidy()}>
                Undo the last tidy-up
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item onSelect={() => openSettings('memory')}>
              Edit About you
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={() => setEarlier(true)} disabled={!pastCount}>
              What used to be true{pastCount ? ` (${pastCount})` : ''}
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => setNever(true)}>
              Won’t learn again{neverCount ? ` (${neverCount})` : ''}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={() => downloadMemories('md')}>
              Export as a document
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => downloadMemories('json')}>
              Export as data
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </header>

      {/* Only a security concern ever asks (ADR 0087, ADR 0097). */}
      {waiting.length > 0 && (
        <section className={styles.attention} aria-label="Needs you">
          {waiting.map((m) => (
            <HeldMemory key={m.id} memoryId={m.id} content={m.content} held={holdOf(m)} />
          ))}
        </section>
      )}

      {memories.isPending ? (
        <Skeleton shape="block" height="9rem" />
      ) : (
        <MemoryGlance
          counts={counts}
          filter={kind}
          onFilterChange={setKind}
          learning={learning}
          status={status}
        />
      )}

      <Stack gap={2}>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            leading={<Search />}
            aria-label="Search, or remember something new"
            placeholder="Search, or remember something new"
            value={query}
            clearable
            onClear={() => setQuery('')}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <MeaningLine />
      </Stack>

      {memories.isPending ? (
        <Skeleton lines={4} />
      ) : shown.length === 0 && !offerAdd ? (
        <EmptyState
          size="sm"
          icon={<Brain />}
          title={kept.length ? 'Nothing of this kind yet' : 'Nothing remembered yet'}
          description="Tell me something in a chat, or type it above."
        />
      ) : (
        <Stack gap={3}>
          <MemoryCells aria-label="Memories">
            {offerAdd && <MemoryAdd text={typed} onAdd={() => void add()} busy={adding} />}
            {shown.slice(0, shownCount).map((m, i) => (
              <MemoryRow key={m.id} memory={m} index={i} />
            ))}
          </MemoryCells>
          {shown.length > shownCount && (
            <div>
              <Button size="sm" variant="ghost" onClick={() => setShownCount((n) => n + PAGE)}>
                Show more
              </Button>
            </div>
          )}
        </Stack>
      )}

      <NeverDialog open={never} onOpenChange={setNever} />
      <EarlierDialog open={earlier} onOpenChange={setEarlier} />
    </Shell>
  );
}
