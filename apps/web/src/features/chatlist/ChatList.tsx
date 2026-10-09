import type { ChatFolder, ConversationSummary } from '@conch/protocol';
import {
  AlertDialog,
  Button,
  ChatListSection,
  ChatRow,
  DropdownMenu,
  FolderDialog,
  FolderMark,
  IconButton,
  ScrollArea,
  SelectionBar,
  Text,
  TidyCard,
  useMediaQuery,
} from '@conch/nacre';
import {
  Archive,
  Check,
  FolderInput,
  FolderPlus,
  ListChecks,
  ListFilter,
  MoreHorizontal,
  Pencil,
  Pin,
  SquarePen,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';

import { useConversations, useFolders } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useHotkey } from '../../app/useHotkey';
import { DeleteChat } from '../archive/DeleteChat';
import { ARCHIVE_PATH, archivedChats } from '../archive/useArchive';
import { arrange, staleChats, TIDY_AFTER_DAYS, type ChatFilter } from './arrange';
import { useDraftKeys } from '../chat/drafts';
import { ChatRowItem, type Selection } from './ChatRowItem';
import styles from './ChatList.module.css';
import { useNewChatFolder, useNewChatIn, type NewChatState } from './newChat';
import { PinnedAppsDock } from './PinnedAppsDock';
import { useOrganise } from './useOrganise';

const FILTER_KEY = 'conch.chatFilter';
const CLOSED_KEY = 'conch.foldersClosed';
const TIDY_KEY = 'conch.tidyDismissed';

function readStored<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* A private window keeps it for now only. */
  }
}
const isFilter = (v: unknown): v is ChatFilter => v === 'all' || v === 'unread' || v === 'apps';
const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string');
const isNumber = (v: unknown): v is number => typeof v === 'number';

const FILTER_WORDS: Record<ChatFilter, string> = {
  all: 'All chats',
  unread: 'New',
  apps: 'From chat apps',
};

/**
 * The chat list (ADR 0089): pinned apps as tiles, then what needs you, what
 * you pinned, your folders, and the rest by when — with Select, drag and
 * drop, a filter, and a tidy-up offered when old chats pile up.
 */
