/**
 * Claude Code's own plan, as Conch's (ADR 0060 §6). Claude Code keeps it one
 * of two ways, depending on its version and settings: a todo list rewritten
 * whole (`TodoWrite`), or tasks made and updated one at a time (`TaskCreate`,
 * `TaskUpdate`). Either way the chat gets the whole plan each time it changes,
 * and the tool calls themselves stay out of the transcript: the checklist
 * says what they did.
 */
import type { PlanStep, PlanStepStatus } from '@conch/protocol';

import { cleanPlan, stepStatus } from '../../plans/steps';

/** Its plan tools. Their rows would only repeat the checklist. */
const PLAN_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

/** A step's words: what it's doing while it's doing it (“Running the tests”), else what it is. */
const titleOf = (status: PlanStepStatus, content?: string, activeForm?: string) =>
  (status === 'active' ? (activeForm ?? content) : (content ?? activeForm)) ?? '';

/** `TodoWrite`'s whole list, as plan steps. */
export function planFromTodos(input: unknown): PlanStep[] | undefined {
  const todos = object(input).todos;
  if (!Array.isArray(todos)) return undefined;
  return cleanPlan(
    todos.flatMap((todo) => {
      const status = stepStatus(object(todo).status);
      if (!status) return [];
      return [
        {
          title: titleOf(status, text(object(todo).content), text(object(todo).activeForm)),
          status,
        },
      ];
    }),
  );
}

interface Task {
  subject: string;
  activeForm?: string;
  status: PlanStepStatus;
}

/**
 * One turn's plan from Claude Code's tool calls. `use` sees each call as the
 * assistant makes it; `result` sees what came back, which is where a new
 * task learns its number.
 */
export class ClaudePlan {
  /** Tasks by id, in the order they were made. A new one has a stand-in id until its number is known. */
  #tasks = new Map<string, Task>();
  /** Tasks made but not yet numbered: the call's id → the stand-in id. */
  #creating = new Map<string, string>();

  /** One of its plan tools: its row stays out of the transcript. */
  owns(name: string): boolean {
    return PLAN_TOOLS.has(name);
  }

  /** A plan tool was called. The plan as it stands now, if that changed it. */
  use(toolUseId: string, name: string, input: unknown): PlanStep[] | undefined {
    const args = object(input);
    switch (name) {
      case 'TodoWrite':
        return planFromTodos(input);
      case 'TaskCreate': {
        const subject = text(args.subject);
        if (!subject) return undefined;
        const id = `new:${toolUseId}`;
        this.#creating.set(toolUseId, id);
        this.#tasks.set(id, { subject, activeForm: text(args.activeForm), status: 'pending' });
        return this.#plan();
      }
      case 'TaskUpdate': {
        const id = text(args.taskId);
        if (!id) return undefined;
        if (args.status === 'deleted') return this.#tasks.delete(id) ? this.#plan() : undefined;
        const known = this.#tasks.get(id);
        const status = stepStatus(args.status) ?? known?.status;
        const subject = text(args.subject) ?? known?.subject;
        // A task from an earlier turn, which this one never saw made: shown once it has words.
        if (!status || !subject) return undefined;
        this.#tasks.set(id, {
          subject,
          activeForm: text(args.activeForm) ?? known?.activeForm,
          status,
        });
        return this.#plan();
      }
      default:
        return undefined;
    }
  }

  /**
   * What a plan tool's call came back with. A made task takes its number from
   * it (“Task #3 created successfully: …”); one that failed is taken away.
   */
  result(
    toolUseId: string,
    output: string,
    isError: boolean,
    structured?: unknown,
  ): PlanStep[] | undefined {
    const id = this.#creating.get(toolUseId);
    if (!id) return undefined;
    this.#creating.delete(toolUseId);
    const task = this.#tasks.get(id);
    if (!task) return undefined;
    if (isError) {
      this.#tasks.delete(id);
      return this.#plan();
    }
    const number =
      text(object(object(structured).task).id) ??
      /Task #(\S+) created successfully/.exec(output)?.[1];
    if (number && number !== id) {
      // Same place in the list, under its real number.
      this.#tasks = new Map(
        [...this.#tasks].map(([key, value]) => [key === id ? number : key, value]),
      );
    }
    return undefined;
  }

  #plan(): PlanStep[] | undefined {
    return cleanPlan(
      [...this.#tasks.values()].map((task) => ({
        title: titleOf(task.status, task.subject, task.activeForm),
        status: task.status,
      })),
    );
  }
}
