/**
 * @conch/protocol — every message exchanged between the browser and the gateway.
 *
 * Both sides MUST parse incoming data with these schemas; types are inferred
 * from the schemas so they never drift. REST bodies live in `rest.ts`-style
 * sections below, the live WebSocket stream in `ClientCommand` / `ServerEvent`.
 */
import { z } from 'zod';

export const PROTOCOL_VERSION = 2;

// ── Engine (the agent runtime Conch delegates to) ──────────────────────────

/**
 * Engines Conch can drive. Only `claude-code` ships today; the rest are
 * reserved so the data model, settings and UI never need a migration.
 */
export const EngineId = z.enum(['claude-code', 'codex-cli', 'anthropic-api', 'openrouter', 'mock']);
export type EngineId = z.infer<typeof EngineId>;

export const EngineState = z.enum([
  /** Detection in progress. */
  'checking',
  /** The engine's CLI couldn't be found on this machine. */
  'not-installed',
  /** Installed, but no credentials. */
  'signed-out',
  /** Installed and authenticated — ready to chat. */
  'ready',
  /** Something unexpected (e.g. the CLI crashed while probing). */
  'error',
]);
export type EngineState = z.infer<typeof EngineState>;

export const AuthMethod = z.enum([
  'subscription',
  'console',
  'api-key',
  'bedrock',
  'vertex',
  'foundry',
  'other',
]);
export type AuthMethod = z.infer<typeof AuthMethod>;

export const InstallHint = z.object({
  label: z.string(),
  command: z.string(),
});
export type InstallHint = z.infer<typeof InstallHint>;

export const EngineStatus = z.object({
  engine: EngineId,
  label: z.string(),
  state: EngineState,
  version: z.string().optional(),
  executablePath: z.string().optional(),
  auth: z
    .object({
      method: AuthMethod,
      /** Human description, e.g. "Claude Pro · ada@example.com" or "Amazon Bedrock". */
      description: z.string(),
      email: z.string().optional(),
    })
    .optional(),
  /** Shown when the state needs explaining (errors, odd setups). */
  message: z.string().optional(),
  install: z.array(InstallHint).default([]),
  docsUrl: z.string().optional(),
  /** Whether the engine supports signing in from Conch. */
  canSignIn: z.boolean().default(false),
  checkedAt: z.number(),
});
export type EngineStatus = z.infer<typeof EngineStatus>;

export const LoginMethod = z.enum(['subscription', 'console', 'api-key']);
export type LoginMethod = z.infer<typeof LoginMethod>;

export const LoginState = z.object({
  loginId: z.string(),
  phase: z.enum([
    'starting',
    'waiting-for-browser',
    'needs-code',
    'verifying',
    'done',
    'failed',
    'cancelled',
  ]),
  /** Sign-in page to open if the browser didn't open automatically. */
  url: z.string().optional(),
  message: z.string().optional(),
});
export type LoginState = z.infer<typeof LoginState>;

export const StartLoginBody = z.object({ method: LoginMethod.default('subscription') });
export const LoginCodeBody = z.object({ code: z.string().min(1).max(4096) });
export const ApiKeyBody = z.object({ apiKey: z.string().min(10).max(512) });

// ── Models, thinking and modes ──────────────────────────────────────────────

