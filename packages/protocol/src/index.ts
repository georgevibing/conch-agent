/**
 * @conch/protocol — every message exchanged between the browser and the gateway.
 *
 * Both sides MUST parse incoming data with these schemas; types are inferred
 * from the schemas so they never drift. REST bodies live in `rest.ts`-style
 * sections below, the live WebSocket stream in `ClientCommand` / `ServerEvent`.
 */
import { z } from 'zod';

import { ATTACHMENT_LIMITS, Attachment } from './attachments';
import { BrowserHandoff, BrowserPermission, BrowserStatus, BrowserStep } from './browser';
import { Channel, ChannelOrigin } from './channels';
import {
  EffortChoice,
  EngineId,
  Id,
  PermissionMode,
  TurnOptions,
  TurnProblem,
  Usage,
} from './common';
import { EngineStatus, LoginState } from './engine';
import { HealNote } from './healed';
import { Integration } from './integrations';
import { Routine, RoutineRun } from './routines';
import { UsageSnapshot } from './usage';

export * from './access';
export * from './attachments';
export * from './browser';
export * from './channels';
export * from './engine';
export * from './healed';
export * from './integrations';
export * from './common';
export * from './providers';
export * from './routines';
export * from './search';
export * from './setup';
export * from './skills';
export * from './terminal';
export * from './usage';

export const PROTOCOL_VERSION = 7;

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
  /** The provider new chats start with. Every connected provider can be picked (ADR 0012). */
  engine: EngineId.default('claude-code'),
  /** Let the agent save memories on its own (it always tells you). */
  autoMemory: z.boolean().default(true),
  /** Name new conversations with a small, cheap model instead of their first line. */
  autoTitle: z.boolean().default(true),
  /** Default model for new chats — one of the default provider's; unset = its own default. */
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

// ── Health (public) ────────────────────────────────────────────────────────

/**
 * `GET /api/health`, answered for anyone. A Conch starting on a port that's
 * taken asks it, to tell another Conch (open that one) from another program.
 */
export const Health = z.object({
  ok: z.literal(true),
  serverVersion: z.string(),
  protocolVersion: z.number(),
});
export type Health = z.infer<typeof Health>;

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
      autoTitle: z.boolean(),
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
  /** A descriptive title is being written; `title` is the first-line placeholder until then. */
  titling: z.boolean().optional(),
  /** This conversation's own model/effort/mode choices (overrides defaults). */
  options: TurnOptions.default({}),
  /** Set when the conversation is a routine's run rather than a chat you started. */
  origin: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('routine'), routineId: z.string(), runId: z.string() }),
      /** You wrote to your assistant from a chat app (Telegram, Discord, Slack). */
      ChannelOrigin,
    ])
    .optional(),
});
export type ConversationSummary = z.infer<typeof ConversationSummary>;

export const RenameConversationBody = z.object({ title: z.string().trim().min(1).max(120) });

