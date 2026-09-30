import type {
  Capabilities,
  EffortChoice,
  EngineId,
  EngineStatus,
  LoginMethod,
  LoginState,
  PermissionMode,
  SkillSource,
  ExtraUsage,
  ToolStatus,
  Usage,
  UsageKind,
  UsageWindow,
} from '@conch/protocol';
import type { z } from 'zod';

/**
 * What a host tool returns when text isn't enough: a screenshot, say.
 * Engines that can show a model images pass them on; the rest use `text`.
 */
export interface HostToolResult {
  text: string;
  images?: { data: string; mimeType: 'image/jpeg' | 'image/png' }[];
}

/**
 * A capability Conch gives the agent regardless of engine (memory, the
 * browser…). Engines adapt these to their own mechanism — in-process MCP for
 * Claude Code, function calling for API engines.
 */
export interface HostTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  input: Shape;
  run(args: z.infer<z.ZodObject<Shape>>): Promise<string | HostToolResult>;
  /**
   * Load it into the model's context up front, for engines that otherwise defer
   * tools until searched for (Claude Code). For the few tools a task starts with.
   */
  alwaysLoad?: boolean;
  /** Words that find it when tools are searched for. */
  searchHint?: string;
}

/** A host tool's result as plain text, for engines (and logs) that only take text. */
export function hostToolText(result: string | HostToolResult): string {
  return typeof result === 'string' ? result : result.text;
}

/**
 * An integration's tool, handed to an engine that can't talk MCP itself
 * (`integrations.mode === 'bridge'`). Conch holds the MCP connection;
 * `run` has already been through the user's permission rules.
 */
export interface BridgedTool {
  /** `mcp__<server>__<tool>`, the same name native engines use. */
  name: string;
  description: string;
  /** JSON Schema for the arguments, straight from the server. */
  inputSchema: Record<string, unknown>;
  run(
    args: Record<string, unknown>,
    toolUseId: string,
  ): Promise<{ text: string; isError: boolean }>;
}

/** How an engine takes part in integrations. Every engine must say. */
export interface EngineIntegrations {
  /**
   * `native`: the engine runs MCP servers itself (Claude Code, Codex CLI) and
   * gets `TurnInput.mcpServers`. `bridge`: a plain model API (OpenRouter,
   * Anthropic API) that gets `TurnInput.bridgedTools` for its tool calling.
   */
  mode: 'native' | 'bridge';
  /** The provider account's own connectors (e.g. claude.ai), if there are any. */
  account?: {
    label: string;
    url: string;
    /** Whether the current sign-in can use them. */
    ready(status: EngineStatus): { ready: boolean; hint?: string };
  };
  /** How to sign in to a server the engine configured itself, in plain words. */
  signInHint?: string;
}

export interface PermissionRequest {
  toolName: string;
  toolUseId?: string;
  input: Record<string, unknown>;
}

export type PermissionDecision = 'allow' | 'allow-always' | 'deny';

/** An MCP server to load for a turn, secrets included. Never leaves the gateway. */
export type EngineMcpServer =
  | { type: 'http'; url: string; headers?: Record<string, string> }
  | { type: 'stdio'; command: string; args: string[]; env?: Record<string, string> };

/** An MCP server the engine loads on its own (its settings, the provider account, plugins). */
export interface EngineMcpStatus {
  /** Display name, cleaned of engine-specific prefixes. */
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  /** Where it's configured, normalised by the engine. */
  source: 'engine' | 'project' | 'account' | 'plugin' | 'other';
  error?: string;
  /** The plugin that brings it, for servers a plugin adds. */
  plugin?: string;
  toolCount: number;
  /** For recognising well-known services; never shown. */
  url?: string;
}

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
  /** Resolved choices for this turn (conversation overrides merged over defaults). */
  options: ResolvedOptions;
  /** Native engines: integrations to load, keyed by server name (tools become `mcp__<name>__<tool>`). */
  mcpServers?: Record<string, EngineMcpServer>;
  /** Bridge engines: integration tools Conch is connected to for this turn. */
  bridgedTools?: BridgedTool[];
  /** Tools the user turned off; the model never sees them. */
  disallowedTools?: string[];
}

export interface ResolvedOptions {
  /** Undefined = the engine's default model. */
  model?: string;
  effort: EffortChoice;
  fastMode: boolean;
  permissionMode: PermissionMode;
}

/** Normalised stream every engine produces for a turn. */
export type EngineEvent =
  | { type: 'session'; resumeId: string; model?: string }
  | { type: 'text'; messageId: string; delta: string }
  | { type: 'thinking'; messageId: string; delta: string }
  | { type: 'message-done'; messageId: string }
  | { type: 'tool-start'; toolUseId: string; name: string; input: unknown }
  | { type: 'tool-end'; toolUseId: string; status: ToolStatus; output?: string }
  | { type: 'notice'; code: string; message: string }
  /** Integrations that failed to connect at the start of the turn. */
  | { type: 'mcp-status'; failed: { name: string; error: string }[] }
  | { type: 'done'; outcome: 'success' | 'interrupted' | 'error'; usage?: Usage; error?: string };

/** A one-shot, tool-less request for small housekeeping jobs (e.g. naming a chat). */
export interface CompletionInput {
  system: string;
  prompt: string;
  /** Undefined = the engine's default model. */
  model?: string;
  signal: AbortSignal;
}

export interface Completion {
  text: string;
  usage?: Usage;
}

/** What the engine's provider says about your limits right now. */
export interface EngineUsage {
  kind: UsageKind;
  /** Who meters you, e.g. "Claude Max" or "Amazon Bedrock". */
  source: string;
  windows: UsageWindow[];
  extra?: ExtraUsage;
  message?: string;
}

/** A live hint from the provider during a turn (e.g. a rate-limit header changed). */
export interface LimitSignal {
  status: 'allowed' | 'warning' | 'rejected';
  windowId?: string;
  /** Epoch ms. */
  resetsAt?: number;
}

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
  /** Models, slash commands and permission modes the engine offers right now. */
  capabilities(options?: { force?: boolean }): Promise<Capabilities>;
  runTurn(input: TurnInput): AsyncIterable<EngineEvent>;
  /**
   * The provider's small, fast model (an alias the engine resolves), for when
   * the model list doesn't show one — some accounts hide it but still serve it.
   */
  readonly smallModel?: string;
  /** Answer a single prompt with plain text: no tools, no session, no thinking. */
  complete?(input: CompletionInput): Promise<Completion>;
  /** Current plan limits. Engines without limits omit it; Conch then only tracks spend. */
  usage?(options?: { force?: boolean }): Promise<EngineUsage>;
  /** How this engine uses integrations. */
  readonly integrations: EngineIntegrations;
  /**
   * Whether the engine can run Conch's own tools (`TurnInput.tools`: memory,
   * routines). Absent means yes. An engine that says `false` is never told
   * about tools it can't call, so it won't promise the user something it
   * can't do.
   */
  readonly hostTools?: boolean;
  /**
   * Skill folders the engine reads by itself (Claude Code reads
   * `~/.claude/skills`). Conch doesn't list those skills to it a second time.
   */
  readonly skillSources?: readonly SkillSource[];
  /** MCP servers the engine loads by itself, and whether they work. */
  mcpStatus?(): Promise<EngineMcpStatus[]>;
  /** Subscribe to live limit hints emitted while turns run. */
  onLimits?(listener: (signal: LimitSignal) => void): () => void;
}