/** How hard the model thinks. `auto` lets the model decide (engine default). */
export const EffortChoice = z.enum(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
export type EffortChoice = z.infer<typeof EffortChoice>;

/**
 * How much the agent may do without asking — mirrors Claude Code's permission
 * modes: ask first, auto (a classifier approves safe actions), edit files
 * freely, plan only (read-only), or full trust (never asks).
 */
export const PermissionMode = z.enum([
  'default',
  'auto',
  'acceptEdits',
  'plan',
  'bypassPermissions',
]);
export type PermissionMode = z.infer<typeof PermissionMode>;

/** Per-conversation choices; anything unset falls back to the user's defaults. */
export const TurnOptions = z.object({
  model: z.string().max(200).optional(),
  effort: EffortChoice.optional(),
  fastMode: z.boolean().optional(),
  permissionMode: PermissionMode.optional(),
});
export type TurnOptions = z.infer<typeof TurnOptions>;

export const ModelInfo = z.object({
  /** Value passed to the engine (an alias like `opus` or a full id). */
  id: z.string(),
  label: z.string(),
  description: z.string().default(''),
  /** Effort levels this model accepts; empty = no effort control. */
  efforts: z.array(EffortChoice.exclude(['auto'])).default([]),
  supportsFastMode: z.boolean().default(false),
  supportsAutoMode: z.boolean().default(false),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

export const CommandSource = z.enum(['conch', 'custom', 'engine']);
export type CommandSource = z.infer<typeof CommandSource>;

/** A slash command offered by the engine itself (e.g. Claude Code's /compact). */
export const EngineCommand = z.object({
  name: z.string(),
  description: z.string().default(''),
  argumentHint: z.string().default(''),
});
export type EngineCommand = z.infer<typeof EngineCommand>;

export const Capabilities = z.object({
  engine: EngineId,
  label: z.string(),
  models: z.array(ModelInfo),
  commands: z.array(EngineCommand),
  permissionModes: z.array(PermissionMode),
});
export type Capabilities = z.infer<typeof Capabilities>;

/** A user-defined slash command: a reusable prompt. `{{input}}` is replaced by what follows the command. */
export const CommandName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,31}$/, 'Use lowercase letters, numbers and dashes (max 32).');

export const CustomCommand = z.object({
  name: CommandName,
  description: z.string().max(200).default(''),
  prompt: z.string().min(1).max(20_000),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type CustomCommand = z.infer<typeof CustomCommand>;

export const SaveCommandBody = z.object({
  name: CommandName,
  description: z.string().max(200).default(''),
  prompt: z.string().trim().min(1).max(20_000),
});

// ── Personality & profile ───────────────────────────────────────────────────

export const Tone = z.enum(['warm', 'concise', 'playful', 'precise']);
export type Tone = z.infer<typeof Tone>;

export const Persona = z.object({
  /** What the agent calls itself. */
  name: z.string().trim().min(1).max(40).default('Conch'),
  tone: Tone.default('warm'),
  /** Free-form extra guidance ("Always answer in British English"). */
  instructions: z.string().max(4000).default(''),
});
export type Persona = z.infer<typeof Persona>;

export const Profile = z.object({
  /** How the agent should address the user. */
  name: z.string().trim().max(80).default(''),
  /** A few lines about the user, always in context. */
  about: z.string().max(4000).default(''),
});
export type Profile = z.infer<typeof Profile>;

export const Preferences = z.object({
  /** Folder Claude works in. Defaults to the Conch workspace. */
  workspace: z.string().max(4096).optional(),
  engine: EngineId.default('claude-code'),
  /** Let the agent save memories on its own (it always tells you). */
  autoMemory: z.boolean().default(true),
  /** Default model for new conversations; unset = the engine's own default. */
  model: z.string().max(200).optional(),
  effort: EffortChoice.default('auto'),
  fastMode: z.boolean().default(false),
  permissionMode: PermissionMode.default('default'),
});
export type Preferences = z.infer<typeof Preferences>;

// ── Memory ──────────────────────────────────────────────────────────────────

export const MemoryKind = z.enum(['fact', 'preference', 'project', 'person']);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const Memory = z.object({
  id: z.string(),
  content: z.string().min(1).max(2000),
  kind: MemoryKind.default('fact'),
  /** Who wrote it: the user directly, or the agent during a conversation. */
  source: z.enum(['user', 'agent']),
  conversationId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Memory = z.infer<typeof Memory>;

export const CreateMemoryBody = z.object({
  content: z.string().trim().min(1).max(2000),
  kind: MemoryKind.default('fact'),
});
export const UpdateMemoryBody = z.object({
  content: z.string().trim().min(1).max(2000).optional(),
  kind: MemoryKind.optional(),
});

// ── App state (first request the web app makes) ─────────────────────────────

export const AppState = z.object({
  serverVersion: z.string(),
  protocolVersion: z.number(),
  onboarded: z.boolean(),
  persona: Persona,
  profile: Profile,
  preferences: Preferences,
  engine: EngineStatus,
  workspace: z.string(),
});
export type AppState = z.infer<typeof AppState>;

/** Patch bodies must not re-apply defaults, so fields are re-declared without them. */
export const UpdateSettingsBody = z.object({
  persona: z
    .object({
      name: z.string().trim().min(1).max(40),
      tone: Tone,
      instructions: z.string().max(4000),
    })
    .partial()
    .optional(),
  profile: z
    .object({ name: z.string().trim().max(80), about: z.string().max(4000) })
    .partial()
    .optional(),
  preferences: z
    .object({
      workspace: z.string().max(4096),
      engine: EngineId,
      autoMemory: z.boolean(),
      model: z.string().max(200),
      effort: EffortChoice,
      fastMode: z.boolean(),
      permissionMode: PermissionMode,
    })
    .partial()
    .optional(),
  onboarded: z.boolean().optional(),
});
export type UpdateSettingsBody = z.infer<typeof UpdateSettingsBody>;

// ── Conversations ───────────────────────────────────────────────────────────

export const ConversationStatus = z.enum(['idle', 'running', 'awaiting-permission', 'error']);
export type ConversationStatus = z.infer<typeof ConversationStatus>;

export const ConversationSummary = z.object({
  id: z.string(),
  title: z.string(),
  preview: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  status: ConversationStatus,
  /** This conversation's own model/effort/mode choices (overrides defaults). */
  options: TurnOptions.default({}),
});
export type ConversationSummary = z.infer<typeof ConversationSummary>;

export const RenameConversationBody = z.object({ title: z.string().trim().min(1).max(120) });

export const ToolStatus = z.enum(['pending', 'running', 'success', 'error']);
export type ToolStatus = z.infer<typeof ToolStatus>;

export const Usage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
});
export type Usage = z.infer<typeof Usage>;

/** Fields shared by every event in a conversation's ordered log. */
const logged = {
  conversationId: z.string(),
  seq: z.number().int().nonnegative(),
  at: z.number(),
};

/**
 * A conversation is an append-only log of these events. The server persists
 * them, replays them on subscribe, and the client folds them into a view.
 */
export const ConversationEvent = z.discriminatedUnion('type', [
  z.object({ ...logged, type: z.literal('user.message'), messageId: z.string(), text: z.string() }),
  z.object({
    ...logged,
    type: z.literal('assistant.delta'),
    messageId: z.string(),
    kind: z.enum(['text', 'thinking']),
    delta: z.string(),
  }),
  z.object({ ...logged, type: z.literal('assistant.done'), messageId: z.string() }),
  z.object({
    ...logged,
    type: z.literal('tool.started'),
    toolUseId: z.string(),
    name: z.string(),
    input: z.unknown(),
  }),
  z.object({
    ...logged,
    type: z.literal('tool.finished'),
    toolUseId: z.string(),
    status: ToolStatus,
    output: z.string().optional(),
    durationMs: z.number().nonnegative().optional(),
  }),
  z.object({
    ...logged,
    type: z.literal('permission.requested'),
    permissionId: z.string(),
    toolUseId: z.string().optional(),
    toolName: z.string(),
    input: z.unknown(),
    /** One-line human summary, e.g. "Run `npm test`". */
    summary: z.string(),
  }),
  z.object({
    ...logged,
    type: z.literal('permission.resolved'),
    permissionId: z.string(),
    decision: z.enum(['allow', 'allow-always', 'deny', 'expired']),
  }),
  z.object({
    ...logged,
    type: z.literal('memory.saved'),
    memory: Memory,
  }),
  z.object({
    ...logged,
    type: z.literal('memory.forgotten'),
    memoryId: z.string(),
    content: z.string(),
  }),
  z.object({ ...logged, type: z.literal('status'), status: ConversationStatus }),
  z.object({
    ...logged,
    type: z.literal('turn.completed'),
    outcome: z.enum(['success', 'interrupted', 'error']),
    usage: Usage.optional(),
    error: z.string().optional(),
  }),
  z.object({ ...logged, type: z.literal('title'), title: z.string() }),
  z.object({
    ...logged,
    type: z.literal('notice'),
    /** e.g. `retry` while the engine retries a failing request. */
    code: z.string(),
    message: z.string(),
  }),
  z.object({ ...logged, type: z.literal('options'), options: TurnOptions }),
]);
export type ConversationEvent = z.infer<typeof ConversationEvent>;

export const ConversationDetail = z.object({
  conversation: ConversationSummary,
  events: z.array(ConversationEvent),
});
export type ConversationDetail = z.infer<typeof ConversationDetail>;

// ── WebSocket: client → server ──────────────────────────────────────────────

export const ClientCommand = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('conversation.send'),
    /** Omit to start a new conversation. */
    conversationId: z.string().optional(),
    /** Client-generated id so the UI can reconcile optimistic messages. */
    clientMessageId: z.string().min(1).max(128),
    text: z.string().trim().min(1).max(200_000),
    /** Model/effort/mode for this and later turns of the conversation. */
    options: TurnOptions.optional(),
  }),
  z.object({
    type: z.literal('conversation.configure'),
    conversationId: z.string(),
    options: TurnOptions,
  }),
  z.object({
    type: z.literal('conversation.subscribe'),
    conversationId: z.string(),
    afterSeq: z.number().int().optional(),
  }),
  z.object({ type: z.literal('conversation.unsubscribe'), conversationId: z.string() }),
  z.object({ type: z.literal('conversation.interrupt'), conversationId: z.string() }),
  z.object({
    type: z.literal('permission.respond'),
    conversationId: z.string(),
    permissionId: z.string(),
    decision: z.enum(['allow', 'allow-always', 'deny']),
  }),
  z.object({ type: z.literal('ping') }),
]);
export type ClientCommand = z.infer<typeof ClientCommand>;

