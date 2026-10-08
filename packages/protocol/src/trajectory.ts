/**
 * How I did it (ADR 0113): any chat, routine run or task drawn as a timeline
 * of what the assistant did, and saved as a file in a format other tools
 * read — for training, for research, or to read. Read from the chat's own
 * log; nothing is kept beside it and nothing leaves the computer.
 */
import { z } from 'zod';

import { ActivityFamily } from './activity';
import { AgentId } from './agents';
import { EngineId, Id, Usage } from './common';
import { AskedPath } from './pick';
import { TurnCost } from './spend';
import { ChangedFile } from './undo';

// ── The timeline ────────────────────────────────────────────────────────────

/**
 * What a step is: what you asked, what it thought or said, a tool call, a
 * question it asked you, files it changed, a page in the browser, work it
 * handed off, something it made or remembered, or a turn that went wrong.
 */
export const RunStepKind = z.enum([
  'asked',
  'thought',
  'said',
  'tool',
  'approval',
  'files',
  'browser',
  'task',
  'made',
  'remembered',
  'problem',
]);
export type RunStepKind = z.infer<typeof RunStepKind>;

/** Most steps a timeline carries; a longer chat says `more`. */
export const RUN_STEP_LIMIT = 2000;

export const RunStep = z.object({
  /** Unique in its timeline. */
  id: z.string().max(200),
  kind: RunStepKind,
  at: z.number(),
  /** How long it took: a tool's run, a thought, the wait for your answer. */
  durationMs: z.number().nonnegative().optional(),
  /** Which turn it belongs to, from 0 (each thing you asked starts one). */
  turn: z.number().int().nonnegative(),
  /** For a tool call: what kind of work, which chooses its glyph. */
  family: ActivityFamily.optional(),
  /** In plain words, past tense: "Ran the tests", "You asked: fix the login". */
  title: z.string().max(200),
  /** A quieter phrase beside it: what it found, what you answered. */
  detail: z.string().max(400).optional(),
  status: z.enum(['done', 'failed', 'declined', 'waiting']).optional(),
  /** The `data-anchor` in the chat to open at. */
  anchor: z.string().max(200).optional(),
  /** A look at it: what came back, the words it wrote, the thought. Clipped. */
  peek: z.string().max(4000).optional(),
  /** What it changed in a file, as `+`/`-` lines. Clipped. */
  diff: z.string().max(40_000).optional(),
  files: z.array(ChangedFile).max(50).optional(),
  /** A browser step's thumbnail (`GET /api/browser/shots/:conversationId/:shot`). */
  shot: z.string().max(200).optional(),
  url: z.string().max(2000).optional(),
});
export type RunStep = z.infer<typeof RunStep>;

/** One turn: from what you asked to its answer, with what it cost. */
export const RunTurn = z.object({
  index: z.number().int().nonnegative(),
  at: z.number(),
  endAt: z.number().optional(),
  outcome: z.enum(['success', 'interrupted', 'error']).optional(),
  engine: EngineId.optional(),
  model: z.string().max(200).optional(),
  usage: Usage.optional(),
  cost: TurnCost.optional(),
});
export type RunTurn = z.infer<typeof RunTurn>;

