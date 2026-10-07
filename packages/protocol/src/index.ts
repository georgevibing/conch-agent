/**
 * @conch/protocol — every message exchanged between the browser and the gateway.
 *
 * Both sides MUST parse incoming data with these schemas; types are inferred
 * from the schemas so they never drift. REST bodies live in `rest.ts`-style
 * sections below, the live WebSocket stream in `ClientCommand` / `ServerEvent`.
 */
import { z } from 'zod';

import { AddressStatus } from './address';
import { AgentId, AgentList, Tone } from './agents';
import { AppNeed, AppsModel } from './apps';
import { Artifact, ArtifactKind } from './artifacts';
import { ATTACHMENT_LIMITS, Attachment } from './attachments';
import {
  MutedSkill,
  MutedProvider,
  Offer,
  OfferOutcome,
  PlanStep,
  Question,
  QuestionAnswer,
  ReplySuggestion,
  ToolView,
} from './chat-cards';
import { BrowserHandoff, BrowserPermission, BrowserStatus, BrowserStep } from './browser';
import { Channel, ChannelDoor, ChannelOrigin } from './channels';
import { ChatChange, ChatFolder, FolderId } from './chat-list';
import { ChatGoal, MAX_GOAL_LENGTH } from './chat-context';
import { ConchAppOffer, ConchAppShareCard } from './conch-apps';
import { ChannelLink } from './linking';
import {
  EffortChoice,
  EngineId,
  Id,
  PermissionMode,
  TurnOptions,
  TurnPause,
  TurnProblem,
  ContextFill,
  Usage,
} from './common';
import { DoctorReport } from './doctor';
import { Memory, MemoryKind } from './memory';
import { MAX_PROFILE_FACTS, ProfileAvatar, ProfileFact } from './profile';
import { PastChatsLooked } from './past-chats';
import { LearnedItem } from './quiet-learning';
import { EngineStatus, LoginState } from './engine';
import { HealNote } from './healed';
import { CatalogId, Integration } from './integrations';
import { Routine, RoutineRun, RoutineSpending } from './routines';
import { VaultPermission, VaultRequest } from './vault';
import { VoiceStatus } from './phone';
import { ConchVoiceId } from './speech';
import { ChangedFile } from './undo';
import { SkillPermissions } from './skills';
import { Task, TaskKind, TaskStatus } from './tasks';
import { UpdatesStatus } from './updates';
import { UsageSnapshot } from './usage';
import { CappedOutcome, ChatSpend, SpendLimitKind, SpendModel, TurnCost } from './spend';

export * from './access';
export * from './agents';
export * from './profile';
export * from './address';
export * from './apps';
export * from './artifacts';
export * from './chat-cards';
export * from './chat-list';
export * from './chat-context';
export * from './commands';
export * from './conch-apps';
export * from './conch-apps-words';
export * from './questions';
export * from './attachments';
export * from './background';
export * from './backups';
export * from './browser';
export * from './channels';
export * from './speech';
export * from './engine';
export * from './first-job';
export * from './healed';
export * from './import';
export * from './integrations';
export * from './learning';
export * from './quiet-learning';
export * from './linking';
export * from './local';
export * from './computer';
export * from './memory';
export * from './mcp';
export * from './common';
export * from './modes';
export * from './desktop';
export * from './doctor';
export * from './phone';
export * from './providers';
export * from './routines';
export * from './triggers';
export * from './safety';
export * from './search';
export * from './fuzzy';
export * from './past-chats';
export * from './setup';
export * from './skills';
export * from './skill-market';
export * from './holds';
export * from './tasks';
export * from './terminal';
export * from './undo';
export * from './updates';
export * from './usage';
export * from './spend';
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

/**
 * The default agent's personality (ADR 0101), as Settings and setup knew it
 * before there were agents. Still read and written: `PATCH /api/settings`
 * `persona` changes the default agent, and the gateway keeps this in step, so
 * a Conch from before agents reads the right name if you go back.
 */