// ── WebSocket: server → client ──────────────────────────────────────────────

export const ServerEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    protocolVersion: z.number().int(),
    serverVersion: z.string(),
  }),
  z.object({
    type: z.literal('conversation.created'),
    clientMessageId: z.string(),
    conversation: ConversationSummary,
  }),
  z.object({ type: z.literal('conversation.updated'), conversation: ConversationSummary }),
  z.object({ type: z.literal('conversation.deleted'), conversationId: z.string() }),
  z.object({ type: z.literal('conversation.event'), event: ConversationEvent }),
  z.object({ type: z.literal('engine.status'), status: EngineStatus }),
  z.object({ type: z.literal('engine.login'), login: LoginState }),
  z.object({ type: z.literal('memory.changed') }),
  z.object({ type: z.literal('pong') }),
  z.object({
    type: z.literal('error'),
    code: z.enum(['bad-request', 'engine-unavailable', 'not-found', 'busy', 'internal']),
    message: z.string(),
    conversationId: z.string().optional(),
    clientMessageId: z.string().optional(),
  }),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;

/** Distributes Omit over a union (TS's built-in Omit collapses unions). */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A conversation event before the log assigns `seq`/`at`/`conversationId`. */
export type ConversationEventInput = DistributiveOmit<
  ConversationEvent,
  'seq' | 'at' | 'conversationId'
>;
