/**
 * Hand it off (ADR 0033): work that runs in the background while you get on
 * with something else — a task you send away, or helpers the assistant runs
 * side by side — each as a real conversation you can open, approve things
 * in, stop or try again.
 */
import { z } from 'zod';

import { TurnOptions } from './common';

export const TaskStatus = z.enum([
  /** Waiting for a free slot. */
  'queued',
  'running',
  /** Waiting for your OK on something (in-app and as a notification). */
  'needs-you',
  'done',
  'failed',
  /** You stopped it. */
  'stopped',
  /** Conch stopped while it ran (a restart, a crash): one press runs it again. */
  'interrupted',
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskKind = z.enum([
  /** You sent it away ("Do it in the background"). */
  'background',
  /** The assistant split its work and runs this part side by side (`delegate`). */
  'helper',
]);
export type TaskKind = z.infer<typeof TaskKind>;

/** One thing it did, in the past tense: "Ran `npm test`". */
export const TaskStep = z.object({ at: z.number(), label: z.string().max(240) });
export type TaskStep = z.infer<typeof TaskStep>;

export const Task = z.object({
  id: z.string(),
  kind: TaskKind,
  /** Short, sentence case: "Tidy up the README". */
  title: z.string().max(120),
  /** What it was asked to do, in full. */
  prompt: z.string().max(20_000),
  status: TaskStatus,
  /** The chat it was sent from, where its result comes back. */
  parentConversationId: z.string().optional(),
  /** Helpers started together share a group: their results are merged. */
  group: z.string().optional(),
  /** The conversation it runs in (once it has started). */
  conversationId: z.string().optional(),
  /** Who answers it, and with which model when it isn't the provider's default. */
  options: TurnOptions.default({}),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  /** What it's doing right now, when it says: "Running `npm test`". */
  current: z.string().max(240).optional(),
  /** The last few things it did, newest last. */
  steps: z.array(TaskStep).max(12).default([]),
  /** Its result, in a few lines (the assistant's own summary). */
  summary: z.string().max(4_000).optional(),
  error: z.string().max(1_000).optional(),
  /** A provider reached its limit and another carried on: one sentence. */
  note: z.string().max(300).optional(),
  /** A helper that worked in its own copy of the folder: where, and on which branch. */
  worktree: z.object({ path: z.string(), branch: z.string(), changed: z.boolean() }).optional(),
  /** Goes up with every change, so a newer copy always wins over an older one arriving late. */
  rev: z.number().int().nonnegative().default(0),
});
export type Task = z.infer<typeof Task>;

export const TaskList = z.object({
  tasks: z.array(Task),
  /** How many run at once; the rest wait their turn. */
  concurrent: z.number().int().positive(),
});
export type TaskList = z.infer<typeof TaskList>;

export const CreateTaskBody = z.object({
  text: z.string().trim().min(1).max(20_000),
  /** The chat it's sent from: the result comes back there. */
  conversationId: z.string().max(128).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  options: TurnOptions.optional(),
});
export type CreateTaskBody = z.infer<typeof CreateTaskBody>;
