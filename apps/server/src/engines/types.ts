import type {
  Capabilities,
  EffortChoice,
  EngineId,
  EngineStatus,
  ExtraUsage,
  LoginMethod,
  LoginState,
  PermissionMode,
  PlanStep,
  SkillSource,
  ToolStatus,
  ToolView,
  TurnProblem,
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
  /** Trusted tool guarantee: no write was attempted (e.g. approval declined). */
  effect?: 'not-executed';
  images?: { data: string; mimeType: 'image/jpeg' | 'image/png' }[];
  /**
   * What it found, drawn as it is for the person (an agenda, emails, files,
   * messages: ADR 0060). Never shown to the model, which reads `text`.
   */
  view?: ToolView;
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
  /**
   * Show a row for each call as it runs, even when it finds nothing to draw
   * (ADR 0060 shows Conch's own tools only for what they found): an app's own
   * tools, and the steps of making one, are what the person wants to see.
   */
  row?: boolean;
  run(
    args: z.infer<z.ZodObject<Shape>>,
    context?: { operationId: string },
  ): Promise<string | HostToolResult>;
  /** Optional durable-effect contract; a write is confirmed only by a provider receipt. */
  verification?: {
    effect: 'read' | 'write';
    /** Trusted semantic target, never derived from untrusted model claims. */
    identity?(args: Record<string, unknown>): string;
    scope(
      args: Record<string, unknown>,
    ): Promise<{ account: string; authorization: string; expiresAt: number }>;
    reconcile(
      args: Record<string, unknown>,
      operationId: string,
    ): Promise<
      | {
          state: 'confirmed';
          receipt: { provider: string; id: string; label: string; url?: string; empty?: boolean };
        }
      | { state: 'absent' }
      | { state: 'unknown' }
    >;
  };
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
  /**
   * Where the provider account's own connectors (e.g. claude.ai) are managed,
   * if it has any. Only to say where a server it brings came from: the
   * gallery never depends on them, and the portable ones are brought into
   * Conch (ADR 0049).
   */
  account?: { label: string; url: string };
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

/** What an engine does with attachments (ADR 0017). Text always reaches every engine inline. */
export interface EngineAttachments {
  /** It can look at images sent with the message (`TurnInput.images`). */
  images: boolean;
  /** It can open files on this computer by path, with its own tools. */
  files: boolean;
}

/** An image sent with the message, for engines that can see. */
export interface TurnImage {
  name: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  /** Base64, no data-URL prefix. */
  data: string;
}

export interface TurnInput {
  conversationId: string;
  prompt: string;
  /** Images attached to this message, only for engines with `attachments.images`. */
  images?: TurnImage[];
  /** Folders holding this conversation's attachments, for engines with `attachments.files`. */
  readableDirs?: string[];
  /** Files and folders the engine's own tools must never touch (Passwords and Conch's keys). */
  protectedPaths?: string[];
  /** Engine-native session to continue, from a previous turn's `session` event. */
  resumeId?: string;
  /**
   * Where the message this turn answers sits in the chat's log. An engine that
   * keeps the transcript itself (`context`) remembers it per turn, so it can
   * say where the model's memory starts after summarising (ADR 0055).
   */
  seq?: number;
  /** Appended to the engine's own system prompt. */
  systemAppend: string;
  cwd: string;
  tools: HostTool[];
  /** Apply the task ledger to engine-supplied host tools, too. */
  wrapTool?: (tool: HostTool) => HostTool;
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
  /**
   * Looked at before every tool call, in every permission mode (ADR 0028):
   * `ask` sends it to `requestPermission` even when the mode would allow it
   * by itself (the chat read something untrusted; a command leaves the sealed
   * box), `deny` refuses it with a sentence the model can act on. Engines whose
   * mode would skip asking must still consult it (Claude Code: a PreToolUse hook).
   */
  guard?: (request: PermissionRequest) => Promise<GuardDecision | undefined>;
  /**
   * The chat has read something untrusted, or a skill in use doesn't say it
   * may run any command (ADR 0031): engines that can't ask (Codex) run tighter.
   */
  tainted?: boolean;
  /**
   * Run commands in the computer's own sandbox (ADR 0028), for engines that
   * can: writes only to these folders, no reading these.
   */
  sandbox?: { allowWrite: string[]; denyRead: string[] };
}

export type GuardDecision =
  { decision: 'ask'; reason: string } | { decision: 'deny'; message: string };

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
  | {
      type: 'tool-end';
      toolUseId: string;
      status: ToolStatus;
      output?: string;
      /** A host tool's `HostToolResult.view`, passed on for the person (ADR 0060). */
      view?: ToolView;
    }
  | { type: 'notice'; code: string; message: string }
  /**
   * The engine's own plan for this turn, as it stands now (ADR 0060): Claude
   * Code's todo list, Codex's plan updates. Each one replaces the one before.
   */
  | { type: 'plan'; steps: PlanStep[] }
  /** Integrations that failed to connect at the start of the turn. */
  | { type: 'mcp-status'; failed: { name: string; error: string }[] }
  /**
   * The start of the chat no longer fit what the model reads at once, so it
   * was folded into a summary (ADR 0055). `healed`: the provider had already
   * said "too long", and the turn went again by itself.
   */
  | ({ type: 'compacted'; healed?: boolean } & Compacted)
  /**
   * What the turn has used so far (a running total, not a step), from engines
   * that know it before the end — so an unattended run can stop at its limit
   * (ADR 0057). The `done` event's usage stays the final word.
   */
  | { type: 'usage'; usage: Usage }
  | {
      type: 'done';
      outcome: 'success' | 'interrupted' | 'error';
      usage?: Usage;
      error?: string;
      /** Why it failed, when the engine knows (a signed-out account, an overloaded service). */
      problem?: TurnProblem;
    };

/** A one-shot, tool-less request for small housekeeping jobs (e.g. naming a chat). */
export interface CompletionInput {
  system: string;
  prompt: string;
  /** Undefined = the engine's default model. */
  model?: string;
  /** A longer answer than a title (a chat's summary). Undefined = a few words. */
  maxTokens?: number;
  signal: AbortSignal;
}

/** What summarising the start of a chat came to (ADR 0055). */
export interface Compacted {
  /** What the model keeps of the earlier turns. Empty when no model could write one. */
  summary: string;
  /** Where in the chat's log the model's word-for-word memory now starts, when known. */
  fromSeq?: number;
  /** How many earlier turns the summary stands for, in all. */
  turns: number;
  /** The model it was done for, by name. */
  model?: string;
}

/**
 * How an engine fits a long chat into what its model reads at once (ADR
 * 0055). Engines that keep the transcript themselves (the model APIs) offer
 * it; the rest leave it to the provider, which compacts by itself (Claude
 * Code, Codex) or is handed a fresh, bounded handoff every turn (the ACP
 * programs).
 */
export interface EngineContext {
  /**
   * Fold everything but the newest turn of a chat into its summary now
   * (`/compact`), keeping `focus` above all. Undefined: nothing to fold.
   */
  compact(input: {
    resumeId: string;
    model?: string;
    focus?: string;
    signal: AbortSignal;
  }): Promise<Compacted | undefined>;
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
  /**
   * The model runs on this computer: it works with no internet and spends
   * nothing. Offline, Conch answers with it (see ADR 0023).
   */
  readonly local?: boolean;
  /** Probe installation and credentials. Cheap to call; results may be cached briefly. */
  detect(options?: { force?: boolean }): Promise<EngineStatus>;
  /** Start an interactive sign-in. Progress is reported through `onUpdate`. */
  login?(method: LoginMethod, onUpdate: (state: LoginState) => void): LoginHandle;
  /** Disconnect only credentials owned by Conch, never ambient provider sign-ins. */
  disconnect?(): Promise<void>;
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
  /** What it can do with attachments. Absent means text only. */
  readonly attachments?: EngineAttachments;
  /**
   * Whether the engine can run Conch's own tools (`TurnInput.tools`: memory,
   * routines). Absent means yes. An engine that says `false` is never told
   * about tools it can't call, so it won't promise the user something it
   * can't do.
   */
  readonly hostTools?: boolean;
  /**
   * The engine keeps a plan of its own and reports it as `plan` events
   * (ADR 0060). Absent: Conch offers its `update_plan` tool instead, when the
   * engine can use Conch's tools.
   */
  readonly plans?: 'native';
  /** Commands are always sealed by Conch, independent of the native-provider toggle. */
  readonly commandSandbox?: 'conch';
  /** Each turn uses Conch’s complete handoff, not a provider-native resume ID. */
  readonly conversationHistory?: boolean;
  /** Conch fits long chats for it by summarising their start (ADR 0055). Absent: the provider does. */
  readonly context?: EngineContext;
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
