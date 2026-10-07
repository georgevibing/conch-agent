/**
 * When something in Conch finishes (ADR 0056): a background task, or another
 * routine's run. Conch's own events, so no polling at all. Chains can't loop:
 * a routine can't follow itself or anything that follows it, and a run a
 * chain started carries its path, stopped at five.
 */
import type { RoutineRun, ServerEvent, Task } from '@conch/protocol';

import { TriggerError, type Happening, type TriggerSource } from './types';

/** How long a chain of routines may be. */
export const MAX_CHAIN = 5;

export type Subscribe = (listener: (event: ServerEvent) => void) => () => void;

export interface FinishedDeps {
  subscribe: Subscribe;
  /** The routine a chat is a run of, if it is one. */
  routineOf?: (conversationId: string) => Promise<string | undefined>;
}

export interface ChainDeps {
  /** The routine another one follows, if it follows one. */
  follows: (routineId: string) => Promise<string | undefined>;
  exists: (routineId: string) => Promise<boolean>;
  /** A routine's name, for its words. */
  title: (routineId: string) => string | undefined;
}

const DONE = new Set<Task['status']>(['done', 'unverified', 'failed']);

export function taskSource(deps: FinishedDeps): TriggerSource<'task'> {
  return {
    kind: 'task',
    describe: () => 'When a task finishes',
    note: () => 'Conch starts this as soon as one of your tasks is done.',
    taint: () => ({ kind: 'app', label: 'a finished task' }),
    watch(ctx, arrive) {
      const told = new Set<string>();
      const off = deps.subscribe((event) => {
        if (event.type !== 'task.changed') return;
        const task = event.task;
        if (!DONE.has(task.status) || (task.finishedAt ?? 0) < ctx.since) return;
        const key = `task:${task.id}:${task.status}`;
        if (told.has(key)) return;
        told.add(key);
        void (async () => {
          // A task this routine's own run started doesn't start it again.
          const parent = task.parentConversationId;
          if (parent && (await deps.routineOf?.(parent).catch(() => undefined)) === ctx.routineId)
            return;
          const happening: Happening = {
            id: key,
            at: task.finishedAt ?? Date.now(),
            label:
              task.status === 'failed'
                ? `“${task.title.slice(0, 80)}” didn’t finish`
                : `“${task.title.slice(0, 80)}” finished`,
            detail: [
              `Task: ${task.title}`,
              `Status: ${task.status === 'failed' ? 'did not finish' : task.status === 'unverified' ? 'finished, not verified' : 'done'}`,
              ...(task.error ? [`Problem: ${task.error}`] : []),
              ...(task.summary ? ['', task.summary] : []),
            ].join('\n'),
          };
          arrive([happening]);
        })();
      });
      return { stop: off };
    },
  };
}

export function routineSource(deps: FinishedDeps & ChainDeps): TriggerSource<'routine'> {
  return {
    kind: 'routine',
    async validate(trigger, ctx) {
      if (!(await deps.exists(trigger.routineId)))
        throw new TriggerError('That routine isn’t there any more. Choose another.');
      if (ctx.routineId && trigger.routineId === ctx.routineId)
        throw new TriggerError('A routine can’t start after itself.');
      // Walk what it follows: back to this one would make them start each other forever.
      let at: string | undefined = trigger.routineId;
      for (let step = 0; at && step < 50; step++) {
        if (ctx.routineId && at === ctx.routineId)
          throw new TriggerError('Those routines would start each other forever. Choose another.');
        at = await deps.follows(at);
      }
      return trigger;
    },
    describe: (t) => {
      const title = deps.title(t.routineId);
      return title ? `After “${title}” runs` : 'After another routine runs';
    },
    note: () => 'Conch starts this as soon as the other routine has run and done its job.',
    taint: () => ({ kind: 'app', label: 'another routine’s result' }),
    watch(ctx, arrive) {
      const off = deps.subscribe((event) => {
        if (event.type !== 'routine.run') return;
        const run: RoutineRun = event.run;
        if (run.routineId !== ctx.trigger.routineId || run.status !== 'succeeded') return;
        if (!run.finishedAt || run.finishedAt < ctx.since) return;
        const chain = [...(run.event?.chain ?? []), run.routineId];
        const title = deps.title(run.routineId) ?? 'The other routine';
        const happening: Happening & { chain: string[] } = {
          id: `run:${run.id}`,
          at: run.finishedAt,
          label: `“${title.slice(0, 80)}” ran`,
          detail: [`${title} ran.`, ...(run.outcome ? [`What it said: ${run.outcome}`] : [])].join(
            '\n',
          ),
          chain,
        };
        arrive([happening]);
      });
      return { stop: off };
    },
  };
}
