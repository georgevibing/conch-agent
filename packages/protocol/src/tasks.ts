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
  /** The model finished, but the requested outcome is not independently verified. */
  'unverified',
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

export const TaskReceipt = z.object({
  empty: z.boolean().optional(),
  provider: z.string().max(100),
  id: z.string().max(500),
  label: z.string().max(500),
  url: z
    .string()
    .refine((value) => /^(https:\/\/|\/(?!\/))/.test(value) && !/[\\\s]/.test(value))
    .optional(),
});
export type TaskReceipt = z.infer<typeof TaskReceipt>;
export const TaskOperation = z.object({
  id: z.string(),
  key: z.string(),
  tool: z.string(),
  inputHash: z.string().optional(),
  /** Read attempts have distinct identities; native results settle only their own invocation. */
  invocationId: z.string().optional(),
  execution: z.enum(['succeeded', 'failed']).optional(),
  /** A declared reconciler failed to prove this effect; different payloads cannot evade it. */
  receiptExpected: z.boolean().optional(),
  checkpoint: z.record(z.string(), z.string()).optional(),
  effect: z.enum(['read', 'write', 'unknown']),
  account: z.string(),
  authorization: z.string(),
  expiresAt: z.number(),
  state: z.enum(['running', 'confirmed', 'unresolved', 'not-run']),
  /**
   * Conch said no before the call started (a hold, a guard, a declined approval), so it
   * never ran: `not-run`, and it counts against nothing. A result that arrives after all
   * takes it back to an ordinary action.
   */
  refused: z.literal(true).optional(),
  goalRevision: z.number().int().nonnegative().optional(),
  startedAt: z.number(),
  confirmedAt: z.number().optional(),
  receipt: TaskReceipt.optional(),
  error: z.string().max(1000).optional(),
});
export type TaskOperation = z.infer<typeof TaskOperation>;
export const TaskExpectation = z.object({
  /** Optional server-pinned target and content constraints; never grant tool authority. */
  inputHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  receipt: z.object({ provider: z.string(), id: z.string() }).optional(),
  unlessEmpty: z.string().optional(),
  tool: z.string().min(1),
  minimum: z.number().int().positive().max(100),
});

export type TaskExpectation = z.infer<typeof TaskExpectation>;

/** Checks fixed before a task starts; the server hashes arguments, never persists them here. */
export const TaskCheck = TaskExpectation.omit({ inputHash: true }).extend({
  tool: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^(?!mcp__conch__$)[A-Za-z0-9_.-]+$/),
  minimum: z.number().int().positive().max(100).default(1),
  // Open objects survive every provider's MCP schema converter; z.record does not.
  arguments: z.looseObject({}).optional(),
});
export type TaskCheck = z.infer<typeof TaskCheck>;
export const TaskChecks = z.array(TaskCheck).min(1).max(100);

/** How much a task asks of this computer while it works (ADR 0129). */
export const TaskWeight = z.enum(['light', 'medium', 'heavy']);
export type TaskWeight = z.infer<typeof TaskWeight>;

/** What a task mostly uses: the processor, memory, the disk, the network, or only the model. */
export const TaskUse = z.enum(['cpu', 'memory', 'disk', 'network', 'model']);
export type TaskUse = z.infer<typeof TaskUse>;

/**
 * What Conch expects of a task before it starts (ADR 0129): from the provider's
 * small model when one may be asked, else from rules. It only ever decides when
 * a task starts and what it runs beside; it never grants anything.
 */
export const TaskEstimate = z.object({
  weight: TaskWeight,
  uses: z.array(TaskUse).max(5),
  /** About how long it takes, in minutes. */
  minutes: z.number().min(0.1).max(240),
  /** What it changes (a file, a folder): two that change the same thing never run together. */
  touches: z.array(z.string().max(200)).max(20).optional(),
  /** Tasks of its batch it starts after. */
  after: z.array(z.string().max(128)).max(6).optional(),
  /** Who estimated it: the small model, or Conch's rules. */
  by: z.enum(['model', 'rules']),
});
export type TaskEstimate = z.infer<typeof TaskEstimate>;

