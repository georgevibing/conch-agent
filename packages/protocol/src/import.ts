/**
 * Come home (ADR 0035): bring your things from OpenClaw or Hermes into Conch,
 * after seeing exactly what comes over. Nothing is read without asking,
 * nothing in the other app changes, and the whole import can be undone.
 */
import { z } from 'zod';

import { ChannelBot } from './channels';
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
  /** The model new chats start with (ADR 0042). */
  'model',
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
  /**
   * What Conch saw reading it (ADR 0028): every skill, and any memory or
   * persona that reads like instructions to the assistant.
   */
  review: SkillReview.pick({ verdict: true, findings: true }).optional(),
  /** Already in Conch (the same memory, a skill of that name): it would be skipped. */
  duplicate: z.boolean().optional(),
  /**
   * One of OpenClaw's other agents (ADR 0042), when it belongs to one: the
   * plan shows each agent's things together, with one tick for all of them.
   */
  agent: z.object({ id: z.string().max(64), name: z.string().max(80) }).optional(),
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
  /**
   * One more step only the person can take before it works (ADR 0042):
   * `slack-key`, a Slack bot that came with one of its two keys.
   */
  finish: z.enum(['slack-key']).optional(),
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

/**
 * A Slack bot the other app had only one key for (ADR 0042), as the Slack
 * setup sees it: which key Conch has (never its value), whose bot it is,
 * and the app's id, for a link straight to the page with the other key.
 */
export const ImportSlackHalf = z.object({
  source: ImportSourceId,
  /** "Hermes". */
  label: z.string(),
  /** The key it has. */
  has: z.enum(['botToken', 'appToken']),
  /** The bot, when Slack recognised the bot token. */
  bot: ChannelBot.optional(),
  /** `A0123ABCD`: the app's settings live at api.slack.com/apps/<id>. */
  appId: z
    .string()
    .regex(/^A[A-Z0-9]{6,20}$/)
    .optional(),
  /** Slack no longer accepts the key it has, in a sentence: set it up fresh instead. */
  problem: z.string().optional(),
});
export type ImportSlackHalf = z.infer<typeof ImportSlackHalf>;

export const ImportSlackStatus = z.object({ half: ImportSlackHalf.optional() });
export type ImportSlackStatus = z.infer<typeof ImportSlackStatus>;

/** `POST /api/import/:source/slack`: the key that was missing, to connect the bot with. */
export const FinishSlackImportBody = z.object({
  botToken: z.string().trim().min(1).max(4000).optional(),
  appToken: z.string().trim().min(1).max(4000).optional(),
});
export type FinishSlackImportBody = z.infer<typeof FinishSlackImportBody>;