export const RunTotals = z.object({
  /** Working time: each turn from its start to its end, the gaps between left out. */
  durationMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Money spent on pay-as-you-go providers (USD). */
  usd: z.number().nonnegative(),
  /** Turns answered on a plan, which cost nothing more. */
  planTurns: z.number().int().nonnegative(),
  tools: z.number().int().nonnegative(),
  approvals: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type RunTotals = z.infer<typeof RunTotals>;

/** `GET /api/conversations/:id/timeline`. */
export const RunTimeline = z.object({
  conversationId: z.string(),
  title: z.string(),
  /** What it was: a chat you had, a routine's run, a task, from a chat app or another app. */
  origin: z.enum(['chat', 'routine', 'task', 'channel', 'client', 'artifact']),
  startedAt: z.number(),
  endedAt: z.number(),
  steps: z.array(RunStep).max(RUN_STEP_LIMIT),
  turns: z.array(RunTurn),
  totals: RunTotals,
  /** The chat had more steps than a timeline carries: these are the first. */
  more: z.boolean().optional(),
});
export type RunTimeline = z.infer<typeof RunTimeline>;

// ── Saving it as a file ─────────────────────────────────────────────────────

export const TrajectoryFormat = z.enum(['report', 'markdown', 'openai', 'sharegpt', 'atif']);
export type TrajectoryFormat = z.infer<typeof TrajectoryFormat>;

/** Each format in a person's words, and the file it makes. */
export const TRAJECTORY_FORMATS: Record<
  TrajectoryFormat,
  { title: string; detail: string; extension: string; batchExtension?: string }
> = {
  report: {
    title: 'A page to read',
    detail: 'Every step with what it found, opens in any browser.',
    extension: 'html',
  },
  markdown: {
    title: 'Markdown',
    detail: 'The same, as plain text for notes and documents.',
    extension: 'md',
  },
  openai: {
    title: 'OpenAI chat, for training',
    detail: 'Messages with tool calls, one chat a line (JSONL).',
    extension: 'jsonl',
  },
  sharegpt: {
    title: 'ShareGPT, as Hermes writes it',
    detail: 'Conversations with <tool_call> turns, one chat a line.',
    extension: 'jsonl',
  },
  atif: {
    title: 'ATIF, for agent research',
    detail: 'Harbor’s trajectory format: steps, tool calls, tokens and cost.',
    extension: 'json',
    batchExtension: 'jsonl',
  },
};

/** Which chats: one, or every one in a stretch of time, for one agent or provider. */
export const TrajectoryFilter = z
  .object({
    conversationId: Id.optional(),
    from: z.number().nonnegative().optional(),
    to: z.number().nonnegative().optional(),
    agentId: AgentId.optional(),
    engine: EngineId.optional(),
    /** Routine runs and tasks too, not only chats you had. On unless said. */
    automatic: z.boolean().optional(),
  })
  .strict();
export type TrajectoryFilter = z.infer<typeof TrajectoryFilter>;

/** Most chats in one file. */
export const TRAJECTORY_BATCH_LIMIT = 500;

/** `POST /api/trajectories/preview` and `POST /api/trajectories/export`. */
export const TrajectoryExportBody = z
  .object({
    format: TrajectoryFormat,
    filter: TrajectoryFilter.default({}),
    /** Take out keys and personal details. On unless said. */
    redact: z.boolean().default(true),
    /** The folder to save in, as `chooseOnComputer` gave it. Unset: Downloads. */
    folder: AskedPath.optional(),
  })
  .strict();
export type TrajectoryExportBody = z.input<typeof TrajectoryExportBody>;

/** What was taken out, by kind. */
export const RedactionKind = z.enum([
  'password',
  'key',
  'email',
  'phone',
  'card',
  'address',
  'name',
  'home',
]);
export type RedactionKind = z.infer<typeof RedactionKind>;

/** Each kind in a person's words: "3 keys". */
export const REDACTION_WORDS: Record<RedactionKind, { one: string; many: string }> = {
  password: { one: 'saved password', many: 'saved passwords' },
  key: { one: 'key or token', many: 'keys and tokens' },
  email: { one: 'email address', many: 'email addresses' },
  phone: { one: 'phone number', many: 'phone numbers' },
  card: { one: 'card number', many: 'card numbers' },
  address: { one: 'network address', many: 'network addresses' },
  name: { one: 'name', many: 'names' },
  home: { one: 'folder name', many: 'folder names' },
};

export const Removed = z.object({
  kind: RedactionKind,
  count: z.number().int().positive(),
  /** A few places it was, with what's there now: "OPENAI_API_KEY=[key]". Never the value. */
  examples: z.array(z.string().max(160)).max(3),
});
export type Removed = z.infer<typeof Removed>;

export const TrajectoryPreview = z.object({
  chats: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  /** More chats matched than one file takes: these are the newest. */
  capped: z.boolean().optional(),
  /** Empty when nothing was taken out (or `redact` was off). */
  removed: z.array(Removed),
  /** The file's name, as it will be saved. */
  name: z.string(),
  /** Where it goes. */
  folder: z.object({ path: z.string(), shown: z.string() }),
});
export type TrajectoryPreview = z.infer<typeof TrajectoryPreview>;

export const TrajectoryExportResult = TrajectoryPreview.extend({
  /** The whole path it was saved at. */
  path: z.string(),
  bytes: z.number().int().nonnegative(),
});
export type TrajectoryExportResult = z.infer<typeof TrajectoryExportResult>;

/** "3 keys and tokens, 2 email addresses and your name". */
export function removedWords(removed: readonly Removed[]): string {
  const parts = removed.map((r) =>
    r.kind === 'name' && r.count === 1
      ? 'a name'
      : `${r.count} ${r.count === 1 ? REDACTION_WORDS[r.kind].one : REDACTION_WORDS[r.kind].many}`,
  );
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}