/** Why a task is still waiting (ADR 0129). */
export const TaskWaitReason = z.enum([
  /** Every place is taken: it starts when one finishes. */
  'room',
  /** This computer is short of memory. */
  'memory',
  /** This computer's processor is busy. */
  'cpu',
  /** It starts after another task of its batch. */
  'after',
  /** It changes what a task that's working changes. */
  'conflict',
  /** Its provider asked Conch to slow down. */
  'provider',
  /** Its provider already has as many as it takes well. */
  'provider-busy',
  /** Conch is recovering, or hasn't looked at this computer yet. */
  'recovering',
]);
export type TaskWaitReason = z.infer<typeof TaskWaitReason>;

/** A waiting task's reason, for a machine and in plain words. */
export const TaskWaiting = z.object({
  reason: TaskWaitReason,
  /** "Starts after “Web fetch”", "Waiting for memory: 3 heavy tasks running". */
  words: z.string().max(200),
  /** The tasks it waits for, when it waits for tasks. */
  on: z.array(z.string().max(128)).max(12).optional(),
  /** When it tries again, when that's known (epoch ms). */
  retryAt: z.number().optional(),
  /** About when it should start, from what's working now (epoch ms): a guess. */
  expectedAt: z.number().optional(),
  /** It waits only for room, so the person may start it now. */
  canStartNow: z.boolean().default(false),
});
export type TaskWaiting = z.infer<typeof TaskWaiting>;

