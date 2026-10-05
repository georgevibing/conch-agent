import type { MemoryKind, TidyRun, TidyStatus } from '@conch/protocol';
import {
  Button,
  DropdownMenu,
  EmptyState,
  formatBytes,
  Heading,
  Input,
  MeaningSearch,
  MemoryList,
  Page,
  SegmentedControl,
  Skeleton,
  Stack,
  Switch,
  Text,
  TidyChangeItem,
  TidyReport,
  toast,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Brain, Download, Plus, Search, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { api } from '../../api/client';
import { keys, useAppState, useMemories, useUpdateSettings } from '../../api/queries';
import { useUi } from '../../app/ui';
import { relativeTime } from '../../lib/time';
import { EarlierSection, LearnedSection, NeverSection } from '../learning/LearningSections';
import { downloadMemories, memoryApi } from './api';
import styles from './Memory.module.css';
import { MemoryRow } from './MemoryRow';
import { browserLanguages, memoryKeys, useMemoryIndex, useMemorySearch, useTidy } from './queries';

const KINDS: { value: MemoryKind | 'all'; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'preference', label: 'Preferences' },
  { value: 'person', label: 'People' },
  { value: 'project', label: 'Projects' },
  { value: 'fact', label: 'Facts' },
];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function when(run: TidyRun) {
  const date = new Date(run.at);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = date.toDateString() === new Date().toDateString();
  if (run.trigger === 'nightly') return `${today ? 'Last night' : relativeTime(run.at)} at ${time}`;
  return `${today ? 'Today' : relativeTime(run.at)} at ${time}`;
}

function title(run: TidyRun) {
  const n = run.changes.length;
  if (!n) return 'Nothing needed tidying';
  const memories = n === 1 ? '1 memory' : `${n} memories`;
  // Learned from a long chat just before its start was summarised (ADR 0055).
  if (run.chat) return `Conch learned ${memories} from a long chat before summarising it`;
  return run.trigger === 'nightly'
    ? `Conch tidied ${memories} while you slept`
    : `Conch tidied ${memories}`;
}

