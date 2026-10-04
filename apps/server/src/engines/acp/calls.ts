/**
 * What an ACP program does with its own tools, shown the way every other
 * provider's work is: a row per call, running, then done or failed (ADR 0053 §
 * What it did shows). The program says so in `tool_call` and
 * `tool_call_update` notifications; Conch's own tools come through the door,
 * which shows them itself (with their views), so the program's notice of
 * those is left out rather than drawn twice.
 *
 * Telling the two apart is the hard part, because each program names a call
 * to a client's MCP server its own way: Copilot `conch/<tool>` (or the
 * call's `description`), Gemini CLI `<tool>(args…)` or `<tool> (conch MCP
 * Server)`, Grok `use_tool` with `rawInput.tool_name` `conch__<tool>`. A call
 * whose notice doesn't say is held back while it's only `pending`: the
 * program asks before it runs one of the door's tools, and the request names
 * the door (`forDoor`), so by the time it runs Conch knows which it is.
 */
import type { ToolStatus } from '@conch/protocol';

import type { EngineEvent } from '../types';
import { DOOR_NAME } from './door';

/** One `tool_call` / `tool_call_update`, as much of it as Conch reads. */
export interface AcpToolCall {
  toolCallId: string;
  title?: string | null;
  kind?: string | null;
  status?: string | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: unknown;
  locations?: unknown;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a notice names one of the door's tools, in any of the ways the
 * programs do. `strict` (asked to allow it): a title in Gemini CLI's
 * `tool(args…)` form counts only for a call that isn't a command, a change or
 * a fetch, so a shell command that merely reads like one of ours stays the
 * program's own.
 */
export function namesDoorTool(
  call: Pick<AcpToolCall, 'title' | 'kind' | 'rawInput'> | undefined,
  tools: ReadonlySet<string>,
  { strict = false } = {},
): boolean {
  if (!call) return false;
  const loose = !strict || !call.kind || call.kind === 'other';
  const title = (call.title ?? '').trim();
  const input =
    call.rawInput && typeof call.rawInput === 'object'
      ? (call.rawInput as Record<string, unknown>)
      : {};
  // Grok calls a client's MCP tools through its own `use_tool`.
  const through = typeof input.tool_name === 'string' ? input.tool_name : undefined;
  const candidates = [title, ...(through ? [through] : [])];
  const door = escape(DOOR_NAME);
  for (const text of candidates) {
    for (const tool of tools) {
      const name = escape(tool);
      if (
        // conch/x, conch__x, conch-x, conch.x, conch: x, mcp__conch__x, mcp_conch_x
        new RegExp(`^(?:mcp_{1,2})?${door}(?:__|_|/|-|\\.|:\\s?)${name}$`, 'i').test(text) ||
        // x (conch MCP Server)
        new RegExp(`^${name}\\s+\\(${door}(?:\\s+MCP\\s+Server)?\\)$`, 'i').test(text) ||
        // x(args…), Gemini CLI's title while it runs: the door's names are its own
        (loose && text === title && new RegExp(`^${name}\\(.*\\)$`, 's').test(text))
      )
        return true;
    }
  }
  return false;
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    if (typeof item.text === 'string') return item.text;
    if (item.content !== undefined) return text(item.content);
    if (typeof item.output === 'string') return item.output;
    if (typeof item.stdout === 'string') return item.stdout;
  }
  return '';
}

/** A diff in the call's content (`{type: 'diff', path, oldText, newText}`), if there is one. */
function diffOf(
  content: unknown,
): { path?: string; oldText?: string; newText?: string } | undefined {
  if (!Array.isArray(content)) return undefined;
  const found = content.find(
    (c) => c && typeof c === 'object' && (c as { type?: unknown }).type === 'diff',
  ) as { path?: unknown; oldText?: unknown; newText?: unknown } | undefined;
  if (!found) return undefined;
  return {
    ...(typeof found.path === 'string' && { path: found.path }),
    ...(typeof found.oldText === 'string' && { oldText: found.oldText }),
    ...(typeof found.newText === 'string' && { newText: found.newText }),
  };
}

function firstPath(locations: unknown): string | undefined {
  if (!Array.isArray(locations)) return undefined;
  const first = locations[0] as { path?: unknown } | undefined;
  return typeof first?.path === 'string' ? first.path : undefined;
}

/**
 * The row a call is drawn as: Conch's own names where the call is one of
 * those (a file read, a change, a command, a page fetched), so it reads like
 * Claude Code's and Codex's; the program's own title otherwise.
 */
