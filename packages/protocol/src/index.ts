/**
 * @conch/protocol — every message exchanged between the browser and the gateway.
 *
 * Both sides MUST parse incoming data with these schemas; types are inferred
 * from the schemas so they never drift. REST bodies live in `rest.ts`-style
 * sections below, the live WebSocket stream in `ClientCommand` / `ServerEvent`.
 */
import { z } from 'zod';

import { Artifact, ArtifactKind } from './artifacts';
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
import { DoctorReport } from './doctor';
import { EngineStatus, LoginState } from './engine';
import { HealNote } from './healed';
import { CatalogId, Integration } from './integrations';
import { Routine, RoutineRun } from './routines';
import { VaultPermission, VaultRequest } from './vault';
import { VoiceStatus } from './phone';
import { ChangedFile } from './undo';
import { UpdatesStatus } from './updates';
import { UsageSnapshot } from './usage';

export * from './access';
export * from './artifacts';
export * from './attachments';
export * from './background';
export * from './backups';
export * from './browser';
export * from './channels';
export * from './engine';
export * from './healed';
export * from './import';
export * from './integrations';
export * from './local';
export * from './common';
export * from './doctor';
export * from './phone';
export * from './providers';
export * from './routines';
export * from './safety';
export * from './search';
export * from './setup';
export * from './skills';
export * from './terminal';
export * from './undo';
export * from './updates';
export * from './usage';
export * from './vault';
export * from './passwords';
export * from './pick';
export * from './words';

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

/** Catalog ids, each once. */
const MutedSuggestions = z
  .array(CatalogId)
  .max(100)
  .transform((ids) => [...new Set(ids)]);

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
  /**
   * Offline, answer with a model on this computer (a `local` provider) instead
   * of holding messages until the internet is back. Only matters once one is set up.
   */
  offlineFallback: z.boolean().default(true),
  /**
   * When a provider reaches its usage limit, carry on with this one until it
   * resets. Unset: wait (the chat offers another provider, but never switches by itself).
   */
  limitFallback: EngineId.optional(),
  /** Apps the chat never offers to connect ("Don't suggest Linear"), by catalog id. */
  mutedSuggestions: MutedSuggestions.default([]),
  /**
   * Once a chat has read something from outside (a web page, an email, someone
   * else's message), anything that could send it out or change this computer
   * asks first, in every mode (ADR 0028).
   */
  checkAfterReading: z.boolean().default(true),
  /**
   * Commands run in a sealed box: they can change the work folder and caches,
   * and can't read where keys and passwords live (ADR 0028).
   */
  sealedCommands: z.boolean().default(true),
  /** Conch in the menu bar, tray or panel, whenever it runs (ADR 0029). */
  menuBar: z.boolean().default(true),
  /** A Mac on mains power stays awake while Conch runs in the background (ADR 0029). */
  keepAwake: z.boolean().default(false),
});
export type Preferences = z.infer<typeof Preferences>;

/** Where something untrusted came into a chat from (ADR 0028). */
export const TaintSource = z.object({
  kind: z.enum(['web', 'download', 'app', 'person']),
  /** "example.com", "Gmail", "Ana on Telegram". */
  label: z.string().max(120),
});
export type TaintSource = z.infer<typeof TaintSource>;

/** Whether Conch can reach the internet (it checks now and then, and when a provider stops answering). */
export const NetworkStatus = z.object({
  online: z.boolean(),
  /** When it last changed. */
  since: z.number().optional(),
});
export type NetworkStatus = z.infer<typeof NetworkStatus>;

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
  /** Changes every time the gateway starts: the page knows a restart has finished. */
  bootId: z.string().optional(),
  /** Conch can start itself again (it runs under `pnpm start`'s supervisor). */
  restartable: z.boolean().optional(),
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
  /** Whether Conch can reach the internet right now. */
  network: NetworkStatus.default({ online: true }),
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
      offlineFallback: z.boolean(),
      /** `null` goes back to waiting for the limit to reset. */
      limitFallback: EngineId.nullable(),
      mutedSuggestions: MutedSuggestions,
      /** Turning either off needs a recent password or key (ADR 0028). */
      checkAfterReading: z.boolean(),
      sealedCommands: z.boolean(),
      menuBar: z.boolean(),
      keepAwake: z.boolean(),
    })
    .partial()
    .optional(),
  onboarded: z.boolean().optional(),
});
export type UpdateSettingsBody = z.infer<typeof UpdateSettingsBody>;

