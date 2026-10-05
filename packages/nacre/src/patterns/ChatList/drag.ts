/**
 * The drag type a chat row carries while it's dragged: a JSON list of the
 * chat ids that move together (the row, or every chosen row). Anything that
 * takes chats (a folder, Pinned) reads this type and nothing else, so a file
 * or a link dragged over the list never lights a folder up.
 */
export const CHAT_DRAG_TYPE = 'application/x-conch-chats';

/** Whether a drag carries chats. Readable during `dragover`, when the data itself isn't. */
export function isChatDrag(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes(CHAT_DRAG_TYPE);
}

/** The chat ids a drop carries; an empty list for anything else or anything malformed. */
export function readChatDrag(dataTransfer: DataTransfer | null | undefined): string[] {
  if (!dataTransfer) return [];
  try {
    const raw = dataTransfer.getData(CHAT_DRAG_TYPE);
    if (!raw) return [];
    const ids: unknown = JSON.parse(raw);
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