export function rowOf(call: AcpToolCall): { name: string; input: Record<string, unknown> } {
  const input =
    call.rawInput && typeof call.rawInput === 'object' && !Array.isArray(call.rawInput)
      ? (call.rawInput as Record<string, unknown>)
      : {};
  const title = (call.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const path =
    firstPath(call.locations) ??
    (typeof input.path === 'string' ? input.path : undefined) ??
    (typeof input.file_path === 'string' ? input.file_path : undefined);
  const str = (key: string) => (typeof input[key] === 'string' ? input[key] : undefined);
  switch (call.kind) {
    case 'read':
      if (path) return { name: 'Read', input: { file_path: path } };
      break;
    case 'edit':
    case 'delete':
    case 'move': {
      const diff = diffOf(call.content);
      const file = diff?.path ?? path;
      if (file)
        return {
          name: 'Edit',
          input: {
            file_path: file,
            ...(diff?.oldText !== undefined && { old_string: diff.oldText }),
            ...(diff?.newText !== undefined && { new_string: diff.newText }),
          },
        };
      break;
    }
    case 'execute': {
      const command = str('command') ?? str('cmd') ?? title;
      if (command) return { name: 'Bash', input: { command } };
      break;
    }
    case 'fetch': {
      const url = str('url') ?? (/^https?:\/\//.test(title) ? title : undefined);
      if (url) return { name: 'WebFetch', input: { url } };
      const query = str('query');
      if (query) return { name: 'WebSearch', input: { query } };
      break;
    }
    case 'search': {
      const pattern = str('pattern') ?? str('query');
      if (pattern) return { name: 'Grep', input: { pattern, ...(path && { path }) } };
      break;
    }
    default:
      break;
  }
  return { name: title || 'Tool', input: { ...input, ...(title && { description: title }) } };
}

const RUNNING = new Set(['in_progress', 'completed', 'failed']);

/**
 * The program's tool calls in one turn, turned into Conch's tool events.
 * `update` takes each notice; `door` marks a call the program asked to run
 * through the door; `end` closes what's still open when the turn ends.
 */
export class AcpCalls {
  readonly #calls = new Map<
    string,
    { call: AcpToolCall; door: boolean; shown: boolean; ended: boolean }
  >();

  constructor(
    private readonly tools: ReadonlySet<string>,
    private readonly emit: (event: EngineEvent) => void,
    /** Programs number their calls per session: this keeps a chat's rows apart. */
    private readonly prefix = '',
  ) {}

  /** The program asked to run this call, and the request named one of the door's tools. */
  door(toolCallId: string | undefined): void {
    if (!toolCallId) return;
    const known = this.#calls.get(toolCallId);
    if (known) known.door = true;
    else
      this.#calls.set(toolCallId, { call: { toolCallId }, door: true, shown: false, ended: false });
  }

  /** The program declined to run it (Conch said no): a pending one is shown as not run. */
  declined(toolCallId: string | undefined): void {
    const known = toolCallId ? this.#calls.get(toolCallId) : undefined;
    if (!known || known.door || known.ended) return;
    this.#show(known);
    known.ended = true;
    this.emit({
      type: 'tool-end',
      toolUseId: this.prefix + known.call.toolCallId,
      status: 'error',
      output: 'Not run: it wasn’t allowed. Conch’s own tools do this here.',
    });
  }

  update(kind: 'tool_call' | 'tool_call_update', call: AcpToolCall): void {
    let known = this.#calls.get(call.toolCallId);
    if (!known) {
      known = { call: { ...call }, door: false, shown: false, ended: false };
      this.#calls.set(call.toolCallId, known);
    } else
      known.call = Object.fromEntries(
        Object.entries({ ...known.call, ...call }).filter(([, v]) => v !== undefined),
      ) as unknown as AcpToolCall;
    void kind;
    if (known.door || namesDoorTool(known.call, this.tools)) {
      known.door = true;
      return;
    }
    if (known.ended) return;
    const status = known.call.status ?? (kind === 'tool_call' ? 'pending' : undefined);
    // Pending: it may yet turn out to be the door's, once the program asks.
    if (!status || !RUNNING.has(status)) return;
    this.#show(known);
    if (status === 'completed' || status === 'failed') {
      known.ended = true;
      const output = (text(known.call.content) || text(known.call.rawOutput)).slice(-8_000);
      this.emit({
        type: 'tool-end',
        toolUseId: this.prefix + known.call.toolCallId,
        status: (status === 'completed' ? 'success' : 'error') satisfies ToolStatus,
        ...(output && { output }),
      });
    }
  }

  /** The turn is over: whatever is still running didn't finish. */
  end(interrupted: boolean): void {
    for (const known of this.#calls.values())
      if (known.shown && !known.ended) {
        known.ended = true;
        this.emit({
          type: 'tool-end',
          toolUseId: this.prefix + known.call.toolCallId,
          status: interrupted ? 'error' : 'success',
          ...(interrupted && { output: 'Stopped.' }),
        });
      }
  }

  #show(known: { call: AcpToolCall; shown: boolean }) {
    if (known.shown) return;
    known.shown = true;
    const row = rowOf(known.call);
    this.emit({ type: 'tool-start', toolUseId: this.prefix + known.call.toolCallId, ...row });
  }
}