export const Persona = z.object({
  /** What the agent calls itself. */
  name: z.string().trim().min(1).max(40).default('Conch'),
  tone: Tone.default('warm'),
  /** Free-form extra guidance ("Always answer in British English"). */
  instructions: z.string().max(8000).default(''),
});
export type Persona = z.infer<typeof Persona>;

export const Profile = z.object({
  /** How the agent should address the user. */
  name: z.string().trim().max(80).default(''),
  /** A few lines about the user, always in context: in their own words. */
  about: z.string().max(4000).default(''),
  /** Who they are in cards: work, home, people, interests, how they like things. */
  facts: z.array(ProfileFact).max(MAX_PROFILE_FACTS).default([]),
  /** A photo of theirs, set only through `PUT /api/profile/avatar`. */
  avatar: ProfileAvatar.optional(),
});
export type Profile = z.infer<typeof Profile>;

/** Catalog ids, and skills as `skill:<id>` (ADR 0060), each once. */
const MutedSuggestions = z
  .array(z.union([CatalogId, MutedSkill, MutedProvider]))
  .max(100)
  .transform((ids) => [...new Set(ids)]);

/**
 * How much one turn may do while someone is watching before it pauses to check
 * in (ADR 0085). Off unless a person turns it on: a turn then runs until it's
 * done, and only a loop (the same thing again and again) pauses it. Routines and
 * tasks have their own limits and aren't affected.
 */
export const TurnLimits = z.object({
  on: z.boolean().default(false),
  /** Rounds of tool calls. */
  steps: z.number().int().min(5).max(10_000).default(100),
  /** Fresh tokens: input not read from the provider's cache, plus output. */
  tokens: z.number().int().min(50_000).max(1_000_000_000).default(2_000_000),
  /** Wall-clock minutes for the whole turn. */
  minutes: z.number().int().min(1).max(1_440).default(30),
});
export type TurnLimits = z.infer<typeof TurnLimits>;

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
  /**
   * A memory that looks planted (ADR 0087) is held and asked about, not saved.
   * Off: only passwords, keys and hidden characters are still held.
   */
  checkMemories: z.boolean().default(true),
  /** Conch in the menu bar, tray or panel, whenever it runs (ADR 0029). */
  menuBar: z.boolean().default(true),
  /** A Mac on mains power stays awake while Conch runs in the background (ADR 0029). */
  keepAwake: z.boolean().default(false),
  /** Tidy memory every night, while nothing's running (ADR 0032). Every change can be undone. */
  tidyMemory: z.boolean().default(false),
  /**
   * The voice a voice note from a chat app is answered with (ADR 0077): one of
   * Conch's, chosen in Settings → Voice. Unset: the first natural voice here.
   */
  voice: ConchVoiceId.optional(),
  /** Pause a long turn to check in: off by default, a power user's choice (Settings → Usage). */
  turnLimits: TurnLimits.default(TurnLimits.parse({})),
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

export const CreateMemoryBody = z.object({
  content: z.string().trim().min(1).max(2000),
  kind: MemoryKind.default('fact'),
});
export const UpdateMemoryBody = z.object({
  content: z.string().trim().min(1).max(2000).optional(),
  kind: MemoryKind.optional(),
  /** Without new words: the words you saw (ADR 0087), so your answer is about them. */
  seen: z.string().min(1).max(2000).optional(),
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
    .object({
      name: z.string().trim().max(80),
      about: z.string().max(4000),
      facts: z.array(ProfileFact).max(MAX_PROFILE_FACTS),
    })
    .partial()
    .optional(),
  preferences: z
    .object({
      workspace: z.string().max(4096),
      engine: EngineId,
      autoMemory: z.boolean(),
      autoTitle: z.boolean(),
      /** `null` goes back to the provider's own default. */
      model: z.string().max(200).nullable(),
      effort: EffortChoice,
      fastMode: z.boolean(),
      permissionMode: PermissionMode,
      offlineFallback: z.boolean(),
      /** `null` goes back to waiting for the limit to reset. */
      limitFallback: EngineId.nullable(),
      mutedSuggestions: MutedSuggestions,
      /** Turning any of these off needs a recent password or key (ADR 0028, ADR 0087). */
      checkAfterReading: z.boolean(),
      sealedCommands: z.boolean(),
      checkMemories: z.boolean(),
      menuBar: z.boolean(),
      keepAwake: z.boolean(),
      tidyMemory: z.boolean(),
      /** `null` goes back to the first natural voice here. */
      voice: ConchVoiceId.nullable(),
      turnLimits: TurnLimits,
    })
    .partial()
    .optional(),
  onboarded: z.boolean().optional(),
});
export type UpdateSettingsBody = z.infer<typeof UpdateSettingsBody>;

