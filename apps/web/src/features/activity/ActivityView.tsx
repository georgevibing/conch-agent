import {
  foldText,
  fuzzyMatch,
  mergeRanges,
  type ActivityEntry,
  type ActivityKind,
  type Memory,
  type TextRange,
} from '@conch/protocol';
import {
  type ActivityRow,
  ActivityTimeline,
  Button,
  EmptyState,
  Heading,
  Highlight,
  InlineCode,
  Input,
  Page,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
} from '@conch/nacre';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { History, Search, SearchX } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import styles from './Activity.module.css';
import { useDebounced } from '../search/useSearch';

import { useMemories } from '../../api/queries';
import { useUi } from '../../app/ui';
import { dayGroup } from '../../lib/time';
import { safetyApi, safetyKeys } from '../safety/api';
import { ActivityAction } from '../undo/ActivityActions';

const FILTERS: { value: ActivityKind | 'all'; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'command', label: 'Commands' },
  { value: 'file', label: 'Files' },
  { value: 'web', label: 'Web' },
  { value: 'app', label: 'Apps' },
  { value: 'approval', label: 'Asked you' },
  { value: 'artifact', label: 'Made' },
];

/**
 * Where what you typed shows in `text`: each word on its own, so a search that
 * matched across the row (what happened, and the chat it was in) still marks
 * the part of it each place holds.
 */
export function matchedRanges(text: string, query: string): TextRange[] {
  const ranges: TextRange[] = [];
  for (const word of foldText(query).split(/\s+/).filter(Boolean))
    ranges.push(...(fuzzyMatch(text, word)?.ranges ?? []));
  return mergeRanges(ranges);
}

/** `code` in a title, as code, with what you searched for marked in both. */
function withCode(text: string, query = ''): ReactNode {
  const parts = text.split(/`([^`]+)`/);
  // Ranges are found in the title as it reads, without the backticks.
  const ranges = query ? matchedRanges(parts.join(''), query) : [];
  let at = 0;
  return parts.map((part, i) => {
    const local = ranges
      .map(([s, e]) => [s - at, e - at] as const)
      .filter(([s, e]) => e > 0 && s < part.length);
    at += part.length;
    const shown = local.length ? <Highlight text={part} ranges={local} /> : part;
    return i % 2 ? <InlineCode key={i}>{shown}</InlineCode> : <span key={i}>{shown}</span>;
  });
}

function rows(
  entries: ActivityEntry[],
  memories?: Memory[],
  query = '',
): { label: string; rows: ActivityRow[] }[] {
  const groups: { label: string; rows: ActivityRow[] }[] = [];
  for (const entry of entries) {
    const date = new Date(entry.at);
    const today = new Date().toDateString() === date.toDateString();
    const label = today
      ? 'Today'
      : dayGroup(entry.at) === 'Yesterday'
        ? 'Yesterday'
        : date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    let group = groups.at(-1);
    if (group?.label !== label) {
      group = { label, rows: [] };
      groups.push(group);
    }
    group.rows.push({
      id: entry.id,
      kind: entry.kind,
      status: entry.status,
      title: withCode(entry.title, query),
      time: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
      where: (
        <>
          {query ? (
            <Highlight
              text={entry.conversation.title}
              ranges={matchedRanges(entry.conversation.title, query)}
            />
          ) : (
            entry.conversation.title
          )}
          {entry.conversation.routine && ' (routine)'}
        </>
      ),
      action: <ActivityAction entry={entry} memories={memories} />,
    });
  }
  return groups;
}

/**
 * Activity (ADR 0028): everything the assistant did, across every chat and
 * routine, newest first. A row opens the chat at that moment; a change to
 * your files can be undone from here, and a memory forgotten (ADR 0030).
 */
export function ActivityView() {
  const [kind, setKind] = useState<ActivityKind | 'all'>('all');
  const [typed, setTyped] = useState('');
  // Searched on the server, so it finds things from long ago, not just what's shown.
  const searched = useDebounced(typed.trim(), 200);
  const navigate = useNavigate();
  const query = useInfiniteQuery({
    queryKey: safetyKeys.activity(kind === 'all' ? undefined : kind, searched),
    queryFn: ({ pageParam }) =>
      safetyApi.activity({
        before: pageParam,
        ...(kind !== 'all' && { kind }),
        ...(searched && { q: searched }),
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next,
    refetchOnWindowFocus: true,
    // While a new search is on its way, the last results stay rather than blink.
    placeholderData: keepPreviousData,
  });
  const entries = query.data?.pages.flatMap((p) => p.entries) ?? [];
  const memories = useMemories().data;

  const open = (row: ActivityRow) => {
    const entry = entries.find((e) => e.id === row.id);
    if (!entry) return;
    void navigate(`/c/${entry.conversation.id}`);
    // Lands on the moment itself, as a search result does.
    if (entry.anchor)
      useUi
        .getState()
        .openFind(entry.conversation.id, undefined, `[data-anchor="${entry.anchor}"]`);
  };

  return (
    <Page gap={5}>
      <Stack gap={1}>
        <Heading level={1} display size="3xl">
          Activity
        </Heading>
        <Text tone="muted">
          Everything your assistant did, in every chat and routine. Open any of it to see it where
          it happened.
        </Text>
      </Stack>
      <div className={styles.tools}>
        <Input
          className={styles.search}
          type="search"
          aria-label="Find in activity"
          placeholder="Find in activity"
          leading={<Search />}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          clearable
          onClear={() => setTyped('')}
        />
        <SegmentedControl
          aria-label="Show"
          value={kind}
          onValueChange={(v) => v && setKind(v as ActivityKind | 'all')}
        >
          {FILTERS.map((f) => (
            <SegmentedControl.Item key={f.value} value={f.value}>
              {f.label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </div>
      {query.isPending ? (
        <Skeleton lines={6} />
      ) : entries.length === 0 && searched ? (
        <EmptyState
          icon={<SearchX />}
          title={`Nothing matches “${searched}”`}
          description={
            kind === 'all'
              ? 'Try fewer or shorter words. It looks in what happened and the chat it happened in.'
              : 'Try fewer or shorter words, or look in Everything.'
          }
        />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={kind === 'all' ? 'Nothing yet' : 'Nothing of this kind yet'}
          description="Commands it runs, files it changes, pages it reads and what it asks you will all be here."
        />
      ) : (
        <>
          <ActivityTimeline groups={rows(entries, memories, searched)} onOpen={open} />
          {query.hasNextPage && (
            <Button
              variant="surface"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Show earlier
            </Button>
          )}
        </>
      )}
    </Page>
  );
}
