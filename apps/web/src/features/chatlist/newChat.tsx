import type { ChatFolder } from '@conch/protocol';
import { FolderMark, IconButton, Text } from '@conch/nacre';
import { X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

import { useFolders } from '../../api/queries';
import styles from './ChatList.module.css';

/**
 * A new chat started from a folder (ADR 0089) carries the folder in the new
 * chat page's history entry: `/` with `{ folder }`. Nothing else is kept, so
 * New chat (or ⌘⇧O) is a chat outside any folder again, and Back returns to
 * what you were starting.
 */
export interface NewChatState {
  folder?: string;
}

/** The folder a new chat on this page starts in, if it was started from one. */
export function folderOfNewChat(state: unknown): string | undefined {
  if (!state || typeof state !== 'object' || !('folder' in state)) return undefined;
  const { folder } = state as { folder: unknown };
  return typeof folder === 'string' && folder ? folder : undefined;
}

/** Start a chat inside a folder: the new chat page, knowing where it goes. */
export function useNewChatIn() {
  const navigate = useNavigate();
  return (folder: Pick<ChatFolder, 'id'>) =>
    void navigate('/', { state: { folder: folder.id } satisfies NewChatState });
}

/** The folder the new chat on this page starts in, while it still exists. */
export function useNewChatFolder(): ChatFolder | undefined {
  const location = useLocation();
  const { data: folders } = useFolders();
  const id = location.pathname === '/' ? folderOfNewChat(location.state) : undefined;
  return id ? folders?.find((f) => f.id === id) : undefined;
}

/**
 * On the new chat page, where the chat goes: “New chat in Work”, and a way to
 * start it outside the folder instead. Said once, quietly, above the message box.
 */
export function NewChatPlace() {
  const folder = useNewChatFolder();
  const navigate = useNavigate();
  if (!folder) return null;
  return (
    <div className={styles.place}>
      <FolderMark glyph={folder.glyph} color={folder.color} size="xs" />
      <Text as="span" size="sm" tone="muted" className={styles.placeText}>
        New chat in <strong className={styles.placeName}>{folder.name}</strong>
      </Text>
      <IconButton
        size="sm"
        label={`Start it outside ${folder.name}`}
        onClick={() => void navigate('/', { replace: true, state: null })}
      >
        <X />
      </IconButton>
    </div>
  );
}