export const Task = z.object({
  id: z.string(),
  kind: TaskKind,
  /** Short, sentence case: "Tidy up the README". */
  title: z.string().max(120),
  /** What it was asked to do, in full. */
  prompt: z.string().max(20_000),
  status: TaskStatus,
  /** A saved answer or specified receipts: fixed before execution, never tool authority. */
  completion: z.enum(['response', 'evidence']).optional(),
  /** Server-recorded delivery of a nonempty answer for this goal and attempt. */
  delivery: z
    .object({
      goalRevision: z.number().int().nonnegative(),
      attempt: z.number().int().nonnegative(),
      at: z.number(),
    })
    .optional(),
  /** Server-defined outcome criteria, never a grant of tool permission. */
  expectations: z.array(TaskExpectation).max(100).optional(),
  workflow: z.enum(['document', 'today', 'followups']).optional(),
  requestKey: z.string().max(200).optional(),
  requestHash: z.string().optional(),
  archivedAt: z.number().optional(),
  restored: z.boolean().optional(),
  goalRevision: z.number().int().nonnegative().optional(),
  continuations: z.array(z.object({ key: z.string(), text: z.string() })).optional(),
  toolScope: z
    .object({
      names: z.array(z.string()),
      accountId: z.string().optional(),
      limits: z.record(z.string(), z.number().int().nonnegative().max(100)).optional(),
      argumentHashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).optional(),
    })
    .optional(),
  operations: z.array(TaskOperation).optional(),
  verification: z.enum(['pending', 'verified', 'unverified']).optional(),
  modelCompleted: z.boolean().optional(),
  /** Explicit resumes; original turn permissions apply only to the first attempt. */
  attempt: z.number().int().nonnegative().optional(),
  /** Conch paused it at a safe point to restart (its own update, or a restart asked for): it carries on after. */
  pausedFor: z.enum(['update', 'restart']).optional(),
  /** The chat it was sent from, where its result comes back. */
  parentConversationId: z.string().optional(),
  /**
   * Tasks started together share a group: one batch, shown as one card in the
   * chat they came from. Helpers from one `delegate`, background tasks started
   * in the same reply. Unset, a batch of one.
   */
  group: z.string().optional(),
  /** The conversation it runs in (once it has started). */
  conversationId: z.string().optional(),
  /** The original working folder; a restart must not follow changed workspace settings. */
  cwd: z.string().optional(),
  /** Who answers it, and with which model when it isn't the provider's default. */
  options: TurnOptions.default({}),
  /**
   * The provider doing it, by name, when it isn't the chat's own: a helper
   * handed to another engine ("Codex CLI"). Shown on its card.
   */
  by: z.string().max(80).optional(),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  /** What it's doing right now, when it says: "Running `npm test`". */
  current: z.string().max(240).optional(),
  /**
   * What it's waiting for your OK on (`needs-you`), so the chat it came from
   * can answer it right there. `here` is false for what has its own card (a
   * site, Passwords): that one is answered in the task's own chat.
   */
  asking: z
    .object({
      permissionId: z.string(),
      summary: z.string().max(240),
      toolName: z.string().max(200),
      here: z.boolean(),
      /** The command it wants to run, when it's one. */
      command: z.string().max(500).optional(),
      /** Shows what goes to other people: asked every time, never "Always allow". */
      once: z.boolean().optional(),
      /** Asked because of something it read (ADR 0028): why. */
      taint: z.string().max(300).optional(),
    })
    .optional(),
  /** The last few things it did, newest last. */
  steps: z.array(TaskStep).max(12).default([]),
  /** Its result, in a few lines (the assistant's own summary). */
  summary: z.string().max(4_000).optional(),
  error: z.string().max(1_000).optional(),
  /** A provider reached its limit and another carried on: one sentence. */
  note: z.string().max(300).optional(),
  /** A helper that worked in its own copy of the folder: where, and on which branch. */
  worktree: z
    .object({
      path: z.string(),
      branch: z.string(),
      changed: z.boolean(),
      /** Enough to reopen a clean worktree that Conch deliberately removed. */
      repo: z.string().optional(),
      base: z.string().optional(),
      retained: z.boolean().optional(),
    })
    .optional(),
  /** What Conch expects of it, for deciding when it starts (ADR 0129). */
  estimate: TaskEstimate.optional(),
  /** Still `queued`: why, and until when when that's known (ADR 0129). */
  waiting: TaskWaiting.optional(),
  /** The person pressed "Start now": it goes ahead of what's waiting for room. */
  startNow: z.boolean().optional(),
  /** Goes up with every change, so a newer copy always wins over an older one arriving late. */
  rev: z.number().int().nonnegative().default(0),
});
export type Task = z.infer<typeof Task>;

/**
 * How many tasks this computer takes at once right now (ADR 0129): worked out
 * from its processor and memory as they are, each task's size and each
 * provider's pace, never a fixed number.
 */
export const TaskCapacity = z.object({
  /** About how many run at once right now. */
  atOnce: z.number().int().nonnegative(),
  working: z.number().int().nonnegative(),
  waiting: z.number().int().nonnegative(),
  /** What holds the rest back, in a few words, when something waits for room. */
  words: z.string().max(200).optional(),
});
export type TaskCapacity = z.infer<typeof TaskCapacity>;

export const TaskList = z.object({
  tasks: z.array(Task),
  /** How many run at once; the rest wait their turn. */
  concurrent: z.number().int().positive(),
  /** The same, live, and what holds the rest back (ADR 0129). */
  capacity: TaskCapacity.optional(),
});
export type TaskList = z.infer<typeof TaskList>;

export const CreateTaskBody = z.object({
  checks: TaskChecks.optional(),
  requestKey: z.string().min(1).max(200).optional(),
  text: z.string().trim().min(1).max(20_000),
  /** The chat it's sent from: the result comes back there. */
  conversationId: z.string().max(128).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  options: TurnOptions.optional(),
});
export type CreateTaskBody = z.infer<typeof CreateTaskBody>;

export const ContinueTaskBody = z.object({
  text: z.string().trim().min(1).max(20_000),
  requestKey: z.string().min(1).max(200).optional(),
});
