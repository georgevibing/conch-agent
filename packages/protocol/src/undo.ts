/**
 * Undo (ADR 0030): every file the assistant creates, changes or deletes can be
 * put back — one change, or everything a turn did — after a look at what will
 * change, and put forward again (Redo). Conch keeps a copy of each file as it
 * was before, under `~/.conch/undo`, never of where keys and passwords live.
 */
import { z } from 'zod';

export const ChangedFile = z.object({
  /** As a person reads it: relative to the work folder, or with `~`. */
  path: z.string(),
  kind: z.enum(['created', 'changed', 'deleted']),
});
export type ChangedFile = z.infer<typeof ChangedFile>;

export const UndoState = z.enum([
  /** The change is in place: it can be undone. */
  'applied',
  /** It was undone: it can be redone. */
  'undone',
  /** Its copies were let go (old, or space was needed): it can't be undone any more. */
  'expired',
]);
export type UndoState = z.infer<typeof UndoState>;

/** One file in a preview: what restoring it would do, and what stands in the way. */
export const UndoPreviewFile = ChangedFile.extend({
  /** What happens to it: put back as it was, removed (it was new), or brought back (it was deleted). */
  action: z.enum(['restore', 'remove', 'recreate']),
  /** Unified diff from how it is now to how it will be; unset for binary or very large files. */
  diff: z.string().optional(),
  binary: z.boolean().optional(),
  /**
   * It changed since (you edited it after the assistant, say): one sentence.
   * Undoing it anyway replaces those later changes too.
   */
  conflict: z.string().optional(),
  /** It can't be put back at all (a link now, gone from where it was): one sentence. */
  blocked: z.string().optional(),
});
export type UndoPreviewFile = z.infer<typeof UndoPreviewFile>;

export const UndoPreview = z.object({
  direction: z.enum(['undo', 'redo']),
  files: z.array(UndoPreviewFile),
});
export type UndoPreview = z.infer<typeof UndoPreview>;

export const UndoBody = z.object({
  /** Change sets, newest first is fine: they're undone newest first and redone oldest first. */
  ids: z.array(z.string().max(64)).min(1).max(200),
  direction: z.enum(['undo', 'redo']),
  /** Also put back files that changed since (after the person saw the conflict). */
  force: z.boolean().default(false),
});
export type UndoBody = z.infer<typeof UndoBody>;

export const UndoResult = z.object({
  restored: z.array(ChangedFile),
  skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
});
export type UndoResult = z.infer<typeof UndoResult>;

/** The most recent change that can still be undone, for ⌘K's "Undo the last change". */
export const LatestUndo = z.object({
  changeSetId: z.string().optional(),
  conversationId: z.string().optional(),
  label: z.string().optional(),
});
export type LatestUndo = z.infer<typeof LatestUndo>;
