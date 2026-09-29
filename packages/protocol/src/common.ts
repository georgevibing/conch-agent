/** Schemas shared by conversations and routines. */
import { z } from 'zod';

/** How hard the model thinks. `auto` lets the model decide (engine default). */
export const EffortChoice = z.enum(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
export type EffortChoice = z.infer<typeof EffortChoice>;

/**
 * How much the agent may do without asking — mirrors Claude Code's permission
 * modes: ask first, auto (a classifier approves safe actions), edit files
 * freely, plan only (read-only), or full trust (never asks).
 */
export const PermissionMode = z.enum([
  'default',
  'auto',
  'acceptEdits',
  'plan',
  'bypassPermissions',
]);
export type PermissionMode = z.infer<typeof PermissionMode>;

/** Per-conversation choices; anything unset falls back to the user's defaults. */
export const TurnOptions = z.object({
  model: z.string().max(200).optional(),
  effort: EffortChoice.optional(),
  fastMode: z.boolean().optional(),
  permissionMode: PermissionMode.optional(),
});
export type TurnOptions = z.infer<typeof TurnOptions>;

export const Usage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
});
export type Usage = z.infer<typeof Usage>;
