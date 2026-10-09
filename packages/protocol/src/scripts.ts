/**
 * Scripts that call tools (ADR 0123): the assistant writes one short
 * JavaScript program that loops over Conch's tools (`await
 * tools.google_mail_search({…})`), and Conch runs it sealed off, every call
 * through the same gate as a call the model made itself. The chat tells the
 * whole run as one story: these are its events.
 *
 * - `script.run` is the run as it stands (started, a progress word, the
 *   end): a later one with the same `runId` replaces it.
 * - `script.call` is one tool call the script made: once as it starts, once
 *   as it ends (the same `callId`).
 *
 * Both are compact on purpose: inputs and outputs are cut to
 * `SCRIPT_LIMITS.keepChars` and outputs to `keepOutput`, since what the script read
 * stays in the script.
 */
import { z } from 'zod';

/** The bounds of one run. Every one of them is a hard stop, said in words when it's reached. */
export const SCRIPT_LIMITS = {
  /** How long a script may work by default, in seconds. Waiting for your answer isn't counted. */
  seconds: 120,
  /** The most it may be given, in seconds. */
  maxSeconds: 600,
  /** Tool calls in one run, by default. */
  calls: 500,
  /** The most tool calls it may be given. */
  maxCalls: 2000,
  /** Tool calls running at once (more wait their turn). */
  parallel: 8,
  /** Its memory, in MB. */
  memoryMb: 256,
  /** The script's own length, in characters. */
  scriptChars: 40_000,
  /** What goes back to the model: characters, then lines of what it logged. */
  resultChars: 20_000,
  resultLines: 400,
  /** One call's input, as the chat keeps it: enough for who it went to and how many things. */
  keepChars: 2_000,
  /** One call's output, as the chat keeps it: enough to read what it said. */
  keepOutput: 800,
  /** One call's input, as the script sends it, in bytes. */
  inputBytes: 512 * 1024,
} as const;

/** Where a run is: at work, finished, failed (its own error, or a bound it met), or stopped by you. */
export const ScriptRunState = z.enum(['running', 'done', 'failed', 'stopped']);
export type ScriptRunState = z.infer<typeof ScriptRunState>;

/** Which bound ended a run, when one did. `you`: Stop, or the turn ended. */
export const ScriptStop = z.enum(['time', 'calls', 'memory', 'output', 'you', 'crash']);
export type ScriptStop = z.infer<typeof ScriptStop>;

/** One tool's calls in a run, counted. */
export const ScriptTally = z.object({
  tool: z.string().min(1).max(200),
  calls: z.number().int().nonnegative(),
  /** Calls that are still running. */
  running: z.number().int().nonnegative().optional(),
  failed: z.number().int().nonnegative().optional(),
  /** Calls you said no to, or a rule stopped. */
  declined: z.number().int().nonnegative().optional(),
});
export type ScriptTally = z.infer<typeof ScriptTally>;

/** How far the script says it has come (`progress(done, total)`). */
export const ScriptProgress = z.object({
  done: z.number().nonnegative(),
  total: z.number().positive().optional(),
  /** What it counts, in a few words: "emails". */
  label: z.string().max(80).optional(),
});
export type ScriptProgress = z.infer<typeof ScriptProgress>;

/** A run, as it stands now. */
export const ScriptRun = z.object({
  runId: z.string().min(1).max(80),
  /** The `run_script` call it is, when Conch could tell (one at a time). */
  toolUseId: z.string().max(200).optional(),
  state: ScriptRunState,
  /** What it's for, in the assistant's words: "Tag the invoices among my emails". */
  title: z.string().min(1).max(160),
  /** The script itself, on its first and last events. */
  script: z.string().max(SCRIPT_LIMITS.scriptChars).optional(),
  /** Tool calls so far. */
  calls: z.number().int().nonnegative(),
  /** Them by tool, most first. */
  tally: z.array(ScriptTally).max(64),
  progress: ScriptProgress.optional(),
  /** The script's latest word for the person (`note(…)`); at the end, what it came to. */
  note: z.string().max(200).optional(),
  /** What went back to the model, once it's over: what it returned and logged, cut to fit. */
  result: z
    .string()
    .max(SCRIPT_LIMITS.resultChars + 2_000)
    .optional(),
  /** Why it failed, in a sentence: the line and the error, or the bound it met. */
  error: z.string().max(2_000).optional(),
  stop: ScriptStop.optional(),
  startedAt: z.number(),
  /** How long it worked, without the time it waited for you. */
  durationMs: z.number().nonnegative().optional(),
});
export type ScriptRun = z.infer<typeof ScriptRun>;

export const ScriptCallStatus = z.enum(['running', 'success', 'error', 'declined']);
export type ScriptCallStatus = z.infer<typeof ScriptCallStatus>;

/** One tool call a script made. */
export const ScriptCall = z.object({
  runId: z.string().min(1).max(80),
  callId: z.string().min(1).max(80),
  /** Which call of the run it is, from 1. */
  step: z.number().int().positive(),
  /** The tool, as the model knows it (`google_mail_search`, `Write`). */
  tool: z.string().min(1).max(200),
  /** What it was given, as JSON, cut to `keepChars`. */
  input: z.string().max(SCRIPT_LIMITS.keepChars + 40),
  status: ScriptCallStatus,
  /** What it answered (or why it failed), cut to `keepOutput`. */
  output: z
    .string()
    .max(SCRIPT_LIMITS.keepOutput + 40)
    .optional(),
  durationMs: z.number().nonnegative().optional(),
});
export type ScriptCall = z.infer<typeof ScriptCall>;

/** A question asked from inside a run: which run, and which of its calls. */
export const ScriptAsk = z.object({
  runId: z.string().min(1).max(80),
  step: z.number().int().positive(),
  /** The run's `title`. */
  title: z.string().min(1).max(160),
});
export type ScriptAsk = z.infer<typeof ScriptAsk>;

/** The tool's name for scripts, wherever it's matched. */
export const RUN_SCRIPT = 'run_script';

/** Whether a tool name is the script tool's, with or without Conch's prefix. */
export const isRunScript = (name: string): boolean =>
  name === RUN_SCRIPT || name === `mcp__conch__${RUN_SCRIPT}`;
