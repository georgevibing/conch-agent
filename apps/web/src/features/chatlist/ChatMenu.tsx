import type { ChatFolder, ConversationSummary } from '@conch/protocol';
import { type ContextMenu, type DropdownMenu, FolderMark } from '@conch/nacre';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  CircleOff,
  FolderInput,
  FolderMinus,
  FolderPlus,
  ListChecks,
  Pencil,
  Pin,
  PinOff,
  Sparkles,
  Trash2,
} from 'lucide-react';

/** The parts a chat's menu is made of: the same for **⋯** and for a right-click. */
type MenuParts = Pick<
  typeof DropdownMenu | typeof ContextMenu,
  'Item' | 'Separator' | 'Sub' | 'SubTrigger' | 'SubContent'
>;

export interface ChatMenuActions {
  rename(): void;
  pin(pinned: boolean): void;
  /** Up or down one place among the pinned; absent at the end it can't pass. */
  moveUp?: () => void;
  moveDown?: () => void;
  fileIn(folder: ChatFolder | null): void;
  newFolder(): void;
  select(): void;
  archive(): void;
  quiet(quiet: boolean): void;
  remove(): void;
}

/**
 * What can be done with one chat from the list (ADR 0089), in the order people
 * reach for it: name it, keep it at the top, file it, then put it away.
 */
export function ChatMenuItems({
  parts: M,
  chat,
  folders,
  quiet,
  actions,
}: {
  parts: MenuParts;
  chat: ConversationSummary;
  folders: readonly ChatFolder[];
  quiet: boolean;
  actions: ChatMenuActions;
}) {
  const pinned = chat.pinned !== undefined;
  return (
    <>
      <M.Item icon={<Pencil />} onSelect={actions.rename}>
        Rename
      </M.Item>
      <M.Item icon={pinned ? <PinOff /> : <Pin />} onSelect={() => actions.pin(!pinned)}>
        {pinned ? 'Unpin' : 'Pin'}
      </M.Item>
      {pinned && actions.moveUp && (
        <M.Item icon={<ArrowUp />} onSelect={actions.moveUp}>
          Move up
        </M.Item>
      )}
      {pinned && actions.moveDown && (
        <M.Item icon={<ArrowDown />} onSelect={actions.moveDown}>
          Move down
        </M.Item>
      )}
      <M.Sub>
        <M.SubTrigger icon={<FolderInput />}>Move to</M.SubTrigger>
        <M.SubContent>
          {folders.map((folder) => (
            <M.Item
              key={folder.id}
              icon={<FolderMark glyph={folder.glyph} color={folder.color} size="xs" />}
              disabled={chat.folderId === folder.id}
              onSelect={() => actions.fileIn(folder)}
            >
              {folder.name}
            </M.Item>
          ))}
          {chat.folderId && (
            <M.Item icon={<FolderMinus />} onSelect={() => actions.fileIn(null)}>
              Out of the folder
            </M.Item>
          )}
          {(folders.length > 0 || chat.folderId) && <M.Separator />}
          <M.Item icon={<FolderPlus />} onSelect={actions.newFolder}>
            New folder…
          </M.Item>
        </M.SubContent>
      </M.Sub>
      <M.Item icon={<ListChecks />} onSelect={actions.select}>
        Select
      </M.Item>
      <M.Separator />
      <M.Item icon={<Archive />} onSelect={actions.archive}>
        Archive
      </M.Item>
      <M.Item icon={quiet ? <Sparkles /> : <CircleOff />} onSelect={() => actions.quiet(!quiet)}>
        {quiet ? 'Learn from this chat again' : 'Don’t learn from this chat'}
      </M.Item>
      <M.Separator />
      <M.Item icon={<Trash2 />} tone="danger" onSelect={actions.remove}>
        Delete
      </M.Item>
    </>
  );
}
