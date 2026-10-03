import type { ActivityEntry, ActivityKind, Memory } from '@conch/protocol';
import {
  type ActivityRow,
  ActivityTimeline,
  Button,
  EmptyState,
  Heading,
  InlineCode,
  Page,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
} from '@conch/nacre';
import { useInfiniteQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

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

/** `code` in a title, as code. */
function withCode(text: string): ReactNode {
  const parts = text.split(/`([^`]+)`/);
  return parts.map((part, i) => (i % 2 ? <InlineCode key={i}>{part}</InlineCode> : part));
}

function rows(
  entries: ActivityEntry[],
  memories?: Memory[],
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
      title: withCode(entry.title),
      time: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
      where: entry.conversation.routine
        ? `${entry.conversation.title} (routine)`
        : entry.conversation.title,
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
  const navigate = useNavigate();
  const query = useInfiniteQuery({
    queryKey: safetyKeys.activity(kind === 'all' ? undefined : kind),
    queryFn: ({ pageParam }) =>
      safetyApi.activity({ before: pageParam, ...(kind !== 'all' && { kind }) }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next,
    refetchOnWindowFocus: true,
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
      {query.isPending ? (
        <Skeleton lines={6} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={kind === 'all' ? 'Nothing yet' : 'Nothing of this kind yet'}
          description="Commands it runs, files it changes, pages it reads and what it asks you will all be here."
        />
      ) : (
        <>
          <ActivityTimeline groups={rows(entries, memories)} onOpen={open} />
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