export const ToolStatus = z.enum(['pending', 'running', 'success', 'error']);
export type ToolStatus = z.infer<typeof ToolStatus>;

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
  z.object({
    ...logged,
    type: z.literal('user.message'),
    messageId: z.string(),
    text: z.string(),
    /** Files and long pastes sent with it, in the order they were added. */
    attachments: z.array(Attachment).optional(),
  }),
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
    /** The browser asks about a site or a significant action: show the site and the control. */
    browser: BrowserPermission.optional(),
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
    /** Why it failed, when Conch can tell (see `TurnProblem`). */
    problem: TurnProblem.optional(),
    /** Which provider answered, and with which model when it said. */
    engine: EngineId.optional(),
    model: z.string().optional(),
  }),
  z.object({ ...logged, type: z.literal('title'), title: z.string() }),
  /** A skill was used in this turn — asked for by name, or picked by the assistant. */
  z.object({
    ...logged,
    type: z.literal('skill.used'),
    skillId: z.string(),
    name: z.string(),
    title: z.string(),
    /** `user`: you asked for it (`/name`); `assistant`: it matched the request. */
    by: z.enum(['user', 'assistant']),
  }),
  z.object({
    ...logged,
    type: z.literal('notice'),
    /** e.g. `retry` while the engine retries a failing request. */
    code: z.string(),
    message: z.string(),
  }),
  z.object({ ...logged, type: z.literal('options'), options: TurnOptions }),
  /** A step the agent (or you, while driving) took in this chat's browser tab. */
  z.object({ ...logged, type: z.literal('browser.step'), step: BrowserStep }),
  /** The agent handed the browser to you (sign in, a captcha) — and later, that you handed it back. */
  z.object({ ...logged, type: z.literal('browser.handoff'), handoff: BrowserHandoff }),
  /** The agent created or changed a routine from this chat; rendered as an inline card. */
  z.object({
    ...logged,
    type: z.literal('routine'),
    routineId: z.string(),
    action: z.enum(['proposed', 'updated', 'paused', 'deleted']),
    /** Snapshot for display if the routine is later deleted. */
    title: z.string(),
  }),
  /**
   * An integration Claude would have used isn't working (expired sign-in,
   * unreachable). Rendered inline with a button to fix it.
   */
  z.object({
    ...logged,
    type: z.literal('integration.issue'),
    integrationId: z.string(),
    name: z.string(),
    catalogId: z.string().optional(),
    state: z.enum(['needs-auth', 'error']),
    message: z.string(),
  }),
]);
export type ConversationEvent = z.infer<typeof ConversationEvent>;

export const ConversationDetail = z.object({
  conversation: ConversationSummary,
  events: z.array(ConversationEvent),
});
export type ConversationDetail = z.infer<typeof ConversationDetail>;

// ── WebSocket: client → server ──────────────────────────────────────────────

export const ClientCommand = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('conversation.send'),
      /** Omit to start a new conversation. */
      conversationId: Id.optional(),
      /** Client-generated id so the UI can reconcile optimistic messages. */
      clientMessageId: z.string().min(1).max(128),
      /** May be empty when the message is only attachments. */
      text: z.string().trim().max(200_000),
      /** Ids from `POST /api/attachments`, in order. */
      attachments: z.array(Id).max(ATTACHMENT_LIMITS.maxCount).optional(),
      /** Model/effort/mode for this and later turns of the conversation. */
      options: TurnOptions.optional(),
    })
    .refine((command) => command.text.length > 0 || Boolean(command.attachments?.length), {
      message: 'Write a message or attach something.',
    }),
  z.object({
    type: z.literal('conversation.configure'),
    conversationId: Id,
    options: TurnOptions,
  }),
  z.object({
    type: z.literal('conversation.subscribe'),
    conversationId: Id,
    afterSeq: z.number().int().optional(),
  }),
  z.object({ type: z.literal('conversation.unsubscribe'), conversationId: Id }),
  z.object({ type: z.literal('conversation.interrupt'), conversationId: Id }),
  z.object({
    type: z.literal('permission.respond'),
    conversationId: Id,
    permissionId: Id,
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
  z.object({ type: z.literal('routine.changed'), routine: Routine }),
  z.object({ type: z.literal('routine.deleted'), routineId: z.string() }),
  z.object({ type: z.literal('routine.run'), run: RoutineRun }),
  z.object({ type: z.literal('integration.changed'), integration: Integration }),
  z.object({ type: z.literal('integration.deleted'), integrationId: z.string() }),
  /** A skill was added, changed or removed (here, or in one of the folders Conch reads). */
  z.object({ type: z.literal('skills.changed') }),
  /** Remaining usage changed (a turn finished, a window reset, the provider warned). */
  z.object({ type: z.literal('usage.changed'), usage: UsageSnapshot }),
  /** Terminals were opened, closed or ended somewhere: refetch the list. */
  z.object({ type: z.literal('terminal.changed') }),
  /** The browser started, stopped, is installing (with progress), healed itself or needs you. */
  z.object({ type: z.literal('browser.status'), status: BrowserStatus }),
  /** A channel was connected, changed, went on- or offline, or someone asked to talk. */
  z.object({ type: z.literal('channel.changed'), channel: Channel }),
  z.object({ type: z.literal('channel.deleted'), channelId: z.string() }),
  /** Conch fixed something on its own: a quiet note, never an alert. */
  z.object({ type: z.literal('healed'), note: HealNote }),
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
