import { isUnread, type ChatFolder, type ConversationSummary } from '@conch/protocol';
import {
  ChatRow,
  ContextMenu,
  DropdownMenu,
  IconButton,
  Input,
  IntegrationLogo,
  isChatDrag,
  LiveTitle,
  readChatDrag,
  toast,
  type ChatStatus,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, MoreHorizontal, Pin, PinOff } from 'lucide-react';
import { useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { NavLink, useParams } from 'react-router';

import { api } from '../../api/client';
import { keys } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useLiveStore } from '../../live/store';
import { useAutoFocus } from '../../lib/useAutoFocus';
import { ChatRowAgent } from '../agents/ChatAgent';
import { DeleteChat } from '../archive/DeleteChat';
import { useArchive } from '../archive/useArchive';
import { APPS } from '../channels/describe';
import { useQuietChat } from '../learning/useQuietChat';
import { ChatTasksFor, useChatTasks } from '../tasks/ChatTasksFor';
import { ChatMenuItems, type ChatMenuActions } from './ChatMenu';
import { useOrganise } from './useOrganise';

function RenameField({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const ref = useAutoFocus<HTMLInputElement>();
  return (
    <form
      style={{ flex: 1 }}
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <Input
        ref={ref}
        size="sm"
        aria-label="Conversation title"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onSave}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      />
    </form>
  );
}

/** Where a chat is, in one word: working, needs you, new, or didn't finish. */
export function statusOf(
  chat: ConversationSummary,
  { stopped, open }: { stopped: boolean; open: boolean },
): ChatStatus | undefined {
  if (chat.status === 'awaiting-permission' && !stopped) return 'waiting';
  if (chat.status === 'running' && !stopped) return 'working';
  if (chat.status === 'error') return 'error';
  // The chat in front of you is never new to you.
  if (!open && isUnread(chat)) return 'unread';
  return undefined;
}

export interface Selection {
  selecting: boolean;
  selected: boolean;
  /** The chats a drag of this row carries: every ticked one when it's ticked. */
  dragIds: string[];
  onSelectedChange: (
    selected: boolean,
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
  ) => void;
  onSelectRequest: (event: MouseEvent<HTMLElement>) => void;
  startSelecting: () => void;
}

/**
 * One chat in the list (ADR 0089): its mark, where it came from, and
 * everything that can be done with it — from **⋯**, a right-click, a drag, a
 * swipe on a phone, or a double-click on its title to rename it.
 */
