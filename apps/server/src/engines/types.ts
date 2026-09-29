import type {
  EngineId,
  EngineStatus,
  LoginMethod,
  LoginState,
  ToolStatus,
  Usage,
} from '@conch/protocol';
import type { z } from 'zod';

/**
 * A capability Conch gives the agent regardless of engine (memory today).
 * Engines adapt these to their own mechanism — in-process MCP for Claude
 * Code, function calling for API engines.
 */
export interface HostTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  input: Shape;
  run(args: z.infer<z.ZodObject<Shape>>): Promise<string>;
}

export interface PermissionRequest {
  toolName: string;
  toolUseId?: string;
  input: Record<string, unknown>;
}

export type PermissionDecision = 'allow' | 'allow-always' | 'deny';

export interface TurnInput {
  conversationId: string;
  prompt: string;
  /** Engine-native session to continue, from a previous turn's `session` event. */
  resumeId?: string;
  /** Appended to the engine's own system prompt. */
  systemAppend: string;
  cwd: string;
  tools: HostTool[];
  requestPermission(request: PermissionRequest, signal: AbortSignal): Promise<PermissionDecision>;
  signal: AbortSignal;
}

/** Normalised stream every engine produces for a turn. */
export type EngineEvent =
  | { type: 'session'; resumeId: string; model?: string }
  | { type: 'text'; messageId: string; delta: string }
  | { type: 'thinking'; messageId: string; delta: string }
  | { type: 'message-done'; messageId: string }
  | { type: 'tool-start'; toolUseId: string; name: string; input: unknown }
  | { type: 'tool-end'; toolUseId: string; status: ToolStatus; output?: string }
  | { type: 'done'; outcome: 'success' | 'interrupted' | 'error'; usage?: Usage; error?: string };

export interface LoginHandle {
  submitCode(code: string): void;
  cancel(): void;
}

export interface Engine {
  readonly id: EngineId;
  readonly label: string;
  /** Probe installation and credentials. Cheap to call; results may be cached briefly. */
  detect(options?: { force?: boolean }): Promise<EngineStatus>;
  /** Start an interactive sign-in. Progress is reported through `onUpdate`. */
  login?(method: LoginMethod, onUpdate: (state: LoginState) => void): LoginHandle;
  /** Store an API key the engine should use instead of an interactive login. */
  setApiKey?(apiKey: string | undefined): Promise<void>;
  runTurn(input: TurnInput): AsyncIterable<EngineEvent>;
}
