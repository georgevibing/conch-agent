/**
 * The chat list, organised (ADR 0089): pinned chats, folders, what's new
 * since you looked, and changing many chats at once.
 */
import { z } from 'zod';

import { AppColor, AppGlyph } from './conch-apps';

// ── Folders ─────────────────────────────────────────────────────────────────

/** A folder's id: `f_` and a few letters, never a path. */
export const FolderId = z.string().regex(/^f_[A-Za-z0-9_-]{4,40}$/, 'Not a folder.');
export type FolderId = z.infer<typeof FolderId>;

/**
 * A folder of chats: a name and a mark, nothing more. Lighter than a project
 * on purpose — it sorts, it doesn't change how the assistant answers.
 */
export const ChatFolder = z.object({
  id: FolderId,
  name: z.string().trim().min(1).max(40),
  /** Drawn like an app's icon: one of Nacre's glyphs in one of its colours. */
  glyph: AppGlyph,
  color: AppColor,
  /** Where it sits among the others, smallest first. */
  order: z.number(),
  createdAt: z.number(),
});
export type ChatFolder = z.infer<typeof ChatFolder>;

export const NewFolderBody = z
  .object({
    name: ChatFolder.shape.name,
    glyph: AppGlyph.default('folder'),
    color: AppColor.default('blue'),
  })
  .strict();
export type NewFolderBody = z.input<typeof NewFolderBody>;

export const UpdateFolderBody = z
  .object({
    name: ChatFolder.shape.name.optional(),
    glyph: AppGlyph.optional(),
    color: AppColor.optional(),
    order: z.number().finite().optional(),
  })
  .strict();
export type UpdateFolderBody = z.infer<typeof UpdateFolderBody>;

// ── Many chats at once ──────────────────────────────────────────────────────

/** What can change about a chat from the list, alone or with others. */
export const ChatChange = z
  .object({
    /** Pinned to the top of the list, or not. */
    pinned: z.boolean().optional(),
    /** Its place among the pinned, smallest first (dragging it there). */
    pinOrder: z.number().finite().optional(),
    /** Into a folder, or back out of every folder (`null`). */
    folder: FolderId.nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export type ChatChange = z.infer<typeof ChatChange>;

/** The same change to several chats: what Select does in the list. */
export const BulkChatsBody = z
  .object({
    ids: z.array(z.string().min(1).max(64)).min(1).max(1000),
    change: ChatChange.optional(),
    /** Delete them all. The list asks first; this only does it. */
    remove: z.literal(true).optional(),
  })
  .strict()
  .refine((b) => Boolean(b.change) !== Boolean(b.remove), {
    message: 'Change them or delete them.',
  });
export type BulkChatsBody = z.infer<typeof BulkChatsBody>;

/** How many changed, and which couldn't (one already gone counts as neither). */
export const BulkChatsResult = z.object({
  ok: z.literal(true),
  done: z.number(),
  failed: z.array(z.string()).default([]),
});
export type BulkChatsResult = z.infer<typeof BulkChatsResult>;

// ── What's new ──────────────────────────────────────────────────────────────

interface Seeable {
  updatedAt: number;
  status: string;
  seenAt?: number;
}

/**
 * Something happened in this chat since you last had it open: a reply that
 * finished while you were elsewhere, a message from a chat app. A chat from
 * before Conch kept track (no `seenAt`) is never new.
 */
export function isUnread(chat: Seeable): boolean {
  return chat.status === 'idle' && chat.seenAt !== undefined && chat.updatedAt > chat.seenAt;
}