export function ChatRowItem({
  chat,
  folders,
  selection,
  onNavigate,
  pinNeighbours,
  onDropBefore,
}: {
  chat: ConversationSummary;
  folders: readonly ChatFolder[];
  selection: Selection;
  onNavigate?: () => void;
  /** The pinned chats either side, for Move up / Move down. */
  pinNeighbours?: {
    above?: ConversationSummary;
    aboveThat?: ConversationSummary;
    below?: ConversationSummary;
    belowThat?: ConversationSummary;
  };
  /** Chats dropped on this row go just above it (among the pinned). */
  onDropBefore?: (ids: string[]) => void;
}) {
  const { archive, remove } = useArchive();
  const organise = useOrganise();
  const { isQuiet, setQuiet } = useQuietChat();
  const openFolderDialog = useUi((s) => s.openFolderDialog);
  const client = useQueryClient();
  const { conversationId } = useParams();
  const [draft, setDraft] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const [dropping, setDropping] = useState(false);
  const stopped = useLiveStore((s) => chat.id in s.stopping);
  const open = conversationId === chat.id;
  const quiet = isQuiet(chat.id);
  const pinned = chat.pinned !== undefined;
  // What it sent off, under it (ADR 0033): live, each a press from its own chat.
  const tasks = useChatTasks(chat.id, { open });

  const rename = async () => {
    const next = draft?.trim();
    setDraft(undefined);
    if (!next || next === chat.title) return;
    // The new name shows at once; the old one comes back if it didn't save.
    const retitle = (title: string) =>
      client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
        list?.map((c) => (c.id === chat.id ? { ...c, title } : c)),
      );
    retitle(next);
    try {
      await api.renameConversation(chat.id, next);
    } catch (e) {
      retitle(chat.title);
      toast.error((e as Error).message);
    }
  };

  const n = pinNeighbours;
  const actions: ChatMenuActions = {
    rename: () => setDraft(chat.title),
    pin: (p) => void organise.pin([chat], p),
    moveUp: n?.above
      ? () => void organise.placePin(chat, n.aboveThat?.pinned, n.above?.pinned)
      : undefined,
    moveDown: n?.below
      ? () => void organise.placePin(chat, n.below?.pinned, n.belowThat?.pinned)
      : undefined,
    fileIn: (folder) =>
      void (folder && pinned
        ? organise
            .change([chat], { folder: folder.id, pinned: false })
            .then((ok) => ok && toast(`Moved to ${folder.name}`))
        : organise.fileIn([chat], folder)),
    newFolder: () => openFolderDialog([chat.id]),
    select: selection.startSelecting,
    archive: () => void archive(chat),
    quiet: (q) => void setQuiet(chat.id, q),
    remove: () => setConfirm(true),
  };

  const dropProps = onDropBefore && {
    onDragOver: (e: DragEvent<HTMLLIElement>) => {
      if (!isChatDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropping(true);
    },
    onDragLeave: () => setDropping(false),
    onDrop: (e: DragEvent<HTMLLIElement>) => {
      setDropping(false);
      const ids = readChatDrag(e.dataTransfer);
      if (!ids.length) return;
      e.preventDefault();
      e.stopPropagation();
      onDropBefore(ids.filter((id) => id !== chat.id));
    },
  };

  return (
    <>
      <ChatRow
        status={statusOf(chat, { stopped, open })}
        dropBefore={dropping}
        below={
          tasks && !selection.selecting ? (
            <ChatTasksFor
              chatId={chat.id}
              chatTitle={chat.title}
              tasks={tasks}
              onNavigate={onNavigate}
            />
          ) : undefined
        }
        leading={
          chat.origin?.kind === 'channel' ? (
            <IntegrationLogo
              brand={chat.origin.channel}
              name={APPS[chat.origin.channel].name}
              color={APPS[chat.origin.channel].color}
              size="xs"
            />
          ) : (
            <ChatRowAgent chat={chat} />
          )
        }
        selecting={selection.selecting}
        selected={selection.selected}
        onSelectedChange={selection.onSelectedChange}
        onSelectRequest={selection.onSelectRequest}
        dragIds={draft === undefined ? selection.dragIds : undefined}
        swipeStart={{
          label: pinned ? 'Unpin' : 'Pin',
          icon: pinned ? <PinOff /> : <Pin />,
          tone: 'accent',
          onAction: () => void organise.pin([chat], !pinned),
        }}
        swipeEnd={{
          label: 'Archive',
          icon: <Archive />,
          tone: 'neutral',
          onAction: () => void archive(chat),
        }}
        editing={
          draft !== undefined ? (
            <RenameField
              value={draft}
              onChange={setDraft}
              onSave={() => void rename()}
              onCancel={() => setDraft(undefined)}
            />
          ) : undefined
        }
        onDoubleClick={(e) => {
          if (selection.selecting || (e.target as HTMLElement).closest('button')) return;
          e.preventDefault();
          setDraft(chat.title);
        }}
        menu={
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton size="sm" label={`Options for ${chat.title}`} tooltip={false}>
                <MoreHorizontal />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="start">
              <ChatMenuItems
                parts={DropdownMenu}
                chat={chat}
                folders={folders}
                quiet={quiet}
                actions={actions}
              />
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        }
        contextMenu={
          <ChatMenuItems
            parts={ContextMenu}
            chat={chat}
            folders={folders}
            quiet={quiet}
            actions={actions}
          />
        }
        {...dropProps}
      >
        <NavLink to={`/c/${chat.id}`} onClick={onNavigate}>
          <LiveTitle pending={chat.titling}>{chat.title}</LiveTitle>
        </NavLink>
      </ChatRow>
      <DeleteChat
        chat={chat}
        open={confirm}
        onOpenChange={setConfirm}
        onDelete={() => void remove(chat)}
      />
    </>
  );
}