/** Tidying up: the tidy-up's runs, each change with Keep and Undo. */
function Tidying({ autoMemory }: { autoMemory: boolean }) {
  const tidy = useTidy();
  const client = useQueryClient();
  const update = useUpdateSettings();
  const intent = useUi((s) => s.memoryIntent);
  const setIntent = useUi((s) => s.setMemoryIntent);
  const asked = useRef(false);

  const now = async () => {
    try {
      client.setQueryData(memoryKeys.tidy, await memoryApi.tidyNow());
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  // ⌘K → Tidy up memories: start as the page opens.
  useEffect(() => {
    if (asked.current || intent !== 'tidy') return;
    asked.current = true;
    setIntent(null);
    void now();
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const answer = async (run: TidyRun, changeId: string, a: 'keep' | 'undo' | 'dismiss') => {
    try {
      client.setQueryData<TidyStatus>(memoryKeys.tidy, await memoryApi.answer(run.id, changeId, a));
      void client.invalidateQueries({ queryKey: keys.memories });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const status = tidy.data;
  const runs = (status?.runs ?? []).filter((r, i) => i === 0 || r.changes.length > 0).slice(0, 3);
  return (
    <section className={styles.section} aria-labelledby="memory-learnings">
      <div className={styles.sectionHead}>
        <Heading level={2} size="lg" id="memory-learnings">
          Tidying up
        </Heading>
        <Button
          size="sm"
          variant="surface"
          leadingIcon={<Sparkles />}
          loading={status?.running}
          onClick={() => void now()}
        >
          {status?.running ? 'Tidying…' : 'Tidy up now'}
        </Button>
      </div>
      <Switch
        checked={status?.nightly ?? false}
        onCheckedChange={(checked) =>
          void update
            .mutateAsync({ preferences: { tidyMemory: checked } })
            .then(() => client.invalidateQueries({ queryKey: memoryKeys.tidy }))
        }
        label="Tidy up every night"
        description={`While you sleep, Conch merges repeats and updates what’s changed — with the cheapest model you have. Every change shows up here, with Undo, and what used to be true is kept under Earlier.${autoMemory ? '' : ' Learn from your chats is off, so anything new waits for your OK.'}`}
      />
      {tidy.isPending ? (
        <Skeleton shape="block" height="5rem" />
      ) : runs.length === 0 ? (
        <Text size="sm" tone="muted">
          No tidy-ups yet. Try one now: nothing changes without showing you.
        </Text>
      ) : (
        runs.map((run) => (
          <TidyReport
            key={run.id}
            title={title(run)}
            when={when(run)}
            note={
              run.problem ??
              (!run.model && !run.changes.length
                ? 'With no model to ask, Conch only looked for exact repeats.'
                : undefined)
            }
          >
            {run.changes.length > 0 &&
              run.changes.map((c) => (
                <TidyChangeItem
                  key={c.id}
                  kind={c.kind}
                  state={c.state}
                  before={c.before.map((m) => m.content)}
                  after={c.after?.content}
                  why={c.why}
                  untrusted={c.untrusted}
                  actions={
                    <>
                      <Button
                        size="sm"
                        variant="soft"
                        onClick={() => void answer(run, c.id, 'keep')}
                      >
                        Keep
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        tone="neutral"
                        onClick={() =>
                          void answer(run, c.id, c.state === 'pending' ? 'dismiss' : 'undo')
                        }
                      >
                        {c.state === 'pending' ? 'Don’t keep' : 'Undo'}
                      </Button>
                    </>
                  }
                />
              ))}
          </TidyReport>
        ))
      )}
    </section>
  );
}

/** How search works now, and the one thing that would make it better (ADR 0041). */
function SearchMode() {
  const index = useMemoryIndex();
  const client = useQueryClient();
  const intent = useUi((s) => s.memoryIntent);
  const setIntent = useUi((s) => s.setMemoryIntent);
  const button = useRef<HTMLButtonElement>(null);
  const status = index.data;
  // ⌘K → Search memories by meaning: the offer, ready to press.
  const asked = intent === 'meaning';
  useEffect(() => {
    if (!asked || !status) return;
    setIntent(null);
    button.current?.scrollIntoView({ block: 'center' });
    button.current?.focus();
  }, [asked, status, setIntent]);
  if (!status) return null;
  const get = async () => {
    try {
      client.setQueryData(memoryKeys.index, await memoryApi.getModel(browserLanguages()));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const press = (label: string) => (
    <Button ref={button} size="sm" variant="surface" onClick={() => void get()}>
      {label}
    </Button>
  );
  if (status.getting !== undefined)
    return <MeaningSearch state="getting" progress={status.getting} />;
  if (status.mode === 'meaning')
    return status.indexed < status.total ? (
      <MeaningSearch state="indexing" indexed={status.indexed} total={status.total} />
    ) : (
      <MeaningSearch state="meaning" model={status.model} source={status.source} />
    );
  if (status.problem && status.offer)
    return <MeaningSearch state="problem" problem={status.problem} action={press('Try again')} />;
  if (status.offer)
    return (
      <MeaningSearch
        state="offer"
        size={formatBytes(status.offer.bytes)}
        multilingual={status.offer.multilingual}
        action={press('Get it')}
      />
    );
  return <MeaningSearch state="words" problem={status.problem} />;
}

/**
 * What Conch knows about you (ADR 0032): who you are, what it remembers by
 * kind, what's waiting for your OK, and what it learned lately — searchable,
 * editable, forgettable and yours to export.
 */
export function MemoryView({ inSettings = false }: { inSettings?: boolean } = {}) {
  const app = useAppState();
  const memories = useMemories();
  const client = useQueryClient();
  const openSettings = useUi((s) => s.openSettings);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<MemoryKind | 'all'>('all');
  const [draft, setDraft] = useState('');
  const q = useDebounced(query.trim(), 200);
  const search = useMemorySearch(q);

  const all = memories.data ?? [];
  const waiting = all.filter((m) => m.pending);
  const kept = all.filter((m) => !m.pending);
  const shown = (q ? (search.data?.results ?? []) : kept).filter(
    (m) => kind === 'all' || m.kind === kind,
  );
  const profile = app.data?.profile;
  // A page of its own, or a place inside Settings (its column is already the page).
  const Shell = inSettings ? Stack : Page;

  const add = async () => {
    const content = draft.trim();
    if (!content) return;
    try {
      await api.addMemory(content, kind === 'all' ? 'fact' : kind);
      setDraft('');
      void client.invalidateQueries({ queryKey: keys.memories });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Shell gap={8}>
      <header className={styles.header}>
        <Stack gap={1}>
          <Heading level={1} display={!inSettings} size={inSettings ? 'xl' : '3xl'}>
            What Conch knows about you
          </Heading>
          <Text tone="muted">
            Everything your assistant remembers, and where it learned it. Plain files on this
            computer — read, change or forget any of it.
          </Text>
        </Stack>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="surface" leadingIcon={<Download />}>
              Export
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item onSelect={() => downloadMemories('md')}>
              As a document (Markdown)
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => downloadMemories('json')}>
              As data (JSON)
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </header>

      <section className={styles.section} aria-labelledby="memory-about">
        <div className={styles.sectionHead}>
          <Heading level={2} size="lg" id="memory-about">
            About you
          </Heading>
          <Button size="sm" variant="ghost" onClick={() => openSettings('about')}>
            Edit
          </Button>
        </div>
        <div className={styles.profile}>
          {profile?.name || profile?.about ? (
            <>
              {profile.name && <Text weight="medium">{profile.name}</Text>}
              {profile.about && (
                <Text size="sm" tone="muted" className={styles.about}>
                  {profile.about}
                </Text>
              )}
            </>
          ) : (
            <Text size="sm" tone="muted">
              Nothing yet. A few lines about you are always in context, so you never repeat
              yourself.
            </Text>
          )}
        </div>
      </section>

      {waiting.length > 0 && (
        <section className={styles.section} aria-labelledby="memory-waiting">
          <Heading level={2} size="lg" id="memory-waiting">
            Waiting for your OK
          </Heading>
          <Text size="sm" tone="muted">
            Learned in chats that read something from outside, which could have been steering it.
          </Text>
          <MemoryList aria-label="Waiting for your OK">
            {waiting.map((m) => (
              <MemoryRow key={m.id} memory={m} showKind />
            ))}
          </MemoryList>
        </section>
      )}

      <LearnedSection />

      <Tidying autoMemory={app.data?.preferences.autoMemory ?? true} />

      <section className={styles.section} aria-labelledby="memory-all">
        <Heading level={2} size="lg" id="memory-all">
          Memories
        </Heading>
        <div className={styles.tools}>
          <Input
            rootClassName={styles.search}
            leading={<Search />}
            aria-label="Search memories"
            placeholder="Search memories…"
            value={query}
            clearable
            onClear={() => setQuery('')}
            onChange={(e) => setQuery(e.target.value)}
          />
          <SegmentedControl
            aria-label="Show"
            size="sm"
            value={kind}
            onValueChange={(v) => v && setKind(v as MemoryKind | 'all')}
          >
            {KINDS.map((k) => (
              <SegmentedControl.Item key={k.value} value={k.value}>
                {k.label}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl>
        </div>
        <form
          className={styles.add}
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            aria-label="Add a memory"
            placeholder="Add something for me to remember…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit" variant="surface" leadingIcon={<Plus />} disabled={!draft.trim()}>
            Add
          </Button>
        </form>
        {memories.isPending ? (
          <Skeleton lines={4} />
        ) : shown.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Brain />}
            title={
              q
                ? 'Nothing matches'
                : kept.length
                  ? 'Nothing of this kind yet'
                  : 'Nothing remembered yet'
            }
            description={
              q
                ? 'Try other words: search forgives typos and other forms of a word.'
                : 'Tell me things like “remember I’m vegetarian” in a chat, or add them here.'
            }
          />
        ) : (
          <MemoryList aria-label="Memories">
            {shown.map((m) => (
              <MemoryRow key={m.id} memory={m} showKind={kind === 'all'} />
            ))}
          </MemoryList>
        )}
        <SearchMode />
      </section>

      <EarlierSection />

      <NeverSection />
    </Shell>
  );
}