/** Send a message that's waiting for the internet now — optionally with another provider. */
/**
 * Send a waiting message now: with `engine` (the model on this computer, while
 * offline), or switched to `model` of `engine` (one that can use the apps the
 * message needs, ADR 0050) — which the chat then keeps.
 */
export const ReleaseTurnBody = z
  .object({ engine: EngineId.optional(), model: z.string().min(1).max(200).optional() })
  .strict()
  .refine((body) => !body.model || body.engine, { message: 'A model needs its provider.' });
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
      /**
       * A task running in the background (ADR 0033). `standalone`: sent from no
       * chat (another app, the first job), so it's a chat of its own in the list.
       */
      z.object({
        kind: z.literal('task'),
        taskId: z.string(),
        standalone: z.literal(true).optional(),
      }),
      /** What another app did through Conch (ADR 0073): Claude Desktop, Cursor… */
      z.object({ kind: z.literal('client'), clientId: z.string(), name: z.string().max(60) }),
    ])
    .optional(),
  /**
   * When you archived it: out of the chat list, still searchable. Writing in
   * it, or it needing you, puts it back.
   */
  archivedAt: z.number().optional(),
  /** Pinned to the top of the list (ADR 0089): its place there, smallest first. */
  pinned: z.number().optional(),
  /** The folder it's filed in (ADR 0089). */
  folderId: FolderId.optional(),
  /**
   * When you last had it open, on any device. Anything after is new to you
   * (`isUnread`); absent for chats from before Conch kept track.
   */
  seenAt: z.number().optional(),
  /** What it has spent, its tasks included, and its own limit (ADR 0079). */
  spend: ChatSpend.optional(),
  /**
   * The agent answering it (ADR 0101). Absent in chats from before agents:
   * they're with the first agent while it exists (`chatAgentId`).
   */
  agentId: AgentId.optional(),
});
export type ConversationSummary = z.infer<typeof ConversationSummary>;

/**
 * Rename a conversation, archive it or put it back, pin it, file it, or say
 * you've seen it — at least one of them.
 */
export const UpdateConversationBody = ChatChange.extend({
  title: z.string().trim().min(1).max(120).optional(),
  /** You have it open: nothing in it is new any more. */
  seen: z.literal(true).optional(),
  /** Another agent answers from the next message on (ADR 0101); the chat shows where. */
  agentId: AgentId.optional(),
})
  .strict()
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'Nothing to change.',
  });
export type UpdateConversationBody = z.infer<typeof UpdateConversationBody>;

/** `/compact [focus]`: summarise the start of a chat now (ADR 0055). */
export const CompactBody = z
  .object({
    /** What the summary should keep above all, in the person's words. */
    focus: z.string().trim().max(500).optional(),
  })
  .strict();
export type CompactBody = z.infer<typeof CompactBody>;

