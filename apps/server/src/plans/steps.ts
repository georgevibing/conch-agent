/**
 * The plan, ticking itself off (ADR 0060 §6): one shape for every engine's
 * plan. Claude Code's todos, Codex's plan updates, an ACP agent's plan and
 * Conch's own `update_plan` all become a list of `PlanStep`s, made fit to show.
 */
import { PlanStep, type PlanStepStatus } from '@conch/protocol';

/** Steps in one plan, at most: what the `plan` event allows. */
export const MAX_STEPS = 30;
/** Words in one step, at most. */
export const MAX_STEP_LENGTH = 200;

/** A step as an engine said it, before it's made fit to show. */
export interface RawStep {
  title: string;
  status: PlanStepStatus;
}

/**
 * A plan made fit to show: one line per step, trimmed, empty steps dropped,
 * long ones cut with an ellipsis (a step is read, never sent), and thirty at
 * most. Undefined when nothing is left, so an empty plan is never drawn.
 */
export function cleanPlan(raw: readonly RawStep[]): PlanStep[] | undefined {
  const steps: PlanStep[] = [];
  for (const step of raw) {
    let title = step.title.replace(/\s+/g, ' ').trim();
    if (!title) continue;
    if (title.length > MAX_STEP_LENGTH) title = `${title.slice(0, MAX_STEP_LENGTH - 1).trimEnd()}…`;
    const parsed = PlanStep.safeParse({ title, status: step.status });
    if (parsed.success) steps.push(parsed.data);
    if (steps.length === MAX_STEPS) break;
  }
  return steps.length ? steps : undefined;
}

/** The same steps, in the same states: nothing new to show. */
export function samePlan(a: readonly PlanStep[] | undefined, b: readonly PlanStep[]): boolean {
  return (
    a !== undefined &&
    a.length === b.length &&
    a.every((step, i) => step.title === b[i]?.title && step.status === b[i]?.status)
  );
}

/**
 * The way most engines say where a step stands (Claude Code's todos, ACP's
 * plan entries): `pending`, `in_progress`, `completed`. Codex says
 * `inProgress`. Anything else isn't a step.
 */
export function stepStatus(status: unknown): PlanStepStatus | undefined {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'in_progress':
    case 'inProgress':
    case 'active':
      return 'active';
    case 'completed':
    case 'done':
      return 'done';
    default:
      return undefined;
  }
}
