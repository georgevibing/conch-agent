/**
 * Plan mode for every provider (`/plan`). Claude Code ends plan mode with its
 * own `ExitPlanMode` question; an engine without one gets Conch's
 * `exit_plan_mode` tool instead, which puts the same question to the person,
 * so the chat draws the same card (the plan, **Start** and **Keep planning**)
 * whichever provider answers. Either way, Start takes the chat out of plan
 * mode (`ConversationManager`), so the work can begin in the same turn.
 */
import { z } from 'zod';

import type { Engine, HostTool } from '../engines/types';

/** The question's name in the log: the one the chat draws as the plan to approve. */
export const PLAN_APPROVAL = 'ExitPlanMode';

export const EXIT_PLAN_MODE_DESCRIPTION = [
  'You are in plan mode: look around and read what you need, but change nothing yet.',
  'When your plan is ready, call this with the whole plan, to ask the person to start.',
  'The plan in Markdown: what you will do, step by step, and anything they should know first (what changes, what could go wrong). Short and concrete.',
  'Don’t ask “shall I start?” in words: this is how you ask. Don’t call it for a question you could answer without changing anything: just answer.',
].join('\n');

/** What the model hears after the person chose Keep planning (the same words as Claude Code's). */
export const KEEP_PLANNING =
  'The person chose Keep planning: stay in plan mode and don’t start the work yet. Ask what they’d like changed, or refine the plan and present it again.';

/** In plan mode, for an engine that asks to start through Conch: how plan mode works. */
export const PLAN_MODE_PROMPT = [
  '<plan-mode>',
  'This chat is in plan mode. Read, search and look around as much as you need, but change nothing: no edits, no commands that change anything, nothing sent.',
  'Work out a plan for what the person asked, then call `exit_plan_mode` with it. They approve it with Start, and then you carry it out in this same reply.',
  'A question that needs no changes is simply answered.',
  '</plan-mode>',
].join('\n');

/** Whether this engine, in plan mode, gets Conch's `exit_plan_mode`. */
export function needsPlanTool(engine: Pick<Engine, 'planApproval' | 'hostTools'>): boolean {
  return engine.planApproval !== 'native' && engine.hostTools !== false;
}

/**
 * `exit_plan_mode`: the plan goes to the person as a question. `ask` resolves
 * with their choice; Start (allow) means plan mode is over.
 */
export function exitPlanModeTool(ask: (plan: string) => Promise<'allow' | 'deny'>): HostTool {
  return {
    name: 'exit_plan_mode',
    description: EXIT_PLAN_MODE_DESCRIPTION,
    input: {
      plan: z
        .string()
        .min(1)
        .max(20_000)
        .describe('The plan in Markdown: the steps you will take, and what to know first.'),
    },
    // Claude Code defers tools until searched for; this one must be known to be called at all.
    alwaysLoad: true,
    searchHint: 'plan mode approve start exit plan',
    run: async (args) => {
      const plan = (args as { plan: string }).plan.trim();
      if (!plan) return 'Write the plan first: it was empty.';
      const decision = await ask(plan);
      return decision === 'allow'
        ? 'The person chose Start. Plan mode is over: carry out the plan now, step by step, and say briefly what you did.'
        : KEEP_PLANNING;
    },
  };
}
