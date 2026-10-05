import { AlertDialog } from '@conch/nacre';
import { Trash2 } from 'lucide-react';

/**
 * Asks before a chat is deleted for good — one chat, or several at once
 * (Delete all in the archive). Memories made from them stay.
 */
export function DeleteChat({
  chat,
  count,
  archived = true,
  open,
  onOpenChange,
  onDelete,
}: {
  /** The one chat being deleted; leave it out with `count` for several. */
  chat?: { title: string };
  count?: number;
  /** Several from the archive (the default), or chosen in the list. */
  archived?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
}) {
  const many = !chat && (count ?? 0) > 1;
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Content tone="danger" icon={<Trash2 />}>
        <AlertDialog.Header>
          <AlertDialog.Title>
            {many
              ? `Delete ${count} ${archived ? 'archived ' : ''}chats?`
              : 'Delete this conversation?'}
          </AlertDialog.Title>
          <AlertDialog.Description>
            {many
              ? 'They’ll be removed from Conch for good. Anything I remembered from them stays in memory.'
              : `“${chat?.title ?? 'This chat'}” will be removed from Conch. Anything I remembered from it stays in memory.`}
          </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
          <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
          <AlertDialog.Action tone="danger" onClick={onDelete}>
            {many ? `Delete ${count} chats` : 'Delete'}
          </AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
