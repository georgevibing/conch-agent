import type { ConversationSummary } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';

import { api } from '../../api/client';
import { keys } from '../../api/queries';

/** Where the archive lives. */
export const ARCHIVE_PATH = '/archived';

/**
 * A chat you started (here, or from a chat app) — not a routine's run, a
 * task's work or a pinned app's refresh, which live on their own pages.
 */
export function isChat(c: ConversationSummary): boolean {
  return c.origin?.kind !== 'routine' && c.origin?.kind !== 'artifact' && c.origin?.kind !== 'task';
}

/** The chats in the archive, most recently archived first. */
export function archivedChats(list: ConversationSummary[] | undefined): ConversationSummary[] {
  return (list ?? [])
    .filter((c) => c.archivedAt && isChat(c))
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
}

function stamp(c: ConversationSummary, archivedAt: number | undefined): ConversationSummary {
  if (archivedAt) return { ...c, archivedAt };
  // Absent, not `undefined`, as the gateway sends it.
  const { archivedAt: _gone, ...rest } = c;
  return rest;
}

/**
 * Archive a chat, put it back, or delete it — at once in the list, then on
 * the gateway, and back as it was if the gateway says no. Archiving says
 * where the chat went and offers Undo; archiving the chat you're reading
 * takes you to a new one, and Undo brings you back to it.
 */
export function useArchive() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { conversationId } = useParams();

  const set = (id: string, archivedAt: number | undefined) =>
    client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
      list?.map((c) => (c.id === id ? stamp(c, archivedAt) : c)),
    );

  const unarchive = async (
    chat: ConversationSummary,
    { reopen = false, quiet = false }: { reopen?: boolean; quiet?: boolean } = {},
  ) => {
    set(chat.id, undefined);
    if (reopen) void navigate(`/c/${chat.id}`);
    try {
      await api.archiveConversation(chat.id, false);
    } catch (e) {
      set(chat.id, chat.archivedAt);
      toast.error('Couldn’t unarchive that chat', { description: (e as Error).message });
      return;
    }
    if (!quiet)
      toast.success(`“${chat.title}” is back in your chats`, {
        action: { label: 'Open', onClick: () => void navigate(`/c/${chat.id}`) },
      });
  };

  const archive = async (chat: ConversationSummary) => {
    const open = conversationId === chat.id;
    set(chat.id, Date.now());
    if (open) void navigate('/');
    try {
      await api.archiveConversation(chat.id, true);
    } catch (e) {
      set(chat.id, undefined);
      if (open) void navigate(`/c/${chat.id}`);
      toast.error('Couldn’t archive that chat', { description: (e as Error).message });
      return;
    }
    toast(`Archived “${chat.title}”`, {
      description: 'It’s under Archived, at the end of your chats.',
      action: {
        label: 'Undo',
        onClick: () => void unarchive(chat, { reopen: open, quiet: true }),
      },
    });
  };

  /** For good: the confirmation is the caller's to ask. */
  const remove = async (chat: ConversationSummary) => {
    try {
      await api.deleteConversation(chat.id);
      client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
        (list ?? []).filter((c) => c.id !== chat.id),
      );
      if (conversationId === chat.id) void navigate('/');
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  };

  return { archive, unarchive, remove };
}
