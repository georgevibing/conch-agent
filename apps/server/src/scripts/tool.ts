/**
 * `run_script` (ADR 0119): one short JavaScript program that calls the
 * tools, for work that takes many similar calls. Every provider that runs
 * Conch's tools gets it (ADR 0072), and every call it makes meets the gate a
 * call from the model would (`ScriptTurn.authorize`, built by the turn).
 */
import { SCRIPT_LIMITS } from '@conch/protocol';
import { z } from 'zod';

import type { ToolContext } from '../conversations/manager';
import type { HostTool } from '../engines/types';
import { runScript, type ScriptHost, type ScriptTool } from './runner';

/** What a turn gives its scripts: its tools, its gate, and what follows a call. */
export interface ScriptTurn {
  /** The tools a script may call, by the name the model knows them. */
  tools(): ReadonlyMap<string, ScriptTool>;
  authorize: ScriptHost['authorize'];
  settle: NonNullable<ScriptHost['settle']>;
  /** The `run_script` call running now, when there's exactly one. */
  running(): string | undefined;
}

const shape = {
  title: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .describe(
      'What it does, in a few plain words, for the person: “Tag the invoices among my last 300 emails”.',
    ),
  script: z
    .string()
    .min(1)
    .max(SCRIPT_LIMITS.scriptChars)
    .describe('The JavaScript: the body of an async function. Use await, and return the answer.'),
  seconds: z
    .number()
    .int()
    .min(1)
    .max(SCRIPT_LIMITS.maxSeconds)
    .optional()
    .describe(
      `Seconds of work it may take (default ${SCRIPT_LIMITS.seconds}); waiting for the person isn’t counted.`,
    ),
  calls: z
    .number()
    .int()
    .min(1)
    .max(SCRIPT_LIMITS.maxCalls)
    .optional()
    .describe(`Tool calls it may make (default ${SCRIPT_LIMITS.calls}).`),
};

export const RUN_SCRIPT_DESCRIPTION = [
  'Run a short JavaScript program that calls your tools, for work that takes many similar calls: going through a list (emails, pages, files, rows), filtering or joining what tools return, or a loop you would otherwise do one step at a time. Never for a single call or two: call the tool itself.',
  'Every tool you have is on `tools`, by the same name and with the same input: `const found = await tools.google_mail_search({ query: "invoice" })`. A call gives back the tool’s answer (parsed when it is JSON) or throws an Error saying what went wrong. A call the person says no to throws one named "Declined": catch it to carry on without that one. Each call is checked and asked about exactly as if you made it yourself.',
  `What you return (and console.log) comes back to you, cut to ${SCRIPT_LIMITS.resultChars.toLocaleString('en')} characters, so return what matters (counts, the few rows needed), not everything it read. progress(done, total, "emails") shows how far it is; note("Tagged 12 invoices among 300 emails") tells the person what is happening, and the last note is what the chat shows once it is done.`,
  `It runs sealed off: no network, files or environment of its own, no import or require; only tools. Modern JavaScript, or TypeScript (its types are taken out). ${SCRIPT_LIMITS.seconds} seconds of work and ${SCRIPT_LIMITS.calls} calls by default.`,
].join('\n\n');

/** The tool, for a turn that can run scripts. */
export function scriptTools(ctx: Pick<ToolContext, 'append' | 'signal' | 'script'>): HostTool[] {
  const turn = ctx.script;
  if (!turn) return [];
  const read = z.object(shape);
  return [
    {
      name: 'run_script',
      description: RUN_SCRIPT_DESCRIPTION,
      input: shape,
      // The run is its own story: its row is where the chat tells it.
      row: true,
      alwaysLoad: true,
      searchHint: 'script code loop many tool calls batch each every all',
      aliases: { script: ['code', 'source', 'program', 'js'], title: ['purpose', 'name', 'what'] },
      async run(given) {
        const args = read.parse(given);
        const id = turn.running();
        const outcome = await runScript(
          {
            tools: () => turn.tools(),
            authorize: (display, input, callId) => turn.authorize(display, input, callId),
            settle: (callId, ran) => turn.settle(callId, ran),
            append: (event) => ctx.append(event),
            signal: ctx.signal,
          },
          {
            script: args.script,
            title: args.title,
            ...(args.seconds !== undefined && { seconds: args.seconds }),
            ...(args.calls !== undefined && { calls: args.calls }),
            ...(id && { toolUseId: id }),
          },
        );
        return { text: outcome.text, ...(!outcome.ok && { isError: true }) };
      },
    },
  ];
}
