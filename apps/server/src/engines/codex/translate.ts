/**
 * Codex's JSONL stream, in Conch's words.
 *
 * `codex exec --json` prints one JSON object per line on stdout and its human
 * progress on stderr. Everything here treats those lines as untrusted input:
 * each one is parsed with Zod, and anything we don't recognise — a new event
 * type, a new item type, a truncated line — is ignored rather than allowed to
 * end the turn.
 *
 * Unlike Claude Code, Codex sends no text deltas: a message or a chunk of
 * reasoning arrives whole on `item.completed`. So a reply appears in one piece,
 * which is the engine's behaviour, not a bug in this file.
 */
import type { ToolStatus, Usage } from '@conch/protocol';
import { z } from 'zod';

import type { EngineEvent } from '../types';

/** Tool output we keep. Enough to read, small enough to store and send. */
const OUTPUT_CAP = 20_000;

/** A Codex warning that a setting has a new name — housekeeping, not news. */
const DEPRECATION_RE = /\bis deprecated\b/i;

// ── The wire ────────────────────────────────────────────────────────────────

/** Every line starts as this much; the rest depends on `type`. */
const Envelope = z.object({ type: z.string() });

const ThreadStarted = z.object({ thread_id: z.string() });

const WireUsage = z.object({
  input_tokens: z.number().int().nonnegative().default(0),
  cached_input_tokens: z.number().int().nonnegative().default(0),
  cache_write_input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
  reasoning_output_tokens: z.number().int().nonnegative().default(0),
});

const TurnCompleted = z.object({ usage: WireUsage.optional() });
const Failure = z.object({ error: z.object({ message: z.string().default('') }).optional() });
const FatalError = z.object({ message: z.string().default('') });

/**
 * `status` is deliberately a plain string: a value we haven't seen before must
 * not throw away the whole event, and `toolStatus` below decides what it means.
 */
const Status = z.string().default('completed');

const AgentMessageItem = z.object({
  id: z.string(),
  type: z.literal('agent_message'),
  text: z.string().default(''),
});

const ReasoningItem = z.object({
  id: z.string(),
  type: z.literal('reasoning'),
  text: z.string().default(''),
});

const CommandExecutionItem = z.object({
  id: z.string(),
  type: z.literal('command_execution'),
  command: z.string().default(''),
  aggregated_output: z.string().default(''),
  exit_code: z.number().int().nullish(),
  status: Status,
});

const FileChangeItem = z.object({
  id: z.string(),
  type: z.literal('file_change'),
  changes: z.array(z.object({ path: z.string(), kind: z.string().default('update') })).default([]),
  status: Status,
});

const McpToolCallItem = z.object({
  id: z.string(),
  type: z.literal('mcp_tool_call'),
  server: z.string().default(''),
  tool: z.string().default(''),
  arguments: z.unknown().optional(),
  result: z
    .object({
      content: z.array(z.unknown()).default([]),
      structured_content: z.unknown().optional(),
    })
    .nullish(),
  error: z.object({ message: z.string().default('') }).nullish(),
  status: Status,
});

const WebSearchItem = z.object({
  id: z.string(),
  type: z.literal('web_search'),
  query: z.string().default(''),
  action: z.string().optional(),
  status: Status,
});

const TodoListItem = z.object({
  id: z.string(),
  type: z.literal('todo_list'),
  items: z
    .array(z.object({ text: z.string().default(''), completed: z.boolean().default(false) }))
    .default([]),
});

const ErrorItem = z.object({
  id: z.string(),
  type: z.literal('error'),
  message: z.string().default(''),
});

const ThreadItem = z.discriminatedUnion('type', [
  AgentMessageItem,
  ReasoningItem,
  CommandExecutionItem,
  FileChangeItem,
  McpToolCallItem,
  WebSearchItem,
  TodoListItem,
  ErrorItem,
]);
type ThreadItem = z.infer<typeof ThreadItem>;

const ItemEvent = z.object({ item: ThreadItem });

// ── Helpers ─────────────────────────────────────────────────────────────────

function clip(text: string): string {
  return text.length <= OUTPUT_CAP ? text : `${text.slice(0, OUTPUT_CAP)}\n… output truncated.`;
}

/**
 * How a finished step went. An unfamiliar status reads as "it finished": the
 * alternative — calling every unknown state a failure — would invent errors.
 */
function toolStatus(status: string): ToolStatus {
  return status === 'failed' || status === 'declined' ? 'error' : 'success';
}

/** A finished step's status, cross-checked against what it actually reported. */
function endStatus(item: ThreadItem): ToolStatus {
  if (item.type === 'command_execution' && (item.exit_code ?? 0) !== 0) return 'error';
  if (item.type === 'mcp_tool_call' && item.error) return 'error';
  return 'status' in item ? toolStatus(item.status) : 'success';
}

/** The text parts of an MCP result, which is a list of content blocks. */
function mcpText(content: unknown[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
      continue;
    }
    if (block && typeof block === 'object') {
      const part = block as { type?: unknown; text?: unknown };
      if (typeof part.text === 'string') parts.push(part.text);
      else if (typeof part.type === 'string') parts.push(`[${part.type}]`);
    }
  }
  return parts.join('\n');
}

/** Codex sends tool arguments as an object, or as the JSON text of one. */
function mcpArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return { arguments: value };
  }
}

/**
 * The name and input Conch shows for a step. Names match the ones Claude Code
 * uses (`Bash`, `Edit`, `WebSearch`) so one set of tool cards, permission copy
 * and `humanizeTool` labels serves every engine; MCP calls keep the
 * `mcp__<server>__<tool>` shape the integration rules are written against.
 */
