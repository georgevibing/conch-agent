import { ArchiveRestore, MessageSquare, Trash2 } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Highlight, type HighlightRange } from '../../components/Highlight';
import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import styles from './Archive.module.css';

export interface ArchivedChat {
  id: string;
  title: string;
  /** Where the title matched what was typed to find it. */
  ranges?: readonly HighlightRange[];
  /** What was said last. */
  preview?: string;
  /** When it was archived, as a person says it: “3 days ago”. */
  archived: string;
  /** Where it came from (a chat app’s logo); a speech bubble otherwise. */
  icon?: ReactNode;
}

export interface ArchivedChatsProps extends Omit<ComponentProps<'ul'>, 'children'> {
  chats: ArchivedChat[];
  /** Read it as it is: it stays archived until you write in it. */
  onOpen?: (chat: ArchivedChat) => void;
  /** Back into the chat list, where it was. */
  onUnarchive?: (chat: ArchivedChat) => void;
  /** The page asks first; this list only offers it. */
  onDelete?: (chat: ArchivedChat) => void;
}

/**
 * Chats put away from the list, most recently archived first. Each row
 * opens the chat, and carries the two ways out of the archive beside it:
 * **Unarchive** back to the list, or delete for good. Quiet on purpose:
 * this is a drawer, not an inbox.
 */
export function ArchivedChats({
  chats,
  onOpen,
  onUnarchive,
  onDelete,
  className,
  ...props
}: ArchivedChatsProps) {
  return (
    <ul aria-label="Archived chats" className={cx(styles.list, className)} {...props}>
      {chats.map((chat) => (
        <li key={chat.id} className={styles.item}>
          <button type="button" className={styles.row} onClick={() => onOpen?.(chat)}>
            <span className={styles.icon} aria-hidden>
              {chat.icon ?? <MessageSquare />}
            </span>
            <span className={styles.text}>
              <span className={styles.title}>
                {chat.ranges?.length ? (
                  <Highlight text={chat.title} ranges={chat.ranges} />
                ) : (
                  chat.title
                )}
              </span>
              <span className={styles.meta}>
                Archived {chat.archived}
                {chat.preview && (
                  <>
                    <span aria-hidden> · </span>
                    <span className={styles.preview}>{chat.preview}</span>
                  </>
                )}
              </span>
            </span>
          </button>
          {(onUnarchive || onDelete) && (
            <span className={styles.actions}>
              {onUnarchive && (
                <Button
                  size="sm"
                  variant="ghost"
                  leadingIcon={<ArchiveRestore />}
                  aria-label={`Unarchive ${chat.title}`}
                  onClick={() => onUnarchive(chat)}
                  className={styles.unarchive}
                >
                  <span className={styles.unarchiveLabel}>Unarchive</span>
                </Button>
              )}
              {onDelete && (
                <IconButton
                  size="sm"
                  label={`Delete ${chat.title}`}
                  tooltip="Delete"
                  onClick={() => onDelete(chat)}
                  className={styles.delete}
                >
                  <Trash2 />
                </IconButton>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
