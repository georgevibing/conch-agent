import type { ConversationSummary } from '@conch/protocol';
import {
  type ArchivedChat,
  ArchivedChats,
  DropdownMenu,
  EmptyState,
  Heading,
  IconButton,
  Input,
  IntegrationLogo,
  Kbd,
  Page,
  Skeleton,
  Stack,
  Text,
  toast,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, MoreHorizontal, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../../api/client';
import { keys, useConversations } from '../../api/queries';
import { relativeTime } from '../../lib/time';
import { APPS } from '../channels/describe';
import { fuzzyFilter } from '../search/fuzzy';
import { DeleteChat } from './DeleteChat';
import { archivedChats, useArchive } from './useArchive';
import styles from './Archive.module.css';

/** Past this many, a box to find one by name. */
const FILTER_FROM = 6;

function row(c: ConversationSummary, ranges?: ArchivedChat['ranges']): ArchivedChat {
  const app = c.origin?.kind === 'channel' ? APPS[c.origin.channel] : undefined;
  return {
    id: c.id,
    title: c.title,
    ...(ranges && { ranges }),
    ...(c.preview && c.preview !== c.title && { preview: c.preview }),
    archived: relativeTime(c.archivedAt ?? c.updatedAt),
    ...(app &&
      c.origin?.kind === 'channel' && {
        icon: (
          <IntegrationLogo
            brand={c.origin.channel}
            name={app.name}
            color={app.color}
            size="xs"
            decorative
          />
        ),
      }),
  };
}

/**
 * The archive: chats put away from the list, most recently archived first.
 * Each opens as it is, goes back to the list, or is deleted (after asking);
 * all of them at once from the page's menu.
 */
export function ArchiveView() {
  const { data: conversations, isPending } = useConversations();
  const { unarchive, remove } = useArchive();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  // What's being deleted stays put while the question closes, so its words don't change.
  // Delete all deletes the chats it named, not one archived while it asked.
  const [deleting, setDeleting] = useState<ConversationSummary | { all: ConversationSummary[] }>();
  const [asking, setAsking] = useState(false);
  const ask = (target: ConversationSummary | { all: ConversationSummary[] } | undefined) => {
    if (!target) return;
    setDeleting(target);
    setAsking(true);
  };

  const archived = useMemo(() => archivedChats(conversations), [conversations]);
  const q = query.trim();
  const shown = useMemo(
    () =>
      q
        ? fuzzyFilter(archived, q, (c) => c.title, archived.length).map(({ item, match }) =>
            row(item, match.ranges),
          )
        : archived.map((c) => row(c)),
    [archived, q],
  );
  const byId = new Map(archived.map((c) => [c.id, c]));

  const unarchiveAll = async () => {
    const all = archived;
    client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
      list?.map((c) => {
        if (!all.some((a) => a.id === c.id)) return c;
        const { archivedAt: _gone, ...rest } = c;
        return rest;
      }),
    );
    const results = await Promise.allSettled(all.map((c) => api.archiveConversation(c.id, false)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) {
      void client.invalidateQueries({ queryKey: keys.conversations });
      toast.error(
        failed === all.length
          ? 'Couldn’t unarchive your chats'
          : `${failed} of ${all.length} chats stayed archived`,
        { description: 'Try again in a moment.' },
      );
    } else {
      toast.success(
        all.length === 1
          ? 'Your archived chat is back in your list'
          : `${all.length} chats are back in your list`,
      );
    }
  };

  const deleteAll = async (all: ConversationSummary[]) => {
    const results = await Promise.all(all.map((c) => remove(c)));
    const done = results.filter(Boolean).length;
    if (done) toast.success(done === 1 ? 'Deleted 1 chat' : `Deleted ${done} chats`);
  };

  return (
    <Page gap={5}>
      <div className={styles.head}>
        <Stack gap={1} className={styles.intro}>
          <Heading level={1} display size="3xl">
            Archived chats
          </Heading>
          <Text tone="muted">
            Put away, not gone. They still turn up in search, and writing in one brings it back to
            your list.
          </Text>
        </Stack>
        {archived.length > 1 && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton label="More for archived chats" tooltip="More">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item icon={<ArchiveRestore />} onSelect={() => void unarchiveAll()}>
                Unarchive all
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                icon={<Trash2 />}
                tone="danger"
                onSelect={() => ask({ all: archived })}
              >
                Delete all…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        )}
      </div>
      {isPending ? (
        <Skeleton lines={4} />
      ) : archived.length === 0 ? (
        <EmptyState
          icon={<Archive />}
          title="Nothing archived"
          description="Archive a chat from its ⋯ in your list to put it away without deleting it. It comes back the moment you write in it."
        />
      ) : (
        <>
          {archived.length >= FILTER_FROM && (
            <Input
              aria-label="Find an archived chat"
              placeholder="Find an archived chat"
              leading={<Search />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              clearable
              onClear={() => setQuery('')}
            />
          )}
          {shown.length ? (
            <ArchivedChats
              chats={shown}
              onOpen={(chat) => void navigate(`/c/${chat.id}`)}
              onUnarchive={(chat) => {
                const c = byId.get(chat.id);
                if (c) void unarchive(c);
              }}
              onDelete={(chat) => ask(byId.get(chat.id))}
            />
          ) : (
            <Text tone="muted" className={styles.none}>
              No archived chat is called “{q}”. To find words inside them, search with{' '}
              <Kbd keys="mod+k" size="sm" />.
            </Text>
          )}
        </>
      )}
      <DeleteChat
        open={asking}
        onOpenChange={setAsking}
        {...(deleting && 'all' in deleting
          ? { count: deleting.all.length }
          : deleting && { chat: deleting })}
        onDelete={() => {
          if (!deleting) return;
          if ('all' in deleting) void deleteAll(deleting.all);
          else void remove(deleting);
        }}
      />
    </Page>
  );
}
