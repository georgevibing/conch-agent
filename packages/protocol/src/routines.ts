/**
 * Routines — things Conch does on a schedule.
 *
 * Schedules are structured (not raw cron) so they can be validated, edited
 * with friendly controls and described in consistent plain language. `cron`
 * remains as an escape hatch for power users.
 */
import { z } from 'zod';

import { EngineId, TurnOptions, Usage } from './common';

export const Weekday = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export type Weekday = z.infer<typeof Weekday>;

/** 24h wall-clock time in the routine's timezone, e.g. "08:30". */
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 08:30.');

/** Shortest allowed interval — keeps an accidental "every minute" from burning your plan. */
export const MIN_INTERVAL_MINUTES = 15;

export const Schedule = z.discriminatedUnion('type', [
  /** `at` without an offset is a wall-clock time in the routine's timezone. */
  z.object({ type: z.literal('once'), at: z.iso.datetime({ offset: true, local: true }) }),
  z.object({ type: z.literal('daily'), time: ClockTime }),
  z.object({ type: z.literal('weekly'), days: z.array(Weekday).min(1).max(7), time: ClockTime }),
  z.object({
    type: z.literal('monthly'),
    /** Day of month, or `last` for the last day. */
    day: z.union([z.number().int().min(1).max(31), z.literal('last')]),
    time: ClockTime,
  }),
  z.object({
    type: z.literal('interval'),
    every: z.number().int().min(1).max(1000),
    unit: z.enum(['minutes', 'hours']),
  }),
  z.object({ type: z.literal('cron'), expression: z.string().min(9).max(120) }),
]);
export type Schedule = z.infer<typeof Schedule>;

export const RoutineStatus = z.enum([
  /** Proposed by the agent in a chat; waiting for the user to turn it on. */
  'draft',
  'active',
  'paused',
  /** A one-off routine that has run. */
  'completed',
]);
export type RoutineStatus = z.infer<typeof RoutineStatus>;

export const RunStatus = z.enum([
  'running',
  /** Waiting on the user (a permission prompt) — the run is paused, not failed. */
  'needs-you',
  'succeeded',
  /** Ran fine, but there was nothing to do this time (e.g. no new email). */
  'nothing-to-do',
  'failed',
  /** The previous run was still going, so this one didn't start. */
  'skipped',
  /** Conch wasn't running at the scheduled time. */
  'missed',
  'stopped',
]);
export type RunStatus = z.infer<typeof RunStatus>;

// ── Spending (ADR 0057) ─────────────────────────────────────────────────────

/** How the provider that ran it charges: nothing, a subscription's allowance, or money. */
export const Billing = z.enum(['free', 'plan', 'metered']);
export type Billing = z.infer<typeof Billing>;

/** What one run cost. */
export const RunCost = z.object({
  billing: Billing,
  /** Money, when known (USD). On a plan it's what the work would cost at list price. */
  usd: z.number().nonnegative().optional(),
  /** `provider`: the provider said what it cost; `list`: Conch priced the tokens at list prices. */
  priced: z.enum(['provider', 'list']).optional(),
  /** On a plan: the share of its tightest window this run used (0–100), when the provider says. */
  planPercent: z.number().min(0).max(100).optional(),
  engine: EngineId.optional(),
  model: z.string().max(200).optional(),
});
export type RunCost = z.infer<typeof RunCost>;

/**
 * Which spending guard decided how a run ended:
 * - `run`: it used more than one run may, so it stopped;
 * - `month`: routines spent this month's limit, so it didn't start;
 * - `plan-room`: the plan was nearly used up, so it waited to leave room for you.
 */
export const SpendGuard = z.enum(['run', 'month', 'plan-room']);
export type SpendGuard = z.infer<typeof SpendGuard>;

/** A routine's spending at a glance, worked out by Conch (never by the model). */
export const RoutineSpend = z.object({
  billing: Billing.optional(),
  /**
   * One plain line: "About $1.20 a month", "Runs on your Claude Max plan",
   * "Free on this computer". Absent when Conch can't say it honestly.
   */
  text: z.string().optional(),
  /** Projected spend per month (USD), from its schedule and its recent runs. */
  monthlyUsd: z.number().nonnegative().optional(),
  /** `runs`: from what its runs cost; `estimate`: from a typical run on its model, before it has run. */
  basis: z.enum(['runs', 'estimate']).optional(),
  /** What one run may use before it stops: money, or tokens when no price is known. */
  runLimit: z
    .object({
      usd: z.number().positive().optional(),
      tokens: z.number().int().positive().optional(),
      /** Set by a person (“Let it use more”), not Conch's default. */
      custom: z.boolean(),
    })
    .optional(),
});
export type RoutineSpend = z.infer<typeof RoutineSpend>;

/** `GET /api/routines/spending`: what everything that runs unattended spent this month. */
export const RoutineSpending = z.object({
  /** The monthly limit (USD); `null` when there is none. */
  limitUsd: z.number().positive().nullable(),
  /** The limit is Conch's default, not one a person set. */
  isDefault: z.boolean(),
  /** Spent by routines this calendar month (USD), checks before a run included. */
  monthUsd: z.number().nonnegative(),
  /** Every active routine's projected spend per month (USD), when Conch can say. */
  projectedUsd: z.number().nonnegative().optional(),
  /** Routines that cost money are paused until `until` (the 1st of next month). */
  paused: z
    .object({
      until: z.number(),
      /** The person chose “Keep paused”: the card stays away. */
      dismissed: z.boolean(),
    })
    .optional(),
});
export type RoutineSpending = z.infer<typeof RoutineSpending>;

