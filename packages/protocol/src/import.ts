/**
 * Come home (ADR 0035): bring your things from OpenClaw or Hermes into Conch,
 * after seeing exactly what comes over. Nothing is read without asking,
 * nothing in the other app changes, and the whole import can be undone.
 */
import { z } from 'zod';

import { SkillReview } from './skills';

export const ImportSourceId = z.enum(['openclaw', 'hermes']);
export type ImportSourceId = z.infer<typeof ImportSourceId>;

export const ImportSource = z.object({
  id: ImportSourceId,
  /** "OpenClaw", "Hermes". */
  label: z.string(),
  /** Its folder on this computer: `~/.openclaw`. */
  path: z.string(),
  /** How much there is, in a few words: "12 memories, 3 skills, 2 routines". */
  summary: z.string(),
  /** Brought over before (when, and how much). */
  imported: z.object({ at: z.number(), count: z.number() }).optional(),
});
export type ImportSource = z.infer<typeof ImportSource>;

export const ImportGroup = z.enum([
  'persona',
  'about',
  'memories',
  'skills',
  'routines',
  'channels',
  'keys',
]);
export type ImportGroup = z.infer<typeof ImportGroup>;

/** One thing that could come over, with everything a person needs to decide. */
export const ImportItem = z.object({
  /** Stable within a plan: `memory:3`, `skill:weekly-review`. */
  id: z.string().max(200),
  group: ImportGroup,
  /** "Ada prefers tea", "Weekly review", "Telegram bot @ada_bot". */
  title: z.string(),
  /** Where it came from and what happens to it here, in a sentence. */
  detail: z.string().optional(),
  /** The words that come over, for a person to read first (persona, about, a memory). */
  preview: z.string().optional(),
  /** Ticked to begin with. Keys and bots never are. */
  checked: z.boolean(),
  /** Something worth knowing before ticking it. */
  warning: z.string().optional(),
  /** For a skill: what Conch saw reading it (ADR 0028). */
  review: SkillReview.optional(),
  /** Already in Conch (the same memory, a skill of that name): it would be skipped. */
  duplicate: z.boolean().optional(),
});
export type ImportItem = z.infer<typeof ImportItem>;

export const ImportPlan = z.object({
  source: ImportSource,
  items: z.array(ImportItem),
  /** Files that couldn't be read, in a sentence each: the rest still comes over. */
  problems: z.array(z.string()),
});
export type ImportPlan = z.infer<typeof ImportPlan>;

export const ImportStatus = z.object({
  sources: z.array(ImportSource),
  /** The last import, while it can still be undone. */
  last: z
    .object({
      at: z.number(),
      source: ImportSourceId,
      count: z.number(),
    })
    .optional(),
});
export type ImportStatus = z.infer<typeof ImportStatus>;

export const RunImportBody = z.object({
  source: ImportSourceId,
  /** The ids of the items to bring over. */
  items: z.array(z.string().max(200)).max(5000),
});
export type RunImportBody = z.infer<typeof RunImportBody>;

export const ImportOutcome = z.object({
  id: z.string(),
  title: z.string(),
  group: ImportGroup,
  ok: z.boolean(),
  /** Why not, or what to do next ("Say hello to the bot to finish"). */
  message: z.string().optional(),
});
export type ImportOutcome = z.infer<typeof ImportOutcome>;

export const ImportResult = z.object({
  source: ImportSourceId,
  /** How many came over, by kind. */
  counts: z.record(ImportGroup, z.number()),
  outcomes: z.array(ImportOutcome),
  /** A backup made just before, to go back to everything as it was. */
  backupId: z.string().optional(),
  /** This import can be undone (`POST /api/import/undo`). */
  undoable: z.boolean(),
});
export type ImportResult = z.infer<typeof ImportResult>;

export const UndoImportResult = z.object({ removed: z.number(), restored: z.number() });
export type UndoImportResult = z.infer<typeof UndoImportResult>;
