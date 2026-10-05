import { Button } from '@conch/nacre';
import { Archive, ArchiveRestore } from 'lucide-react';

import { useConversations } from '../../api/queries';
import { relativeTime } from '../../lib/time';
import routines from '../routines/Routines.module.css';
import { useArchive } from './useArchive';

/**
 * An archived chat says so at the top, with the one way back to the list.
 * Writing in it brings it back too, so the banner says that as well.
 */
export function ArchivedBanner({ conversationId }: { conversationId?: string }) {
  const { data: conversations } = useConversations();
  const { unarchive } = useArchive();
  const chat = conversations?.find((c) => c.id === conversationId);
  if (!chat?.archivedAt) return null;
  return (
    <div className={routines.runBanner} role="note">
      <Archive size={14} aria-hidden />
      <span>
        Archived {relativeTime(chat.archivedAt)}. Write here and it goes back to your list.
      </span>
      <Button
        size="sm"
        variant="ghost"
        leadingIcon={<ArchiveRestore />}
        onClick={() => void unarchive(chat, { quiet: true })}
      >
        Unarchive
      </Button>
    </div>
  );
}
