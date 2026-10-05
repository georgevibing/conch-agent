/**
 * Quiet learning (ADR 0088): once a chat you were in goes quiet, Conch reads
 * your words in it and keeps what's worth keeping. What's safe is applied and
 * said afterwards, in one quiet line with Undo and Why?. What came after
 * reading something from outside, or from someone else's words, waits for
 * your OK. Nothing learned deletes a memory: a replaced one is superseded,
 * with its history.
 */
import { z } from 'zod';

import { EngineId } from './common';
import { Memory } from './memory';

/** What Conch noticed in a chat, read by code from the chat's own log. */
export const LearningSignal = z.enum([
  /** “No, I meant…”, “actually…”. */
  'correction',
  /** The same thing asked again in other words. */
  'rephrase',
  /** The same message sent again. */
  'retry',
  /** You stopped a reply. */
  'stopped',
  /** You put back what the assistant changed in your files (ADR 0030). */
  'files-undone',
  /** You took back a memory the chat learned. */
  'memory-undone',
  'frustration',
  /** “Perfect, thanks.” */
  'pleased',
  /** A command failed for a reason Conch knows, and another program did it. */
  'worked-another-way',
]);
export type LearningSignal = z.infer<typeof LearningSignal>;

/** What made Conch look: a chat that went quiet, was archived, or had its start summarised. */
export const LearningTrigger = z.enum(['idle', 'archived', 'compaction', 'tool']);
export type LearningTrigger = z.infer<typeof LearningTrigger>;

/** Where something learned came from: what Why? shows. */
export const LearnedFrom = z.object({
  conversationId: z.string().optional(),
  chatTitle: z.string().max(200).optional(),
  /** Your words it rests on, as you wrote them. */
  quotes: z.array(z.string().max(240)).max(3).default([]),
  signals: z.array(LearningSignal).max(9).default([]),
  trigger: LearningTrigger,
  /** The model that read the chat; absent when code learned it (a fact about this computer). */
  model: z.object({ engine: EngineId, model: z.string().max(200).optional() }).optional(),
});
export type LearnedFrom = z.infer<typeof LearnedFrom>;

export const LearnedState = z.enum([
  /** Done by itself; Undo puts back what was there. */
  'applied',
  /** Waiting for your OK: Keep or Forget. */
  'waiting',
  'kept',
  'undone',
  /** Waited, and you said no. */
  'dismissed',
  /** The memory was forgotten some other way since. */
  'gone',
]);
export type LearnedState = z.infer<typeof LearnedState>;

/** One thing Conch learned, in the record (`learning/ledger.json`). */
export const LearnedEntry = z.object({
  id: z.string(),
  at: z.number(),
  /** `added`: something new; `superseded`: what's true now replaced `before`. */
  change: z.enum(['added', 'superseded']),
  /** What it replaced, as it was. */
  before: Memory.optional(),
  /** The memory as it is (or would be, while it waits). */
  after: Memory,
  /** In plain words: “You said you moved to Lisbon.” */
  why: z.string().max(300).default(''),
  from: LearnedFrom,
  /** Why it waits, in a sentence. */
  waits: z.string().max(300).optional(),
  state: LearnedState,
  /** How many times a chat taught it (the first, and each time it came up again). */
  seen: z.number().int().positive().default(1),
});
export type LearnedEntry = z.infer<typeof LearnedEntry>;

/** Something you told Conch not to learn again: you took it back once. */
export const NeverItem = z.object({
  id: z.string(),
  text: z.string().max(300),
  at: z.number(),
  /** `undo`: Undo on something learned; `forgot`: you forgot a memory Conch wrote; `dismissed`: it waited, and you said no. */
  from: z.enum(['undo', 'forgot', 'dismissed']),
});
export type NeverItem = z.infer<typeof NeverItem>;

/** What learning may spend: a person's choice, never the agent's (ADR 0088 § 8). */
export const LearningSpending = z.object({
  /** USD a month; `null`: no limit. */
  limitUsd: z.number().positive().nullable(),
  /** The limit is Conch's default, not one a person chose. */
  isDefault: z.boolean(),
  monthUsd: z.number().nonnegative(),
  /** Learning that costs money is paused until then. */
  paused: z.object({ until: z.number() }).optional(),
});
export type LearningSpending = z.infer<typeof LearningSpending>;

/** The week at a glance, on the Memory page. */
export const LearningRecap = z.object({
  since: z.number(),
  count: z.number().int().nonnegative(),
  /** A few of them, newest first. */
  items: z.array(z.string().max(300)).max(3),
});
export type LearningRecap = z.infer<typeof LearningRecap>;

export const LearningStatus = z.object({
  /** Learn from your chats (`preferences.autoMemory`). */
  on: z.boolean(),
  /** The newest things learned. */
  entries: z.array(LearnedEntry),
  /** How many wait for your OK. */
  waiting: z.number().int().nonnegative(),
  never: z.array(NeverItem),
  /** Memories that stopped being true, newest first. */
  past: z.array(Memory),
  /** This week's, until you've seen it. */
  recap: LearningRecap.optional(),
  spending: LearningSpending,
  /** Learning stopped for now, and why: the cap, or no model that can read a chat. */
  paused: z
    .object({ reason: z.enum(['cap', 'no-model']), until: z.number().optional() })
    .optional(),
  /** Chats marked “Don't learn from this chat”. */
  quiet: z.array(z.string()),
});
export type LearningStatus = z.infer<typeof LearningStatus>;

/** One line of “Learned 2 things” at the end of a chat. */
export const LearnedItem = z.object({
  entryId: z.string(),
  text: z.string().max(2000),
  change: z.enum(['added', 'superseded']),
  state: z.enum(['applied', 'waiting']),
  /** What it replaced. */
  was: z.string().max(2000).optional(),
  /** Why it waits. */
  waits: z.string().max(300).optional(),
});
export type LearnedItem = z.infer<typeof LearnedItem>;

/** Keep, Undo or Forget one thing learned. */
export const LearningAnswerBody = z
  .object({
    entryId: z.string().min(1).max(64),
    answer: z.enum(['keep', 'undo', 'dismiss']),
    /** The words you saw when you answered: Keep is your answer for exactly those. */
    seen: z.string().min(1).max(2000).optional(),
  })
  .strict();
export type LearningAnswerBody = z.infer<typeof LearningAnswerBody>;

/** A person set what learning may spend a month (`null`: no limit). */
export const LearningSpendingBody = z
  .object({ limitUsd: z.number().positive().max(1000).nullable() })
  .strict();
export type LearningSpendingBody = z.infer<typeof LearningSpendingBody>;

/** Don't learn from this chat, or learn from it again. */
export const ChatLearningBody = z.object({ quiet: z.boolean() }).strict();
export type ChatLearningBody = z.infer<typeof ChatLearningBody>;

/** Forget something that used to be true (Memory → Earlier → Forget). */
export const ForgetPastBody = z.object({ id: z.string().min(1).max(80) }).strict();
export type ForgetPastBody = z.infer<typeof ForgetPastBody>;

/** Let Conch learn something again that you'd once taken back. */
export const NeverRemoveBody = z.object({ id: z.string().min(1).max(64) }).strict();
export type NeverRemoveBody = z.infer<typeof NeverRemoveBody>;
