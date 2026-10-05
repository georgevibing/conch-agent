import type { ChatChange, ChatFolder, ConversationSummary, NewFolderBody } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';

import { api } from '../../api/client';
import { keys } from '../../api/queries';

/** A chat with a change applied, as the gateway would send it back: unset means absent. */
export function applyChange(chat: ConversationSummary, change: ChatChange): ConversationSummary {
  const next: ConversationSummary = { ...chat };
  if (change.archived === true && !chat.archivedAt) next.archivedAt = Date.now();
  if (change.archived === false) delete next.archivedAt;
  if (change.pinned === false) delete next.pinned;
  else if (change.pinned === true || (change.pinOrder !== undefined && chat.pinned !== undefined))
    next.pinned = change.pinOrder ?? chat.pinned ?? Date.now();
  if (next.archivedAt && change.pinned !== true) delete next.pinned;
  if (change.folder === null) delete next.folderId;
  else if (change.folder) next.folderId = change.folder;
  return next;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Pin, file and tidy chats from the list (ADR 0089) — at once on screen, then
 * on the gateway, put back as they were if it says no. Anything that moves a
 * chat out of sight says where it went and offers Undo.
 */
export function useOrganise() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { conversationId } = useParams();

  const snapshot = () => client.getQueryData<ConversationSummary[]>(keys.conversations);
  const restore = (before: ConversationSummary[] | undefined) => {
    if (before) client.setQueryData(keys.conversations, before);
  };
  const applyLocally = (ids: ReadonlySet<string>, change: ChatChange) =>
    client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
      list?.map((c) => (ids.has(c.id) ? applyChange(c, change) : c)),
    );

  /** One change to one chat or several; true when it held. */
  const change = async (chats: readonly ConversationSummary[], next: ChatChange) => {
    if (!chats.length) return false;
    const before = snapshot();
    applyLocally(new Set(chats.map((c) => c.id)), next);
    try {
      const [only] = chats;
      if (chats.length === 1 && only) await api.changeConversation(only.id, next);
      else await api.bulkConversations({ ids: chats.map((c) => c.id), change: next });
      return true;
    } catch (e) {
      restore(before);
      toast.error('Couldn’t change that', { description: (e as Error).message });
      return false;
    }
  };

  /** Put chats back exactly as they were before a change (Undo). */
  const putBack = async (chats: readonly ConversationSummary[]) => {
    for (const chat of chats) {
      const back: ChatChange = {
        archived: Boolean(chat.archivedAt),
        folder: chat.folderId ?? null,
        pinned: chat.pinned !== undefined,
        ...(chat.pinned !== undefined && { pinOrder: chat.pinned }),
      };
      await change([chat], back);
    }
  };

  const pin = (chats: readonly ConversationSummary[], pinned: boolean) => change(chats, { pinned });

  /** Move it among the pinned: between `before` and `after` (either may be absent). */
  const placePin = (chat: ConversationSummary, before?: number, after?: number) => {
    const order =
      before !== undefined && after !== undefined
        ? (before + after) / 2
        : before !== undefined
          ? before + 1
          : after !== undefined
            ? after - 1
            : Date.now();
    return change([chat], { pinned: true, pinOrder: order });
  };

  const fileIn = async (chats: readonly ConversationSummary[], folder: ChatFolder | null) => {
    const ok = await change(chats, { folder: folder?.id ?? null });
    if (!ok || !folder) return;
    toast(
      chats.length === 1
        ? `Moved to ${folder.name}`
        : `Moved ${plural(chats.length, 'chat')} to ${folder.name}`,
      { action: { label: 'Undo', onClick: () => void putBack(chats) } },
    );
  };

  const archive = async (chats: readonly ConversationSummary[]) => {
    const open = chats.some((c) => c.id === conversationId);
    if (open) void navigate('/');
    const ok = await change(chats, { archived: true });
    if (!ok) {
      if (open && conversationId) void navigate(`/c/${conversationId}`);
      return;
    }
    toast(
      chats.length === 1
        ? `Archived “${chats[0]?.title}”`
        : `Archived ${plural(chats.length, 'chat')}`,
      {
        description:
          chats.length === 1
            ? 'It’s under Archived, at the end of your chats.'
            : 'They’re under Archived, at the end of your chats.',
        action: { label: 'Undo', onClick: () => void putBack(chats) },
      },
    );
  };

  /** For good, all of them: the caller asks first. */
  const remove = async (chats: readonly ConversationSummary[]) => {
    const before = snapshot();
    const ids = new Set(chats.map((c) => c.id));
    client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
      (list ?? []).filter((c) => !ids.has(c.id)),
    );
    if (conversationId && ids.has(conversationId)) void navigate('/');
    try {
      await api.bulkConversations({ ids: [...ids], remove: true });
      toast(`Deleted ${plural(chats.length, 'chat')}`);
      return true;
    } catch (e) {
      restore(before);
      toast.error('Couldn’t delete those chats', { description: (e as Error).message });
      return false;
    }
  };

  // ── Folders ──────────────────────────────────────────────────────────────

  const folders = () => client.getQueryData<ChatFolder[]>(keys.folders) ?? [];
  const setFolders = (next: ChatFolder[]) =>
    client.setQueryData(
      keys.folders,
      [...next].sort((a, b) => a.order - b.order),
    );

  const createFolder = async (body: NewFolderBody, then?: readonly ConversationSummary[]) => {
    try {
      const folder = await api.createFolder(body);
      setFolders([...folders().filter((f) => f.id !== folder.id), folder]);
      if (then?.length) await fileIn(then, folder);
      return folder;
    } catch (e) {
      toast.error('Couldn’t make that folder', { description: (e as Error).message });
      return undefined;
    }
  };

  const updateFolder = async (folder: ChatFolder, body: Partial<Omit<ChatFolder, 'id'>>) => {
    const before = folders();
    setFolders(before.map((f) => (f.id === folder.id ? { ...f, ...body } : f)));
    try {
      await api.updateFolder(folder.id, body);
    } catch (e) {
      setFolders(before);
      toast.error('Couldn’t change that folder', { description: (e as Error).message });
    }
  };

  /** Its chats go back to the list; the folder alone goes. */
  const deleteFolder = async (folder: ChatFolder) => {
    const before = folders();
    const chats = before.length ? snapshot() : undefined;
    setFolders(before.filter((f) => f.id !== folder.id));
    client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
      list?.map((c) => (c.folderId === folder.id ? applyChange(c, { folder: null }) : c)),
    );
    try {
      await api.deleteFolder(folder.id);
      toast(`Removed the folder ${folder.name}`, {
        description: 'Its chats are back in your list.',
      });
    } catch (e) {
      setFolders(before);
      restore(chats);
      toast.error('Couldn’t remove that folder', { description: (e as Error).message });
    }
  };

  return {
    change,
    pin,
    placePin,
    fileIn,
    archive,
    remove,
    putBack,
    createFolder,
    updateFolder,
    deleteFolder,
  };
}
