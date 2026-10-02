/**
 * It learns you (ADR 0032): memory search that understands meaning, a
 * tidy-up you can read and undo, and skills suggested from what you keep
 * asking for. Every change is shown; nothing is learned silently.
 */
import { z } from 'zod';

import { Memory } from './memory';

/** How memory is searched right now. */
export const MemoryIndexStatus = z.object({
  /**
   * `meaning`: an embedding model on this computer (Conch's own, or
   * Ollama's) — finds “got married” from “anniversary”. `words`: words,
   * spellings and a few everyday concepts, typos forgiven; what Conch does
   * before anything is downloaded.
   */
  mode: z.enum(['meaning', 'words']),
  /** The embedding model, when there is one. */
  model: z.string().optional(),
  /** Whose it is: Conch's own (ADR 0041), or one in Ollama (ADR 0022). */
  source: z.enum(['built-in', 'ollama']).optional(),
  /** Memories indexed, of all of them. */
  indexed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** Conch's own model could give meaning search: the one it would get. */
  offer: z
    .object({
      model: z.string(),
      bytes: z.number(),
      /** It matches across many languages, not just English. */
      multilingual: z.boolean().optional(),
    })
    .optional(),
  /** Getting it now: how far, 0–100. */
  getting: z.number().min(0).max(100).optional(),
  /** Why getting it didn't work, or why it can't run here, in a sentence. */
  problem: z.string().max(300).optional(),
});
export type MemoryIndexStatus = z.infer<typeof MemoryIndexStatus>;

/** Get it: the browser's languages, so the model fits who's asking. */
export const GetMeaningBody = z.object({
  languages: z.array(z.string().max(35)).max(20).default([]),
});
export type GetMeaningBody = z.infer<typeof GetMeaningBody>;

export const TidyChange = z.object({
  id: z.string(),
  kind: z.enum([
    /** Several memories said the same thing: one stays, in the clearest words. */
    'merged',
    /** A newer chat said something that replaces it. */
    'updated',
    /** Something durable you said in a chat. */
    'added',
  ]),
  /** In plain words: “You moved to Lisbon in September.” */
  why: z.string().max(300),
  /** The memories as they were (to undo). */
  before: z.array(Memory),
  /** The memory as it is after (or would be, while pending). */
  after: Memory.optional(),
  state: z.enum([
    /** Done; Undo puts `before` back. */
    'applied',
    /** Waiting for your OK (untrusted, or Remember automatically is off). */
    'pending',
    'kept',
    'undone',
    'dismissed',
  ]),
  /** Learned from a chat that read something untrusted (ADR 0028): why. */
  untrusted: z.string().max(300).optional(),
});
export type TidyChange = z.infer<typeof TidyChange>;

export const TidyRun = z.object({
  id: z.string(),
  at: z.number(),
  /** `nightly` while you slept, `now` when you asked. */
  trigger: z.enum(['nightly', 'now']),
  /** Whether a model helped (it can only merge exact repeats without one). */
  model: z.boolean(),
  changes: z.array(TidyChange),
  /** It couldn't finish: one sentence. */
  problem: z.string().optional(),
});
export type TidyRun = z.infer<typeof TidyRun>;

export const TidyStatus = z.object({
  /** Tidy up every night (preferences.tidyMemory). */
  nightly: z.boolean(),
  running: z.boolean(),
  lastAt: z.number().optional(),
  runs: z.array(TidyRun),
});
export type TidyStatus = z.infer<typeof TidyStatus>;

export const TidyAnswerBody = z.object({
  runId: z.string(),
  changeId: z.string(),
  answer: z.enum(['keep', 'undo', 'dismiss']),
});

/** Something you keep asking for, which could be a skill. */
export const SkillSuggestion = z.object({
  id: z.string(),
  /** “Weekly summary of my calendar”. */
  title: z.string().max(80),
  /** How many times, in how many chats. */
  times: z.number().int().positive(),
  /** What you said, a few of them, newest first. */
  examples: z.array(z.object({ text: z.string(), conversationId: z.string(), at: z.number() })),
  /** A SKILL.md to start from, for you to read and change before saving. */
  draft: z.object({
    title: z.string(),
    description: z.string(),
    instructions: z.string(),
  }),
});
export type SkillSuggestion = z.infer<typeof SkillSuggestion>;

export const SkillSuggestions = z.object({ suggestions: z.array(SkillSuggestion) });
export type SkillSuggestions = z.infer<typeof SkillSuggestions>;

export const DismissSuggestionBody = z.object({
  id: z.string(),
  forever: z.boolean().default(false),
});