function describeTool(item: ThreadItem): { name: string; input: unknown } | undefined {
  switch (item.type) {
    case 'command_execution':
      return { name: 'Bash', input: { command: item.command } };
    case 'file_change':
      return { name: 'Edit', input: { changes: item.changes } };
    case 'web_search':
      return { name: 'WebSearch', input: { query: item.query } };
    case 'mcp_tool_call':
      return {
        name: `mcp__${item.server}__${item.tool}`,
        input: mcpArguments(item.arguments),
      };
    default:
      return undefined;
  }
}

function toolOutput(item: ThreadItem): string | undefined {
  switch (item.type) {
    case 'command_execution': {
      const output = clip(item.aggregated_output);
      if (item.status === 'declined') {
        return output ? `Codex declined this step.\n${output}` : 'Codex declined this step.';
      }
      return output || undefined;
    }
    case 'file_change':
      return item.changes.map((c) => `${c.kind} ${c.path}`).join('\n') || undefined;
    case 'mcp_tool_call': {
      if (item.error) return clip(item.error.message);
      const text = item.result ? mcpText(item.result.content) : '';
      return text ? clip(text) : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Codex counts `cached_input_tokens` as the part of `input_tokens` that came
 * from the cache, and `reasoning_output_tokens` as part of `output_tokens` —
 * its own `/status` screen subtracts one from the other. So the honest totals
 * are the two top-level numbers; adding the others would count the same tokens
 * twice. There is no `costUsd`: Codex doesn't price a turn, and a guessed price
 * is worse than none.
 */
function usageOf(wire: z.infer<typeof WireUsage> | undefined): Usage | undefined {
  if (!wire) return undefined;
  return { inputTokens: wire.input_tokens, outputTokens: wire.output_tokens };
}

// ── The translator ──────────────────────────────────────────────────────────

/**
 * One line in, zero or more Conch events out. Stateful, because Codex reports
 * a step's start and end as separate items, and because a turn must end with
 * exactly one `done`.
 */
export class Translator {
  /** Items we've already announced, so a completion can't open a second card. */
  #started = new Set<string>();
  #reported = new Set<string>();
  #plan?: string;
  #done = false;

  translate(line: string): EngineEvent[] {
    if (this.#done) return [];
    const trimmed = line.trim();
    if (!trimmed) return [];
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      // A half-written or non-JSON line: progress text, not an event.
      return [];
    }
    const envelope = Envelope.safeParse(raw);
    if (!envelope.success) return [];

    switch (envelope.data.type) {
      case 'thread.started': {
        const parsed = ThreadStarted.safeParse(raw);
        return parsed.success ? [{ type: 'session', resumeId: parsed.data.thread_id }] : [];
      }
      case 'turn.completed': {
        const parsed = TurnCompleted.safeParse(raw);
        this.#done = true;
        const usage = parsed.success ? usageOf(parsed.data.usage) : undefined;
        return [{ type: 'done', outcome: 'success', usage }];
      }
      case 'turn.failed': {
        const parsed = Failure.safeParse(raw);
        this.#done = true;
        return [
          {
            type: 'done',
            outcome: 'error',
            error: (parsed.success && parsed.data.error?.message) || 'Codex couldn’t finish.',
          },
        ];
      }
      case 'error': {
        const parsed = FatalError.safeParse(raw);
        this.#done = true;
        return [
          {
            type: 'done',
            outcome: 'error',
            error: (parsed.success && parsed.data.message) || 'Codex stopped with an error.',
          },
        ];
      }
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        return this.#item(raw, envelope.data.type === 'item.completed');
      default:
        return [];
    }
  }

  #item(raw: unknown, completed: boolean): EngineEvent[] {
    const parsed = ItemEvent.safeParse(raw);
    if (!parsed.success) return [];
    const item = parsed.data.item;

    switch (item.type) {
      case 'agent_message':
      case 'reasoning': {
        // No deltas exist, so the whole message lands here in one go.
        if (!completed || !item.text || this.#reported.has(item.id)) return [];
        this.#reported.add(item.id);
        const type = item.type === 'reasoning' ? 'thinking' : 'text';
        return [
          { type, messageId: item.id, delta: item.text },
          { type: 'message-done', messageId: item.id },
        ];
      }

      case 'todo_list': {
        const done = item.items.filter((t) => t.completed).length;
        if (!item.items.length) return [];
        const message = `Plan: ${done} of ${item.items.length} done`;
        if (message === this.#plan) return [];
        this.#plan = message;
        return [{ type: 'notice', code: 'plan', message }];
      }

      case 'error': {
        if (this.#reported.has(item.id)) return [];
        this.#reported.add(item.id);
        // Codex warns about an outdated config.toml key on every turn. The key
        // still works and nothing in this chat can change it: not worth a word.
        if (DEPRECATION_RE.test(item.message)) return [];
        return [
          { type: 'notice', code: 'error', message: item.message || 'Codex reported a problem.' },
        ];
      }

      default: {
        const tool = describeTool(item);
        if (!tool) return [];
        const out: EngineEvent[] = [];
        // File changes only ever arrive completed; open their card here.
        if (!this.#started.has(item.id)) {
          this.#started.add(item.id);
          out.push({ type: 'tool-start', toolUseId: item.id, name: tool.name, input: tool.input });
        }
        if (completed) {
          out.push({
            type: 'tool-end',
            toolUseId: item.id,
            status: endStatus(item),
            output: toolOutput(item),
          });
        }
        return out;
      }
    }
  }
}
