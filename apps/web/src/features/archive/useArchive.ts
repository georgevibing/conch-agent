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
 * pinned app's refresh or what another app did through Conch, which live on
 * their own pages, nor a task's work, which sits under the chat it came from.
 * A task sent from no chat is a chat of its own.
 */
export function isChat(c: ConversationSummary): boolean {
  const origin = c.origin;
  if (origin?.kind === 'task') return origin.standalone === true;
  return (
    origin?.kind !== 'routine' &&
    origin?.kind !== 'artifact' &&
    origin?.kind !== 'client' &&
    // Another agent talking to one of yours (ADR 0112): opened from Settings → Agents.
    origin?.kind !== 'peer'
  );
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

  const set = (id: string, archivedAt: number | undefined, pinned?: number) =>
    client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
      list?.map((c) => {
        if (c.id !== id) return c;
        const next = stamp(c, archivedAt);
        // Archiving unpins (ADR 0089); putting it back pins it where it was.
        if (archivedAt) delete next.pinned;
        else if (pinned !== undefined) next.pinned = pinned;
        return next;
      }),
    );

  const unarchive = async (
    chat: ConversationSummary,
    { reopen = false, quiet = false }: { reopen?: boolean; quiet?: boolean } = {},
  ) => {
    set(chat.id, undefined, chat.pinned);
    if (reopen) void navigate(`/c/${chat.id}`);
    try {
      if (chat.pinned !== undefined)
        await api.changeConversation(chat.id, {
          archived: false,
          pinned: true,
          pinOrder: chat.pinned,
        });
      else await api.archiveConversation(chat.id, false);
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
      set(chat.id, undefined, chat.pinned);
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
    // Gone the moment it's confirmed; back where it was if the gateway says no.
    const before = client.getQueryData<ConversationSummary[]>(keys.conversations);
    client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
      (list ?? []).filter((c) => c.id !== chat.id),
    );
    if (conversationId === chat.id) void navigate('/');
    try {
      await api.deleteConversation(chat.id);
      return true;
    } catch (e) {
      if (before) client.setQueryData(keys.conversations, before);
      toast.error((e as Error).message);
      return false;
    }
  };

  return { archive, unarchive, remove };
}