/** Send a message that's waiting for the internet now — optionally with another provider. */
export const ReleaseTurnBody = z.object({ engine: EngineId.optional() }).strict();
export type ReleaseTurnBody = z.infer<typeof ReleaseTurnBody>;

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
      /** A pinned app fetching fresh data (ADR 0034). */
      z.object({ kind: z.literal('artifact'), artifactId: z.string() }),
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
    /** The agent asks to read or fill something from Passwords (ADR 0025). */
    vault: VaultPermission.optional(),
    /**
     * Asked because the chat read something untrusted (ADR 0028): why, in a
     * sentence. Such a question offers no "always".
     */
    taint: z.string().optional(),
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
  /** The chat read something from outside: from here on, sending and changing ask first (ADR 0028). */
  z.object({ ...logged, type: z.literal('taint'), source: TaintSource }),
  /**
   * The assistant created, changed or deleted files (ADR 0030): what, and the
   * change set that puts them back. `toolUseId` when one tool call did it;
   * unset for what a turn changed some other way (a command, another provider).
   */
  z.object({
    ...logged,
    type: z.literal('files.changed'),
    changeSetId: z.string(),
    toolUseId: z.string().optional(),
    /** "Changed notes.md", "Ran `npm run format`". */
    label: z.string(),
    files: z.array(ChangedFile),
  }),
  /** A change set was undone or redone, from the chat or from Activity. */
  z.object({
    ...logged,
    type: z.literal('files.restored'),
    changeSetId: z.string(),
    direction: z.enum(['undo', 'redo']),
    files: z.array(ChangedFile),
  }),
  /** Something the assistant made to see and use, or a new version of it (ADR 0034). */
  z.object({
    ...logged,
    type: z.literal('artifact'),
    artifactId: z.string(),
    title: z.string(),
    kind: ArtifactKind,
    version: z.number().int().positive(),
    action: z.enum(['created', 'updated']),
    note: z.string().optional(),
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
  /** Passwords needs the person: to unlock it, or to type in a credential (ADR 0025). Later ones with the same id replace it. */
  z.object({ ...logged, type: z.literal('vault.request'), request: VaultRequest }),
  /** A step the agent (or you, while driving) took in this chat's browser tab. */
  z.object({ ...logged, type: z.literal('browser.step'), step: BrowserStep }),
  /** The agent handed the browser to you (sign in, a captcha) — and later, that you handed it back. */
  z.object({ ...logged, type: z.literal('browser.handoff'), handoff: BrowserHandoff }),
  /** The agent created or changed a routine from this chat; rendered as an inline card. */
  /**
   * Offline: the message waits here and goes by itself when the internet is
   * back (or now, with a model on this computer).
   */
  z.object({ ...logged, type: z.literal('turn.held'), reason: z.literal('offline') }),
  /** This turn was answered by another provider than the chat's, and why. */
  z.object({
    ...logged,
    type: z.literal('turn.routed'),
    from: EngineId,
    to: EngineId,
    reason: z.enum(['offline', 'limit']),
    /** One plain sentence: "Claude Code's limit resets at 15:00, so OpenRouter answered." */
    message: z.string(),
  }),
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
  /**
   * The message was clearly about an app in the catalog that isn't connected,
   * so the chat offers to connect it right there. At most once per app per
   * conversation; the assistant was told it can't see the app yet.
   */
  z.object({
    ...logged,
    type: z.literal('integration.suggestion'),
    catalogId: CatalogId,
    name: z.string().min(1).max(80),
    /** What it would let the assistant do: the catalog's one line. */
    description: z.string().max(300),
    /** Brand colour for the logo tile (hex). */
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    /**
     * Connected through another catalog entry (`zapier`), because the provider
     * answering can't reach this app by itself.
     */
    via: CatalogId.optional(),
  }),
  /** “Not now”: the offer is put away for the rest of this conversation. */
  z.object({
    ...logged,
    type: z.literal('integration.suggestion.dismissed'),
    catalogId: CatalogId,
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
  /** This page is in front of someone, or isn't: nothing is pushed while one is (ADR 0027). */
  z.object({ type: z.literal('presence'), visible: z.boolean() }),
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
  /** Passwords changed (an item, a source unlocked or locked): refetch them. */
  z.object({ type: z.literal('vault.changed') }),
  /** Remaining usage changed (a turn finished, a window reset, the provider warned). */
  z.object({ type: z.literal('usage.changed'), usage: UsageSnapshot }),
  /** Terminals were opened, closed or ended somewhere: refetch the list. */
  z.object({ type: z.literal('terminal.changed') }),
  /** The browser started, stopped, is installing (with progress), healed itself or needs you. */
  z.object({ type: z.literal('browser.status'), status: BrowserStatus }),
  /** Conch went offline, or came back. */
  z.object({ type: z.literal('network.status'), network: NetworkStatus }),
  /** Repair everything: the report as it fills in. */
  z.object({ type: z.literal('doctor.report'), report: DoctorReport }),
  /** Updates for Conch and its programs: a check finished, an update moved along. */
  z.object({ type: z.literal('updates.changed'), status: UpdatesStatus }),
  /** A channel was connected, changed, went on- or offline, or someone asked to talk. */
  z.object({ type: z.literal('channel.changed'), channel: Channel }),
  z.object({ type: z.literal('channel.deleted'), channelId: z.string() }),
  /** Conch fixed something on its own: a quiet note, never an alert. */
  z.object({ type: z.literal('healed'), note: HealNote }),
  /** A backup was made, kept or let go, or a restore got ready: refetch the list. */
  z.object({ type: z.literal('backups.changed') }),
  /** Come home is bringing things over (ADR 0035): how far it is. */
  z.object({
    type: z.literal('import.progress'),
    done: z.number().int().min(0),
    total: z.number().int().min(0),
    current: z.string().max(200),
  }),
  /** An artifact changed: a new version, pinned, renamed, removed (ADR 0034). */
  z.object({ type: z.literal('artifact.changed'), artifact: Artifact }),
  z.object({ type: z.literal('artifact.deleted'), artifactId: z.string() }),
  /** Private dictation changed: its speech model arriving, say (ADR 0027). */
  z.object({ type: z.literal('voice.changed'), status: VoiceStatus }),
  /**
   * Devices changed: one signed in, was approved or removed, or asked to be
   * approved (`waiting` counts those). Refetch Settings → Security.
   */
  z.object({ type: z.literal('access.changed'), waiting: z.number().int().min(0) }),
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
