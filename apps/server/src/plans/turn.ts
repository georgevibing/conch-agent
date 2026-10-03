/**
 * One turn's plan (ADR 0055 §6). The engine's own plan (`plan` events) or
 * Conch's `update_plan` tool, whichever the engine has, ends up as `plan`
 * events in the chat: each one the plan as it stands, a repeat left out. The
 * conversation manager only hands over the turn and where to log.
 */
import type { PlanStep } from '@conch/protocol';

import type { Engine, HostTool } from '../engines/types';
import { cleanPlan, samePlan } from './steps';
import { updatePlanTool } from './tools';

export class TurnPlan {
  #last?: PlanStep[];
  /**
   * `update_plan`, for an engine without a plan of its own that can use
   * Conch's tools. One with its own plan never gets it (two plans would
   * fight), and a model that can only chat couldn't call it.
   */
  readonly tools: HostTool[];

  constructor(
    engine: Pick<Engine, 'plans' | 'hostTools'>,
    private readonly log: (steps: PlanStep[]) => void,
  ) {
    this.tools =
      engine.plans === 'native' || engine.hostTools === false
        ? []
        : [updatePlanTool((steps) => this.update(steps))];
  }

  /** The plan as it stands now. Logged unless it's the same as the last one. */
  update(raw: readonly PlanStep[]): void {
    const steps = cleanPlan(raw);
    if (!steps || samePlan(this.#last, steps)) return;
    this.#last = steps;
    this.log(steps);
  }
}
