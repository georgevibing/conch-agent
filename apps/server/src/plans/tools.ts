/**
 * The plan, ticking itself off (ADR 0055 §6), for engines without a plan of
 * their own: the assistant writes its plan with `update_plan`, and the chat
 * draws it as a checklist that ticks itself off as the work goes.
 */
import { PlanStepStatus, type PlanStep } from '@conch/protocol';
import { z } from 'zod';

import type { HostTool } from '../engines/types';
import { MAX_STEPS, MAX_STEP_LENGTH, cleanPlan } from './steps';

export const UPDATE_PLAN_DESCRIPTION = [
  'Show the person your plan for this request as a checklist in the chat, and keep it current as you work.',
  'Use it for work of three or more steps: write every step first, then call it again as each one starts and finishes, so the list ticks itself off while they watch.',
  'Never for a one-step answer, a question, or a quick lookup: then don’t call it.',
  'Each step a few plain words about what you’ll do (“Read the test failures”, “Fix the date parsing”). One step `active` at a time; finished ones `done`; the rest `pending`.',
  'Send the whole list every time: each call replaces the last. Don’t repeat the plan in your reply.',
].join('\n');

/**
 * The `update_plan` host tool. Each call replaces the plan; what to do with it
 * (log it, skip a repeat) is the turn's business, so the tool only hands it on.
 */
export function updatePlanTool(onPlan: (steps: PlanStep[]) => void): HostTool {
  return {
    name: 'update_plan',
    description: UPDATE_PLAN_DESCRIPTION,
    input: {
      steps: z
        .array(
          z.object({
            title: z
              .string()
              .min(1)
              .max(MAX_STEP_LENGTH)
              .describe('What this step does, in a few plain words: “Run the tests”.'),
            status: PlanStepStatus.describe(
              '`pending` (not started), `active` (doing it now) or `done`.',
            ),
          }),
        )
        .min(1)
        .max(MAX_STEPS),
    },
    // Claude Code defers tools until searched for: this one must be known to be called at all.
    alwaysLoad: true,
    searchHint: 'plan steps checklist progress todo',
    run: async (args) => {
      const steps = cleanPlan(
        (args as { steps: { title: string; status: PlanStepStatus }[] }).steps,
      );
      if (!steps) return 'Nothing to show: every step was empty.';
      onPlan(steps);
      const done = steps.filter((s) => s.status === 'done').length;
      return done === steps.length
        ? 'Every step is ticked off in the chat. Now say what you did, briefly.'
        : `The plan shows in the chat (${done} of ${steps.length} done). Call it again as steps start and finish.`;
    },
  };
}