export function ChatList({ onNavigate }: { onNavigate?: () => void }) {
  const { data: conversations, isPending } = useConversations();
  const { data: folders } = useFolders();
  const organise = useOrganise();
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const folderFocus = useUi((s) => s.folderFocus);
  const folderDialog = useUi((s) => s.folderDialog);
  const openFolderDialog = useUi((s) => s.openFolderDialog);
  const closeFolderDialog = useUi((s) => s.closeFolderDialog);

  const [chosenFilter, setFilterState] = useState<ChatFilter>(() =>
    readStored(FILTER_KEY, 'all', isFilter),
  );
  const setFilter = (next: ChatFilter) => {
    setFilterState(next);
    store(FILTER_KEY, next);
  };
  const [closed, setClosedState] = useState<string[]>(() => readStored(CLOSED_KEY, [], isStrings));
  const setClosed = (id: string, isClosed: boolean) => {
    const next = isClosed ? [...new Set([...closed, id])] : closed.filter((c) => c !== id);
    setClosedState(next);
    store(CLOSED_KEY, next);
  };
  const [tidyDismissed, setTidyDismissed] = useState(() => readStored(TIDY_KEY, 0, isNumber));
  const [editing, setEditing] = useState<ChatFolder>();
  const [removing, setRemoving] = useState<ChatFolder>();
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const anchor = useRef<string | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const newChatIn = useNewChatIn();
  // Something written and not sent, here or on another device (ADR 0124).
  const drafted = useDraftKeys();
  const startingIn = useNewChatFolder();
  const finger = useMediaQuery('(pointer: coarse)');

  const hasChannelChats = (conversations ?? []).some(
    (c) => c.origin?.kind === 'channel' && !c.archivedAt,
  );
  // A filter with nothing left to offer shows everything.
  const filter: ChatFilter = chosenFilter === 'apps' && !hasChannelChats ? 'all' : chosenFilter;
  const list = useMemo(
    () => arrange(conversations, folders, { filter }),
    [conversations, folders, filter],
  );
  const known = folders ?? [];
  const byId = useMemo(() => new Map((conversations ?? []).map((c) => [c.id, c])), [conversations]);
  const pick = (ids: Iterable<string>) =>
    [...ids].map((id) => byId.get(id)).filter((c): c is ConversationSummary => Boolean(c));
  const stale = staleChats(conversations);
  // Not now: quiet until ten more have piled up.
  const showTidy =
    filter === 'all' && stale.length > 0 && (!tidyDismissed || stale.length >= tidyDismissed + 10);
  const archived = archivedChats(conversations);
  // ⌘K → a folder: unfolded (until you fold it) and brought into view.
  const isOpen = (id: string) => folderFocus?.id === id || !closed.includes(id);
  useEffect(() => {
    if (!folderFocus) return;
    requestAnimationFrame(() =>
      scroller.current
        ?.querySelector(`[data-folder="${CSS.escape(folderFocus.id)}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    );
  }, [folderFocus]);

  // What's on screen, in order: chats in a folded folder can't be stepped to or swept
  // into a Shift-click range, since you can't see them.
  const folded = new Set(
    list.folders.filter((f) => !isOpen(f.folder.id)).flatMap((f) => f.chats.map((c) => c.id)),
  );
  const visible = list.order.filter((c) => !folded.has(c.id));

  // ⌥↑ / ⌥↓: the chat above or below, in the order the list shows them.
  const step = (by: number) => {
    const order = visible;
    if (!order.length) return;
    const at = order.findIndex((c) => c.id === conversationId);
    const next = at < 0 ? (by > 0 ? order[0] : order.at(-1)) : order[at + by];
    if (next) void navigate(`/c/${next.id}`);
  };
  useHotkey('alt+up', () => step(-1), false);
  useHotkey('alt+down', () => step(1), false);

  // ── Select ───────────────────────────────────────────────────────────────

  const selecting = selected !== null;
  const endSelecting = () => {
    setSelected(null);
    anchor.current = undefined;
  };
  const toggle = (id: string, on: boolean, range: boolean) => {
    setSelected((current) => {
      const next = new Set(current ?? []);
      const order = visible.map((c) => c.id);
      const from = anchor.current ? order.indexOf(anchor.current) : -1;
      const to = order.indexOf(id);
      if (range && from >= 0 && to >= 0) {
        const [a, b] = from < to ? [from, to] : [to, from];
        for (const each of order.slice(a, b + 1)) next.add(each);
      } else if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    anchor.current = id;
  };
  const selectionFor = (chat: ConversationSummary): Selection => {
    const isSelected = selected?.has(chat.id) ?? false;
    return {
      selecting,
      selected: isSelected,
      dragIds: isSelected && selected ? [...selected] : [chat.id],
      onSelectedChange: (on, event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) =>
        toggle(chat.id, on, event.shiftKey),
      onSelectRequest: () => {
        setSelected(new Set([chat.id]));
        anchor.current = chat.id;
      },
      startSelecting: () => {
        setSelected(new Set([chat.id]));
        anchor.current = chat.id;
      },
    };
  };
  const chosen = pick(selected ?? []);
  const allPinned = chosen.length > 0 && chosen.every((c) => c.pinned !== undefined);
  const afterBulk = (ok: boolean) => ok && endSelecting();

  // ── Drops ────────────────────────────────────────────────────────────────

  const dropOnPinned = (ids: string[]) => {
    const chats = pick(ids);
    const last = list.pinned.at(-1)?.pinned;
    // Dropped on Pinned: pinned, at the end, in the order they were in.
    void Promise.all(
      chats.map((c, i) =>
        organise.change([c], {
          pinned: true,
          pinOrder: (last ?? Date.now()) + i + 1,
          folder: null,
        }),
      ),
    );
  };
  const dropBefore = (target: ConversationSummary) => (ids: string[]) => {
    const at = list.pinned.findIndex((c) => c.id === target.id);
    const above = list.pinned[at - 1]?.pinned;
    const below = target.pinned ?? Date.now();
    const chats = pick(ids);
    const top = above ?? below - chats.length - 1;
    const gap = (below - top) / (chats.length + 1);
    void Promise.all(
      chats.map((c, i) =>
        organise.change([c], { pinned: true, pinOrder: top + gap * (i + 1), folder: null }),
      ),
    );
  };
  const dropInFolder = (folder: ChatFolder) => (ids: string[]) =>
    void organise.change(pick(ids), { folder: folder.id, pinned: false });
  const dropLoose = (ids: string[]) =>
    void organise.change(
      pick(ids).filter((c) => c.pinned !== undefined || c.folderId),
      { folder: null, pinned: false },
    );

  // ── Pieces ───────────────────────────────────────────────────────────────

  const row = (chat: ConversationSummary, neighbours?: ConversationSummary[]) => {
    const at = neighbours?.findIndex((c) => c.id === chat.id) ?? -1;
    return (
      <ChatRowItem
        key={chat.id}
        chat={chat}
        drafted={drafted.has(chat.id)}
        folders={known}
        selection={selectionFor(chat)}
        onNavigate={onNavigate}
        {...(neighbours &&
          at >= 0 && {
            pinNeighbours: {
              above: neighbours[at - 1],
              aboveThat: neighbours[at - 2],
              below: neighbours[at + 1],
              belowThat: neighbours[at + 2],
            },
            onDropBefore: dropBefore(chat),
          })}
      />
    );
  };

  const filterMenu = (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton size="sm" label="Show and sort chats" tooltip="Show and sort chats">
          <ListFilter />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Label>Show</DropdownMenu.Label>
        <DropdownMenu.RadioGroup value={filter} onValueChange={(v) => isFilter(v) && setFilter(v)}>
          <DropdownMenu.RadioItem value="all">All chats</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="unread">New</DropdownMenu.RadioItem>
          {hasChannelChats && (
            <DropdownMenu.RadioItem value="apps">From chat apps</DropdownMenu.RadioItem>
          )}
        </DropdownMenu.RadioGroup>
        <DropdownMenu.Separator />
        <DropdownMenu.Item icon={<FolderPlus />} onSelect={() => openFolderDialog()}>
          New folder…
        </DropdownMenu.Item>
        <DropdownMenu.Item
          icon={<ListChecks />}
          disabled={!list.order.length}
          onSelect={() => setSelected(new Set())}
        >
          Select chats
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );

  const folderActions = (folder: ChatFolder) => (
    <>
      <IconButton
        size="sm"
        label={`New chat in ${folder.name}`}
        tooltip={`New chat in ${folder.name}`}
        onClick={() => {
          // Unfolded, so the new chat shows where it's going.
          setClosed(folder.id, false);
          newChatIn(folder);
          onNavigate?.();
        }}
      >
        <SquarePen />
      </IconButton>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <IconButton size="sm" label={`Options for the folder ${folder.name}`} tooltip={false}>
            <MoreHorizontal />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start">
          <DropdownMenu.Item icon={<Pencil />} onSelect={() => setEditing(folder)}>
            Edit
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item icon={<Trash2 />} tone="danger" onSelect={() => setRemoving(folder)}>
            Remove folder
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </>
  );

  // The chat being started in a folder: its place, at the top of the folder, until it exists.
  const startingRow = (folder: ChatFolder) => (
    <ChatRow key="new" active leading={<SquarePen aria-hidden />}>
      <NavLink to="/" end state={{ folder: folder.id } satisfies NewChatState} onClick={onNavigate}>
        New chat
      </NavLink>
    </ChatRow>
  );

  const nothingShown =
    !list.needsYou.length &&
    !list.pinned.length &&
    !list.dated.length &&
    !list.folders.some((f) => f.chats.length);

  return (
    <>
      <ScrollArea className={styles.scroll} viewportRef={scroller}>
        <PinnedAppsDock onNavigate={onNavigate} />
        {list.total > 0 && (
          <div className={styles.heading}>
            <Text as="span" size="xs" weight="medium" tone="subtle" className={styles.headingLabel}>
              {filter === 'all' ? 'Chats' : FILTER_WORDS[filter]}
            </Text>
            {filter !== 'all' && (
              <Button size="sm" variant="ghost" tone="neutral" onClick={() => setFilter('all')}>
                Show all
              </Button>
            )}
            {filterMenu}
          </div>
        )}
        {!isPending && list.total === 0 && (
          <Text size="sm" tone="subtle" className={styles.empty}>
            Your conversations will appear here.
          </Text>
        )}
        {list.total > 0 && filter !== 'all' && nothingShown && (
          <Text size="sm" tone="subtle" className={styles.empty}>
            {filter === 'unread'
              ? 'Nothing new. You’re all caught up.'
              : 'No chats from chat apps.'}
          </Text>
        )}
        {list.needsYou.length > 0 && (
          <ChatListSection label="Needs you">{list.needsYou.map((c) => row(c))}</ChatListSection>
        )}
        {list.pinned.length > 0 && (
          <ChatListSection label="Pinned" onDropChats={dropOnPinned} dropHint="Drop to pin">
            {list.pinned.map((c) => row(c, list.pinned))}
          </ChatListSection>
        )}
        {list.folders.map(({ folder, chats }) => (
          <div key={folder.id} data-folder={folder.id}>
            <ChatListSection
              kind="folder"
              label={folder.name}
              icon={<FolderMark glyph={folder.glyph} color={folder.color} />}
              count={chats.length}
              collapsible
              open={isOpen(folder.id)}
              onOpenChange={(open) => {
                if (folderFocus?.id === folder.id) useUi.setState({ folderFocus: undefined });
                setClosed(folder.id, !open);
              }}
              actions={folderActions(folder)}
              onDropChats={dropInFolder(folder)}
              dropHint={`Drop to move to ${folder.name}`}
              empty={
                finger
                  ? 'Hold a chat to drag it here, or choose Move to.'
                  : 'Drag chats here, or choose Move to.'
              }
            >
              {startingIn?.id === folder.id && startingRow(folder)}
              {chats.map((c) => row(c))}
            </ChatListSection>
          </div>
        ))}
        {list.dated.map((group) => (
          <ChatListSection
            key={group.key}
            label={group.label}
            onDropChats={dropLoose}
            dropHint="Drop to take out of Pinned or a folder"
          >
            {group.chats.map((c) => row(c))}
          </ChatListSection>
        ))}
        {archived.length > 0 && filter === 'all' && (
          <ul className={styles.archived}>
            <ChatRow
              quiet
              leading={<Archive aria-hidden />}
              active={archived.some((c) => c.id === conversationId)}
              trailing={
                <span className={styles.count}>
                  {archived.length}{' '}
                  <span className="nc-visually-hidden">
                    {archived.length === 1 ? 'chat' : 'chats'}
                  </span>
                </span>
              }
            >
              <NavLink to={ARCHIVE_PATH} onClick={onNavigate}>
                Archived
              </NavLink>
            </ChatRow>
          </ul>
        )}
        {showTidy && (
          <TidyCard
            className={styles.tidy}
            count={stale.length}
            days={TIDY_AFTER_DAYS}
            onTidy={() => void organise.archive(stale)}
            onDismiss={() => {
              setTidyDismissed(stale.length);
              store(TIDY_KEY, stale.length);
            }}
          />
        )}
      </ScrollArea>
      {selecting && (
        <SelectionBar count={chosen.length} onDone={endSelecting}>
          <IconButton
            size="sm"
            label={allPinned ? 'Unpin' : 'Pin'}
            disabled={!chosen.length}
            onClick={() => void organise.pin(chosen, !allPinned).then(afterBulk)}
          >
            <Pin />
          </IconButton>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton size="sm" label="Move to" disabled={!chosen.length}>
                <FolderInput />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="start" side="top">
              {known.map((folder) => (
                <DropdownMenu.Item
                  key={folder.id}
                  icon={<FolderMark glyph={folder.glyph} color={folder.color} size="xs" />}
                  onSelect={() =>
                    void organise
                      .change(chosen, { folder: folder.id, pinned: false })
                      .then(afterBulk)
                  }
                >
                  {folder.name}
                </DropdownMenu.Item>
              ))}
              {chosen.some((c) => c.folderId) && (
                <DropdownMenu.Item
                  icon={<Check />}
                  onSelect={() => void organise.fileIn(chosen, null).then(endSelecting)}
                >
                  Out of their folders
                </DropdownMenu.Item>
              )}
              {known.length > 0 && <DropdownMenu.Separator />}
              <DropdownMenu.Item
                icon={<FolderPlus />}
                onSelect={() => openFolderDialog(chosen.map((c) => c.id))}
              >
                New folder…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          <IconButton
            size="sm"
            label="Archive"
            disabled={!chosen.length}
            onClick={() => void organise.archive(chosen).then(endSelecting)}
          >
            <Archive />
          </IconButton>
          <IconButton
            size="sm"
            label="Delete"
            disabled={!chosen.length}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 />
          </IconButton>
        </SelectionBar>
      )}
      <DeleteChat
        count={chosen.length}
        archived={false}
        {...(chosen.length === 1 && chosen[0] && { chat: chosen[0] })}
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onDelete={() => void organise.remove(chosen).then(afterBulk)}
      />
      <FolderDialog
        open={Boolean(folderDialog) || Boolean(editing)}
        onOpenChange={(open) => {
          if (open) return;
          closeFolderDialog();
          setEditing(undefined);
        }}
        mode={editing ? 'edit' : 'new'}
        initial={editing}
        onSave={(draft) => {
          if (editing) void organise.updateFolder(editing, draft);
          else {
            const file = pick(folderDialog?.file ?? []);
            void organise.createFolder(draft, file).then((made) => {
              if (made && file.length) endSelecting();
            });
          }
          closeFolderDialog();
          setEditing(undefined);
        }}
      />
      <RemoveFolder
        folder={removing}
        count={
          removing ? (list.folders.find((f) => f.folder.id === removing.id)?.chats.length ?? 0) : 0
        }
        onCancel={() => setRemoving(undefined)}
        onRemove={(folder) => {
          setRemoving(undefined);
          void organise.deleteFolder(folder);
        }}
      />
    </>
  );
}

/** Asks before a folder goes: its chats stay, back in the list. */
function RemoveFolder({
  folder,
  count,
  onCancel,
  onRemove,
}: {
  folder?: ChatFolder;
  count: number;
  onCancel: () => void;
  onRemove: (folder: ChatFolder) => void;
}) {
  return (
    <AlertDialog.Root open={Boolean(folder)} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialog.Content>
        <AlertDialog.Header>
          <AlertDialog.Title>{`Remove the folder ${folder?.name ?? ''}?`}</AlertDialog.Title>
          <AlertDialog.Description>
            {count
              ? `Its ${count === 1 ? 'chat goes' : `${count} chats go`} back to your list. Nothing is deleted.`
              : 'It’s empty. Nothing is deleted.'}
          </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
          <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
          <AlertDialog.Action onClick={() => folder && onRemove(folder)}>
            Remove folder
          </AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