export const CompactResult = z.object({
  /** Whether anything was summarised (a short chat has nothing to fold). */
  compacted: z.boolean(),
  /** One sentence to show: what happened, or why nothing did. */
  message: z.string(),
});
export type CompactResult = z.infer<typeof CompactResult>;

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
    /** What it found, drawn as it is (an agenda, emails, files): ADR 0060. */
    view: ToolView.optional(),
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
     * Asked because the chat read something untrusted, or for another reason
     * that holds in every mode (ADR 0028): why, in a sentence.
     */
    taint: z.string().optional(),
    /**
     * Asked for a reason "Always allow" can lift for the rest of the chat
     * (what it read, or leaving the sealed box). Without it, a `taint`
     * question is this once.
     */
    lasting: z.boolean().optional(),
    /** The same, as the first version of this field said it (2026-10-04). */
    afterReading: z.boolean().optional(),
    /** Shows exactly what goes to other people, so it's asked each time: no "Always allow". */
    once: z.boolean().optional(),
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
    /** The whole memory as it was, so Undo puts it back exactly. */
    memory: Memory.optional(),
  }),
  /**
   * You kept a memory this chat learned, or undid it (from the chat or the
   * Memory page); `kept` on one it forgot means you put it back.
   */
  z.object({
    ...logged,
    type: z.literal('memory.decided'),
    memoryId: z.string(),
    kept: z.boolean(),
    /** What it said, so Activity can name it (ADR 0087). */
    content: z.string().optional(),
    /** You changed its words before keeping it. */
    edited: z.boolean().optional(),
    /** Kept although the check refused it (a secret, hidden characters): your explicit override. */
    anyway: z.boolean().optional(),
  }),
  /**
   * Conch learned from this chat once it went quiet (ADR 0088): one quiet
   * line at its end, with Undo, Why? and, for what waits, Keep and Forget.
   */
  z.object({
    ...logged,
    type: z.literal('learning.noted'),
    reviewId: z.string(),
    items: z.array(LearnedItem).min(1).max(5),
  }),
  /**
   * You undid, kept or put away something this chat learned (from the chat or
   * the Memory page); `gone`: you forgot what it learned some other way since.
   */
  z.object({
    ...logged,
    type: z.literal('learning.decided'),
    entryId: z.string(),
    state: z.enum(['undone', 'kept', 'dismissed', 'gone']),
  }),
  /** The chat read something from outside: from here on, sending and changing ask first (ADR 0028). */
  z.object({
    ...logged,
    type: z.literal('taint'),
    source: TaintSource,
    /** The tool call that brought it in, when one did. */
    toolUseId: z.string().optional(),
  }),
  /** The assistant looked through your other chats (ADR 0059): for what, and where it found it. */
  z.object({ ...logged, type: z.literal('chats.looked'), ...PastChatsLooked.shape }),
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
    /** `edited`: you changed it by hand (ADR 0046). */
    action: z.enum(['created', 'updated', 'edited']),
    note: z.string().optional(),
  }),
  /**
   * A task sent away from this chat (ADR 0033): where it stands, appended
   * again each time that changes (the card shows the latest).
   */
  z.object({
    ...logged,
    type: z.literal('task'),
    taskId: z.string(),
    title: z.string(),
    kind: TaskKind,
    state: TaskStatus,
    summary: z.string().optional(),
    /** Another provider is doing it, by name (`Task.by`). */
    by: z.string().max(80).optional(),
  }),
  z.object({ ...logged, type: z.literal('status'), status: ConversationStatus }),
  /**
   * What the running turn has used so far, and how full the context is, as it goes: a live
   * reading for the chat to show, never kept in the chat's history (`turn.completed` keeps
   * the last word).
   */
  z.object({
    ...logged,
    type: z.literal('turn.usage'),
    usage: Usage,
    context: ContextFill.optional(),
  }),
  z.object({
    ...logged,
    type: z.literal('turn.completed'),
    outcome: z.enum(['success', 'interrupted', 'error']),
    usage: Usage.optional(),
    error: z.string().optional(),
    /** Why it failed, when Conch can tell (see `TurnProblem`). */
    problem: TurnProblem.optional(),
    /** It stopped to check in, not because it was done (ADR 0085): the chat offers Carry on. */
    paused: TurnPause.optional(),
    /**
     * Why it ended when you didn't say so: Conch itself restarted mid-turn (an update, a crash,
     * the machine running out of memory). `resumed`: it picks the work up again by itself.
     */
    restarted: z.object({ resumed: z.boolean() }).optional(),
    /** Which provider answered, and with which model when it said. */
    engine: EngineId.optional(),
    model: z.string().optional(),
    /** What it cost, the way its provider charges (ADR 0079). */
    cost: TurnCost.optional(),
    /** How full the context was when it ended, for the composer's meter. */
    context: ContextFill.optional(),
  }),
  z.object({ ...logged, type: z.literal('title'), title: z.string() }),
  /**
   * A message met a spending limit (ADR 0079): the chat's own, or the monthly
   * budget. It waits for one tap: raise the limit, carry on with a model that
   * costs less, or stop. `during`: a reply was stopped part way, and carries
   * on from there.
   */
  z.object({
    ...logged,
    type: z.literal('turn.capped'),
    limit: SpendLimitKind,
    /** Spent so far: this chat's, or this month's (USD). */
    spentUsd: z.number().nonnegative(),
    limitUsd: z.number().positive(),
    /** What "Raise it" sets the limit to (USD). */
    raiseTo: z.number().positive(),
    switchTo: SpendModel.optional(),
    during: z.boolean().optional(),
  }),
  /** The person chose how a message at a limit goes on. */
  z.object({ ...logged, type: z.literal('turn.capped.settled'), outcome: CappedOutcome }),
  /**
   * A quiet word about money, said once when it matters (ADR 0079):
   * `budget-near`, the month is most of the way to its budget; `pricier`, the
   * model just picked costs a lot more a reply on a chat this long; `stopped`,
   * a task stopped at the limit of the chat it came from.
   */
  z.object({
    ...logged,
    type: z.literal('spend.notice'),
    kind: z.enum(['budget-near', 'pricier', 'stopped']),
    message: z.string().max(400),
  }),
  /**
   * A skill was used in this turn — asked for by name, or picked by the
   * assistant — or came with work from another chat. From here on the chat is
   * held to its list until you say otherwise (ADR 0047).
   */
  z.object({
    ...logged,
    type: z.literal('skill.used'),
    skillId: z.string(),
    name: z.string(),
    title: z.string(),
    /**
     * `user`: you asked for it (`/name`); `assistant`: it matched the request;
     * `carried`: a task brought it from the chat it came from, or a helper back (ADR 0033).
     */
    by: z.enum(['user', 'assistant', 'carried']),
    /** What it may do, as it was when its instructions came into the chat. */
    permissions: SkillPermissions.optional(),
    /** For `carried`: the chat it came from. */
    from: z.string().optional(),
  }),
  /** You stopped holding the chat to a skill's list (ADR 0047). Only a person does this. */
  z.object({
    ...logged,
    type: z.literal('skill.hold.ended'),
    skillId: z.string(),
    title: z.string(),
    reason: z.enum(['you']),
  }),
  z.object({
    ...logged,
    type: z.literal('notice'),
    /** e.g. `retry` while the engine retries a failing request. */
    code: z.string(),
    message: z.string(),
  }),
  z.object({ ...logged, type: z.literal('options'), options: TurnOptions }),
  /**
   * Another agent answers from here on (ADR 0101): a divider in the chat. Its
   * name as it was then, so the chat still reads right once it's renamed or
   * gone. `from`: who answered before, on the first one, since a chat's log
   * from before says nobody.
   */
  z.object({
    ...logged,
    type: z.literal('agent'),
    agentId: AgentId,
    name: z.string().max(40),
    from: z.object({ agentId: AgentId, name: z.string().max(40) }).optional(),
  }),
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
  /**
   * The chat's model can't use what this message needs (an app, a skill's
   * tools — ADR 0050): it waits for a choice. Switch to `switchTo` and it goes
   * by itself; or it's answered without.
   */
  z.object({
    ...logged,
    type: z.literal('turn.needs-apps'),
    needs: z.array(AppNeed).min(1).max(5),
    /** The model that can't. */
    model: z.object({ engine: EngineId, id: z.string(), label: z.string() }),
    /** The best model you already set up that can; absent when there's none. */
    switchTo: AppsModel.optional(),
  }),
  /**
   * A long chat no longer fits what the model reads at once, so the start of
   * it was folded into a summary (ADR 0055). From `before` (a message's id)
   * on, the model reads the chat word for word; before it, only `summary`.
   * The latest one is the one that counts. The person keeps every message.
   */
  z.object({
    ...logged,
    type: z.literal('context.compacted'),
    /** What the model keeps from the earlier messages. Empty when none could be written. */
    summary: z.string().max(40_000),
    /** The first message the model still reads in full. */
    before: z.string().optional(),
    engine: EngineId,
    /** The model's name, as the picker shows it. */
    model: z.string().optional(),
    /** How many earlier turns the summary stands for, in all. */
    turns: z.number().int().nonnegative(),
    /** You asked for it (`/compact`), rather than the chat growing past the window. */
    asked: z.boolean().optional(),
  }),
  /**
   * `/clear`: from here on, the model reads nothing said before. Every message
   * is still there for the person, every provider starts afresh, and the
   * chat's goal stays. A later `context.restored` takes it back.
   */
  z.object({ ...logged, type: z.literal('context.cleared') }),
  /** Undo on a `/clear`, before anything new was sent: the model remembers again. */
  z.object({
    ...logged,
    type: z.literal('context.restored'),
    /** The `context.cleared` this takes back. */
    clearedSeq: z.number().int().nonnegative(),
  }),
  /**
   * The chat's goal (`/goal`): kept in every turn's context, whichever provider
   * answers, until it changes. `null`: it was taken away.
   */
  z.object({
    ...logged,
    type: z.literal('goal'),
    goal: z.string().max(MAX_GOAL_LENGTH).nullable(),
  }),
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
  }),
  /** “Not now”: the offer is put away for the rest of this conversation. */
  z.object({
    ...logged,
    type: z.literal('integration.suggestion.dismissed'),
    catalogId: CatalogId,
  }),
  /**
   * An offer to turn on what this request is missing, an app or a skill
   * (ADR 0060). Replaces `integration.suggestion`, which older logs still hold.
   */
  z.object({ ...logged, type: z.literal('offer'), offer: Offer }),
  /** The offer was taken (and the chat carries on), put away, or overtaken. */
  z.object({
    ...logged,
    type: z.literal('offer.resolved'),
    offerId: z.string(),
    outcome: OfferOutcome,
  }),
  /**
   * The assistant asks something with answers to tap; the reply waits for it
   * (the chat's status is `awaiting-permission`: waiting for you).
   */
  z.object({ ...logged, type: z.literal('question'), question: Question }),
  /** Answered, or `null`: skipped, or the reply was stopped first. */
  z.object({
    ...logged,
    type: z.literal('question.answered'),
    questionId: z.string(),
    answer: QuestionAnswer.nullable(),
  }),
  /**
   * What the person might say next, under the latest reply. From the
   * assistant, or from Conch itself (“Show it as a chart” under a table).
   */
  z.object({
    ...logged,
    type: z.literal('replies'),
    replies: z.array(ReplySuggestion).min(1).max(3),
    by: z.enum(['assistant', 'conch']),
  }),
  /**
   * An app the assistant made, or found at a link, offered to add (ADR 0061).
   * A later event with the same `offerId` replaces it: added, updated, stale.
   */
  z.object({ ...logged, type: z.literal('conch-app.offer'), offer: ConchAppOffer }),
  /** "Put it on GitHub": the share buttons, pressed by the person (ADR 0061). */
  z.object({ ...logged, type: z.literal('conch-app.share'), share: ConchAppShareCard }),
  /** The assistant's plan for this reply, as it stands now; a later one replaces it. */
  z.object({
    ...logged,
    type: z.literal('plan'),
    steps: z.array(PlanStep).min(1).max(30),
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
      /**
       * A new chat starts in this folder of the chat list (ADR 0089): started
       * from the folder itself. Ignored when sending to a chat that exists, and
       * when the folder has gone meanwhile (the chat then starts in the list).
       */
      folder: FolderId.optional(),
      /**
       * Steer: stop the reply that's running, then send this, as one step, so
       * nothing lands in between. The same with every provider.
       */
      steer: z.boolean().optional(),
      /** A goal for the chat (`/goal` before its first message), kept from this message on. */
      goal: ChatGoal.optional(),
      /**
       * A new chat is with this agent (ADR 0101); unset, the default. Ignored when
       * sending to a chat that exists (change it with `PATCH /api/conversations/:id`).
       */
      agentId: AgentId.optional(),
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
  /** The folders in the chat list, all of them, after any change (ADR 0089). */
  z.object({ type: z.literal('folders.changed'), folders: z.array(ChatFolder) }),
  /** The agents, all of them, after any change: one added, changed, reordered, a new default (ADR 0101). */
  z.object({ type: z.literal('agents.changed'), list: AgentList }),
  z.object({ type: z.literal('conversation.event'), event: ConversationEvent }),
  /**
   * The log this tab has seen doesn't match the gateway's (it restarted and lost the end of a
   * turn): forget the view; the whole log follows.
   */
  z.object({ type: z.literal('conversation.reset'), conversationId: z.string() }),
  /**
   * Everything a `conversation.subscribe` asked for has been sent: the tab can draw the chat
   * whole, at once, instead of event by event as they came.
   */
  z.object({ type: z.literal('conversation.synced'), conversationId: z.string() }),
  z.object({ type: z.literal('engine.status'), status: EngineStatus }),
  z.object({ type: z.literal('engine.login'), login: LoginState }),
  z.object({ type: z.literal('memory.changed') }),
  /** Something was learned, kept or undone, or what learning may spend changed (ADR 0088). */
  z.object({ type: z.literal('learning.changed') }),
  z.object({ type: z.literal('routine.changed'), routine: Routine }),
  z.object({ type: z.literal('routine.deleted'), routineId: z.string() }),
  z.object({ type: z.literal('routine.run'), run: RoutineRun }),
  /** What routines spent this month changed, or they paused at its limit (ADR 0057). */
  z.object({ type: z.literal('routines.spending'), spending: RoutineSpending }),
  z.object({ type: z.literal('integration.changed'), integration: Integration }),
  z.object({ type: z.literal('integration.deleted'), integrationId: z.string() }),
  /** A skill was added, changed or removed (here, or in one of the folders Conch reads). */
  z.object({ type: z.literal('skills.changed') }),
  /** Work that went well in this chat could be a skill (ADR 0058): refetch what's offered. */
  z.object({ type: z.literal('skills.offered'), conversationId: z.string() }),
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
  /** Linking WhatsApp or Signal by QR code: a new code, scanned, linked (ADR 0043). */
  z.object({ type: z.literal('channel.link'), link: ChannelLink }),
  /** The public door (Teams, WeChat) turned on or off, or stopped working (ADR 0045). */
  z.object({ type: z.literal('channel.door'), door: ChannelDoor }),
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
  /** Apps you made or added changed: one added, updated, removed, or an update found (ADR 0061). */
  z.object({ type: z.literal('conch-apps.changed') }),
  /** An artifact changed: a new version, pinned, renamed, removed (ADR 0034). */
  z.object({ type: z.literal('artifact.changed'), artifact: Artifact }),
  z.object({ type: z.literal('artifact.deleted'), artifactId: z.string() }),
  /** A task changed (ADR 0033). */
  z.object({ type: z.literal('task.changed'), task: Task }),
  z.object({ type: z.literal('task.deleted'), taskId: z.string() }),
  /** Private dictation changed: its speech model arriving, say (ADR 0027). */
  z.object({ type: z.literal('voice.changed'), status: VoiceStatus }),
  /** "Stop listening for Hey Conch" was pressed in the tray (ADR 0078): the window stops. */
  z.object({ type: z.literal('wake.stop') }),
  /**
   * Devices changed: one signed in, was approved or removed, or asked to be
   * approved (`waiting` counts those). Refetch Settings → Security.
   */
  z.object({ type: z.literal('access.changed'), waiting: z.number().int().min(0) }),
  /** Your own address changed: checking, a certificate, ready, or a problem (ADR 0064). */
  z.object({ type: z.literal('address.changed'), address: AddressStatus }),
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

export * from './google';
export * from './slack';
export * from './app-tools';

export * from './task-assessment';
