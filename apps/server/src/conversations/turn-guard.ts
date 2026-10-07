/**
 * The turn budget for agents that run their own loop (ADR 0085).
 *
 * The model APIs keep a turn within its budget themselves, because Conch runs
 * their loop (`engines/api`), and Claude Code's program has its own limits.
 * Codex and the ACP programs (Copilot, Gemini CLI, Grok) run their loop out of
 * Conch's sight: all Conch sees is their tool calls. So Conch watches those
 * from outside, with the same `TurnWatch`:
 *
 *  - Conch's own tools (memory, the browser, apps) answer through Conch, so a
 *    loop is first pointed out to the model in the answer it reads, then
 *    stopped there, exactly as for the model APIs.
 *  - The program's own tools (Codex's shell) are only seen go by, so Conch
 *    can't say a word to it: only the plainest loop pauses it (the very same
 *    command, the very same answer, ten times hard on each other). Polling a
 *    test run, failing tests, a grep that finds nothing: all of that is work.
 *  - Steps (two calls to a step), time and fresh tokens are checked as events
 *    arrive, and time also by a timer, for a program that's gone quiet.
 *
 * Stopping is the turn's own Stop, through a signal only the guard holds, and
 * the `done` that follows becomes a pause with **Carry on**, never an error.
 */
import type { TurnPause } from '@conch/protocol';

import { TurnWatch, withNote, type TurnBudget, type Verdict } from '../engines/budget';
import { hostToolText, type Engine, type EngineEvent, type HostTool } from '../engines/types';

/** Conch's own tools, as engines name them. */
const isHostTool = (name: string) => name.startsWith('mcp__conch__');

const NOT_RUN = 'Not run: Conch paused this turn here to check in with the person.';

export interface TurnGuard {
  /** What the turn may do, for an engine that keeps it itself. */
  budget: TurnBudget;
  /** Conch's tools, each answering through the watch. */
  tools: HostTool[];
  /** The signal the engine runs on: the turn's own Stop, or the guard's pause. */
  signal: AbortSignal;
  /** The engine's events, with the pause applied. */
  events(stream: AsyncIterable<EngineEvent>): AsyncIterable<EngineEvent>;
}

/** No guard: an engine that keeps the budget itself. */
function none(budget: TurnBudget, tools: HostTool[], signal: AbortSignal): TurnGuard {
  return { budget, tools, signal, events: (stream) => stream };
}

export function guardTurn(
  engine: Engine | { readonly turnBudget?: 'own' },
  input: { budget: TurnBudget; tools: HostTool[]; signal: AbortSignal; now?: () => number },
): TurnGuard {
  if (engine.turnBudget === 'own') return none(input.budget, input.tools, input.signal);
  const watch = new TurnWatch(input.budget, input.now);
  const pausing = new AbortController();
  let paused: TurnPause | undefined;
  const stop = (verdict: Verdict) => {
    if (verdict.kind !== 'stop' || paused) return;
    paused = verdict.pause;
    pausing.abort();
  };
  const timer = Number.isFinite(input.budget.ms)
    ? setTimeout(() => stop(watch.outside()), input.budget.ms + 10)
    : undefined;
  timer?.unref?.();

  const tools = input.tools.map((tool): HostTool => ({
    ...tool,
    run: async (args) => {
      const name = `mcp__conch__${tool.name}`;
      const before = watch.call(name, args);
      stop(before);
      if (paused) return NOT_RUN;
      let result: Awaited<ReturnType<HostTool['run']>>;
      try {
        result = await tool.run(args);
      } catch (error) {
        // A failure is an answer too: failures in a row earn the model a word (ADR 0102),
        // carried in the error it reads, since that's all it will see of this call.
        const said = error instanceof Error ? error.message : String(error);
        const after = watch.result(name, args, said, true);
        stop(after);
        if (after.kind !== 'nudge' || input.signal.aborted) throw error;
        throw Object.assign(new Error(withNote(said, after.note)), { cause: error });
      }
      const after = watch.result(name, args, hostToolText(result), false);
      stop(after);
      const notes = [before, after].flatMap((v) => (v.kind === 'nudge' ? [v.note] : []));
      if (!notes.length) return result;
      return typeof result === 'string'
        ? notes.reduce(withNote, result)
        : { ...result, text: notes.reduce(withNote, result.text) };
    },
  }));

  return {
    budget: input.budget,
    tools,
    signal: AbortSignal.any([input.signal, pausing.signal]),
    async *events(stream) {
      /** The program's own calls still running, by id; Conch's were counted as they ran. */
      const outside = new Map<string, { name: string; input: unknown }>();
      try {
        for await (const event of stream) {
          if (event.type === 'tool-start' && !isHostTool(event.name)) {
            outside.set(event.toolUseId, { name: event.name, input: event.input });
            stop(watch.call(event.name, event.input));
          } else if (event.type === 'tool-end') {
            const call = outside.get(event.toolUseId);
            if (call) {
              outside.delete(event.toolUseId);
              stop(
                watch.result(call.name, call.input, event.output ?? '', event.status === 'error'),
              );
            }
          }
          if (event.type === 'usage') watch.used(event.usage);
          stop(watch.outside());
          if (event.type === 'done' && paused && !input.signal.aborted) {
            yield {
              type: 'done',
              outcome: 'success',
              ...(event.usage && { usage: event.usage }),
              paused,
            };
            continue;
          }
          yield event;
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