/** `PUT /api/routines/spending` — a person's choice in the UI, never the agent's. */
export const RoutineSpendingBody = z.object({
  /** USD per month; `null` turns the limit off. */
  limitUsd: z.number().positive().max(100_000).nullable(),
});
export type RoutineSpendingBody = z.infer<typeof RoutineSpendingBody>;

export const RoutineRun = z.object({
  id: z.string(),
  routineId: z.string(),
  trigger: z.enum(['schedule', 'manual', 'catch-up']),
  status: RunStatus,
  scheduledFor: z.number().optional(),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  /** Each run is a real conversation you can open, continue, or approve things in. */
  conversationId: z.string().optional(),
  /** One plain-language line about what happened, reported by the agent. */
  outcome: z.string().optional(),
  error: z.string().optional(),
  usage: Usage.optional(),
  /**
   * It didn't run because this provider wasn't ready (signed out, say). Conch
   * runs it once the provider is back — sign in and it goes.
   */
  waitingFor: EngineId.optional(),
  /** What it cost, in money or in plan (ADR 0057). */
  cost: RunCost.optional(),
  /** A spending guard decided how it ended (ADR 0057): see `SpendGuard`. */
  guard: SpendGuard.optional(),
});
export type RoutineRun = z.infer<typeof RoutineRun>;

/** When a routine needs permission while nobody is watching. */
export const RoutineTrust = z.enum([
  /** Pause the run and ask you (you'll be notified). */
  'ask',
  /** Let it edit files without asking; commands still wait for you. */
  'edits',
  /** Let it do anything without asking. */
  'full',
]);
export type RoutineTrust = z.infer<typeof RoutineTrust>;

export const Routine = z.object({
  id: z.string(),
  /** Short, sentence case: "Morning briefing". */
  title: z.string().min(1).max(60),
  /** One plain sentence on what you get: "A summary of today's calendar and weather." */
  summary: z.string().max(200),
  /** The full, self-contained instruction given to Claude on every run. */
  prompt: z.string().min(1).max(20_000),
  schedule: Schedule,
  /** IANA timezone the schedule is expressed in. */
  timezone: z.string(),
  status: RoutineStatus,
  trust: RoutineTrust.default('ask'),
  /** Run once when Conch starts if a scheduled run was missed. */
  catchUp: z.boolean().default(true),
  options: TurnOptions.default({}),
  createdBy: z.enum(['user', 'agent']),
  /** The chat it was created from, if any. */
  sourceConversationId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /**
   * What one run may spend (USD) before it stops, set by a person (“Let it use
   * more”). Unset: Conch's default (ADR 0057).
   */
  runLimitUsd: z.number().positive().max(1000).optional(),
  // Computed by the server:
  /** What it costs, in plain words (ADR 0057). */
  spend: RoutineSpend.optional(),
  /** "Weekdays at 8:00 AM" — always generated by Conch, never by the model. */
  scheduleText: z.string(),
  nextRunAt: z.number().optional(),
  lastRun: RoutineRun.optional(),
  runCount: z.number().int().nonnegative().default(0),
});
export type Routine = z.infer<typeof Routine>;

export const RoutineDetail = z.object({ routine: Routine, runs: z.array(RoutineRun) });
export type RoutineDetail = z.infer<typeof RoutineDetail>;

const editable = {
  title: z.string().trim().min(1).max(60),
  summary: z.string().trim().max(200),
  prompt: z.string().trim().min(1).max(20_000),
  schedule: Schedule,
  timezone: z.string().min(1).max(64),
  trust: RoutineTrust,
  catchUp: z.boolean(),
  options: TurnOptions,
  /** `null` goes back to Conch's default. Only a person sets it (ADR 0057). */
  runLimitUsd: z.number().positive().max(1000).nullable(),
};

export const CreateRoutineBody = z.object({
  ...editable,
  summary: editable.summary.default(''),
  trust: editable.trust.default('ask'),
  catchUp: editable.catchUp.default(true),
  options: editable.options.default({}),
  runLimitUsd: editable.runLimitUsd.optional(),
  status: z.enum(['active', 'paused', 'draft']).default('active'),
});
export type CreateRoutineBody = z.infer<typeof CreateRoutineBody>;

export const UpdateRoutineBody = z
  .object({ ...editable, status: z.enum(['active', 'paused']) })
  .partial();
export type UpdateRoutineBody = z.infer<typeof UpdateRoutineBody>;

export const SchedulePreviewBody = z.object({ schedule: Schedule, timezone: z.string() });
export const SchedulePreview = z.object({
  valid: z.boolean(),
  text: z.string(),
  /** Next few run times (epoch ms). */
  next: z.array(z.number()),
  /** Roughly how many runs per day, to warn about expensive schedules. */
  perDay: z.number().optional(),
  error: z.string().optional(),
});
export type SchedulePreview = z.infer<typeof SchedulePreview>;
