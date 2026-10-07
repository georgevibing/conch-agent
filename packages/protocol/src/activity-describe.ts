/**
 * Every tool call in plain words (ADR 0103), by rules: instant, free, the same
 * for every provider. The server writes these onto `tool.started` and
 * `tool.finished`; the chat works them out here for chats logged before then.
 */
import type { ToolLabel } from './activity';
import type { ToolStatus } from './index';

/** How a call ended, for the words that say what it found. */
export interface ToolResult {
  status: ToolStatus;
  output?: string;
  /** The `kind` of the `ToolView` it returned, when it returned one. */
  viewKind?: string;
}

/** Stub: replaced by the describe work. */
export function describeTool(name: string, input: unknown, result?: ToolResult): ToolLabel {
  void input;
  void result;
  return { family: 'other', doing: `Using ${name}`, done: `Used ${name}` };
}
