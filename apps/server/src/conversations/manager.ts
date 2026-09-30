import type {
  Attachment,
  BrowserPermission,
  ConversationEvent,
  ConversationEventInput,
  ConversationStatus,
  ConversationSummary,
  EngineId,
  Preferences,
  ServerEvent,
  TurnOptions,
  TurnProblem,
  Usage,
} from '@conch/protocol';

import { honouredMode, type PermissionMode } from '@conch/protocol';

import type {
  BridgedTool,
  Engine,
  EngineMcpServer,
  HostTool,
  PermissionDecision,
  ResolvedOptions,
} from '../engines/types';
import { forTurn as attachmentsForTurn } from '../attachments/prompt';
import type { AttachmentStore } from '../attachments/store';
import { Emitter } from '../lib/emitter';
import { newId } from '../lib/ids';
import { buildSystemAppend } from '../memory/prompt';
import type { MemoryStore } from '../memory/store';
import { memoryTools } from '../memory/tools';
import type { SettingsStore } from '../settings/store';
import { handoff } from './handoff';
import type { ConversationRecord, ConversationStore } from './store';
import { summarizeToolUse, titleFrom } from './summarize';
import { generateTitle } from './title';

/**
 * Why a turn failed, for engines that don't say: the key's in a locked
 * 1Password, the provider signed out (asked again now — its answer is cached),
 * or the words of the error.
 */
export async function turnProblem(
  engine: Pick<Engine, 'detect'>,
  error: string | undefined,
): Promise<TurnProblem | undefined> {
  const text = error ?? '';
  if (/1Password (is locked|didn’t answer)/i.test(text)) return 'key-locked';
  const status = await engine.detect({ force: true }).catch(() => undefined);
  if (status?.state === 'signed-out') return 'signed-out';
  if (
    /signed out|credentials expired|not logged in|\b401\b|unauthori[sz]ed|invalid api key/i.test(
      text,
    )
  )
    return 'signed-out';
  if (/usage limit|rate.?limit|\b429\b|quota|too many requests/i.test(text)) return 'limit';
  if (
    /overloaded|\b50[0-9]\b|unavailable|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|timed? ?out|isn’t responding/i.test(
      text,
    )
  )
    return 'unavailable';
  if (status && status.state !== 'ready') return 'unavailable';
  return undefined;
}

interface PendingPermission {
  resolve: (decision: PermissionDecision) => void;
  toolName: string;
  /** "Always allow" adds the tool to the conversation's list. Off when the asker keeps its own (the browser: per site). */
  remember: boolean;
}

/** A question a host tool puts to the user, through the same prompt as any permission. */
export interface AskRequest {
  toolName: string;
  input: Record<string, unknown>;
  /** One line, e.g. "use booking.com". */
  summary: string;
  browser?: BrowserPermission;
}

/** Per-turn additions used by routines (and future automations). */
export interface TurnExtras {
  /** Appended after the usual personality/memory prompt. */
  systemExtra?: string;
  tools?: HostTool[];
  /** Overrides the conversation's permission mode for this turn. */
  permissionMode?: PermissionMode;
  onStatus?: (status: ConversationStatus) => void;
}

export interface TurnResult {
  outcome: 'success' | 'interrupted' | 'error';
  usage?: Usage;
  error?: string;
  /** Text of the last assistant message in the turn. */
  finalText: string;
}

/** An integration that isn't working, as a conversation shows it. */
export interface IntegrationIssueInput {
  integrationId: string;
  name: string;
  catalogId?: string;
  state: 'needs-auth' | 'error';
  message: string;
}

/** An app the chat offers to connect, as a conversation shows it. */
export interface IntegrationSuggestionInput {
  catalogId: string;
  name: string;
  description: string;
  color?: string;
  via?: string;
}

/**
 * For a turn about apps that aren't connected: the assistant can't see them
 * and must not act as if it could. When the chat just offered to connect them,
 * it says so, so the reply doesn't explain how. Short, and the same for every
 * provider.
 */
export function notConnectedPrompt(
  unseen: readonly string[],
  offered: readonly string[] = [],
): string {
  if (!unseen.length) return '';
  const names = unseen.join(' and ');
  const one = unseen.length === 1;
  return [
    '## Not connected yet',
    `${names} ${one ? 'isn’t' : 'aren’t'} connected, so you can’t see anything in ${one ? 'it' : 'them'}.${
      offered.length
        ? ` Conch has just shown the user a button in the chat to connect ${offered.join(' and ')}.`
        : ''
    }`,
    `Don’t pretend to have ${names} data, and don’t guess at it. Answer what you can without it, then say that once ${names} ${one ? 'is' : 'are'} connected you’ll be able to help with that part. ${
      offered.length
        ? 'Don’t explain how to connect it: the button does that.'
        : 'They can connect it from Integrations in the sidebar.'
    }`,
  ].join('\n');
}

/** Integrations (MCP servers the user connected in Conch), as turns see them. */
export interface TurnIntegrationsProvider {
  /**
   * Catalog apps the person's words are clearly about that aren't connected
   * (connect-from-chat), leaving out the ids in `skip`.
   */
  suggest?(
    text: string,
    engine: Engine,
    skip: ReadonlySet<string>,
  ): Promise<{ offers: IntegrationSuggestionInput[]; unseen: string[] }>;
  forTurn(prompt: string): Promise<{
    servers: Record<string, EngineMcpServer>;
    disallowedTools: string[];
    issues: IntegrationIssueInput[];
  }>;
  turnFailed(failed: { name: string; error: string }[]): Promise<IntegrationIssueInput[]>;
  /** For engines without MCP of their own: Conch connects and hands over the tools. */
  bridge(
    servers: Record<string, EngineMcpServer>,
    disallowedTools: string[],
  ): Promise<{
    tools: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      call(args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
    }[];
    failed: { name: string; error: string }[];
    close(): Promise<void>;
  }>;
  /** `undefined` for tools that don't belong to an integration. */
  decide(toolName: string): Promise<'allow' | 'ask' | 'off' | undefined>;
  describeTool(toolName: string): Promise<{ integration: string; tool: string } | undefined>;
  markUsed(toolName: string): Promise<void>;
}

/** What a tool provider knows about the turn its tools run in. */
export interface ToolContext {
  conversationId: string;
  /** Add an event to the conversation's log (e.g. an inline routine card). */
  append: (event: ConversationEventInput) => void;
  /** The provider answering this turn. */
  engine: Engine;
  /** How much the agent may do without asking, for this turn. */
  permissionMode: PermissionMode;
  /** Ask the user (a permission prompt in the chat). Resolves `deny` if the turn stops first. */
  ask: (request: AskRequest) => Promise<PermissionDecision>;
  /** Aborts when the turn is stopped or ends. */
  signal: AbortSignal;
}

/** Tools every conversation gets from other parts of Conch (e.g. routines, skills, the browser). */
export type ToolProvider = (ctx: ToolContext) => HostTool[];

/**
 * Turns a message that asks for something by name (`/weekly-review …`) into
 * the prompt the provider gets. The message itself is logged as typed.
 */
export type MessageExpander = (
  text: string,
  engine: Engine,
) => Promise<
  { prompt: string; skill?: { skillId: string; name: string; title: string } } | undefined
>;

interface Live {
  record: ConversationRecord;
  extras?: TurnExtras;
  events: ConversationEvent[];
  seq: number;
  abort?: AbortController;
  permissions: Map<string, PendingPermission>;
  /** Tools the user said "always allow" for, in this conversation. */
  alwaysAllow: Set<string>;
  /** Cancels an in-flight title (e.g. the user renamed it first). */
  titling?: AbortController;
}

export class ConversationError extends Error {
  constructor(
    readonly code: 'not-found' | 'busy' | 'engine-unavailable',
    message: string,
  ) {
    super(message);
  }
}

/** Host tools are shown through memory events, not as tool calls. */
const isHostTool = (name: string) => name.startsWith('mcp__conch__');

/** Conversations kept in memory at once (idle ones beyond this are dropped). */
const MAX_LIVE = 50;

/** How long an unattended run (a routine) waits for a permission answer. */
const UNATTENDED_PERMISSION_MS = 60 * 60 * 1000;

/**
 * How long a turn waits to learn which modes its provider honours. The answer
 * is almost always cached; past this, the engine's own cautious reading holds.
 */
const MODES_WAIT_MS = 2000;

/** The modes an engine honours, or undefined if it can't say quickly. */
async function honouredModes(engine: Engine): Promise<PermissionMode[] | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), MODES_WAIT_MS);
    timer.unref?.();
  });
  try {
    const capabilities = await Promise.race([engine.capabilities().catch(() => undefined), late]);
    return capabilities?.permissionModes;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Owns every conversation's live state: the event log, the running turn, and
 * pending permission prompts. Everything observable goes out through `events`.
 */
export class ConversationManager {
  readonly events = new Emitter<ServerEvent>();
  #live = new Map<string, Live>();

  constructor(
    private readonly deps: {
      store: ConversationStore;
      settings: SettingsStore;
      memory: MemoryStore;
      /** The provider for a turn: the one a conversation chose, else the default. */
      engine: (id?: EngineId) => Engine;
      tools?: ToolProvider;
      /** Extra system-prompt context for every turn (e.g. the user's routines and skills). */
      context?: (engine: Engine) => Promise<string>;
      expand?: MessageExpander;
      /** Money spent outside a turn (naming a chat), for the usage ledger. */
      onSpend?: (usage: Usage) => void;
      integrations?: TurnIntegrationsProvider;
      /** Where uploaded files and long pastes are kept (ADR 0017). */
      attachments?: AttachmentStore;
    },
  ) {}

  async list(): Promise<ConversationSummary[]> {
    const records = await this.deps.store.list();
    return records.map((r) => summary(this.#live.get(r.id)?.record ?? r));
  }

  async detail(id: string) {
    const live = await this.#get(id);
    return { conversation: summary(live.record), events: live.events };
  }

  async rename(id: string, title: string) {
    const live = await this.#get(id);
    // The user's own title always wins over one still being written.
    live.titling?.abort();
    live.titling = undefined;
    live.record = { ...live.record, title, titling: undefined };
    await this.deps.store.upsert(live.record);
    this.#append(live, { type: 'title', title });
    this.events.emit({ type: 'conversation.updated', conversation: summary(live.record) });
  }

  async remove(id: string) {
    const live = this.#live.get(id);
    live?.abort?.abort();
    live?.titling?.abort();
    this.#live.delete(id);
    // What was attached here goes too, unless another conversation sent it as well.
    const events = live?.events ?? (await this.deps.store.events(id).catch(() => []));
    const attached = events.flatMap((e) =>
      e.type === 'user.message' ? (e.attachments ?? []).map((a) => a.id) : [],
    );
    await this.deps.store.remove(id);
    if (attached.length) await this.deps.attachments?.forget(id, attached).catch(() => undefined);
    this.events.emit({ type: 'conversation.deleted', conversationId: id });
  }

  async eventsAfter(id: string, afterSeq = -1): Promise<ConversationEvent[]> {
    const live = await this.#get(id);
    return live.events.filter((e) => e.seq > afterSeq);
  }

  /** Send a user message, creating the conversation if needed. Returns immediately; the turn streams. */
  async send(input: {
    conversationId?: string;
    clientMessageId: string;
    text: string;
    /** Ids of uploaded attachments, in order. */
    attachments?: readonly string[];
    options?: TurnOptions;
  }) {
    const existing = input.conversationId ? await this.#get(input.conversationId) : undefined;
    if (existing?.abort)
      throw new ConversationError('busy', 'Still replying to your last message.');
    // Whichever provider the conversation (or this message) chose answers.
    const engine = this.deps.engine(input.options?.engine ?? existing?.record.options.engine);
    const status = await engine.detect();
    if (status.state !== 'ready') {
      throw new ConversationError(
        'engine-unavailable',
        status.state === 'not-installed'
          ? `${engine.label} isn't installed yet.`
          : status.state === 'signed-out'
            ? `${engine.label} is signed out.`
            : (status.message ?? `${engine.label} is unavailable.`),
      );
    }
    const expanded = input.text
      ? await this.deps.expand?.(input.text, engine).catch(() => undefined)
      : undefined;
    // Claimed before anything is created, so a missing file never leaves an empty chat behind.
    const id = existing?.record.id ?? newId('c');
    const attachments = input.attachments?.length
      ? ((await this.deps.attachments?.claim(input.attachments, id)) ?? [])
      : [];
    // A message that's only attachments is titled and previewed after the first of them.
    const said = input.text || attachments.map((a) => a.name).join(', ');

    let live: Live;
    let autoTitle = false;
    if (existing) {
      live = existing;
      if (input.options) this.#applyOptions(live, input.options);
    } else {
      const now = Date.now();
      const { preferences } = await this.deps.settings.get();
      autoTitle = preferences.autoTitle && Boolean(engine.complete);
      const record: ConversationRecord = {
        id,
        // The first line is shown straight away and kept if no better title comes.
        title: titleFrom(said),
        preview: said.slice(0, 140),
        createdAt: now,
        updatedAt: now,
        status: 'idle',
        options: clean(input.options ?? {}),
        engine: engine.id,
        ...(autoTitle && { titling: true }),
      };
      live = { record, events: [], seq: 0, permissions: new Map(), alwaysAllow: new Set() };
      this.#live.set(record.id, live);
      await this.deps.store.upsert(record);
      this.events.emit({
        type: 'conversation.created',
        clientMessageId: input.clientMessageId,
        conversation: summary(record),
      });
    }

    this.#append(live, {
      type: 'user.message',
      messageId: input.clientMessageId,
      text: input.text,
      ...(attachments.length && { attachments }),
    });
    if (expanded?.skill) this.#append(live, { type: 'skill.used', ...expanded.skill, by: 'user' });
    live.record = { ...live.record, preview: said.slice(0, 140), updatedAt: Date.now() };
    live.abort = new AbortController();
    this.#setStatus(live, 'running');
    await this.#persist(live);
    void this.#runTurn(live, engine, expanded?.prompt ?? input.text, attachments);
    if (autoTitle) void this.#autoTitle(live, engine, titleSource(input.text, attachments));
    return summary(live.record);
  }

  /**
   * Name a new chat after what it's about, alongside its first turn. Whatever
   * happens — a poor reply, an error, a timeout — `titling` is cleared and the
   * first-line title simply stays.
   */
  async #autoTitle(live: Live, engine: Engine, text: string) {
    const abort = new AbortController();
    live.titling = abort;
    let title: string | undefined;
    try {
      const result = await generateTitle(engine, text, abort.signal);
      if (result.usage) this.deps.onSpend?.(result.usage);
      title = result.title;
    } catch {
      // Keep the first line.
    }
    if (abort.signal.aborted || live.titling !== abort) return;
    live.titling = undefined;
    live.record = { ...live.record, ...(title && { title }), titling: undefined };
    if (title) this.#append(live, { type: 'title', title });
    await this.#persist(live).catch(() => {});
    this.events.emit({ type: 'conversation.updated', conversation: summary(live.record) });
  }

  /**
   * Start a conversation programmatically (a routine run). Resolves once the
   * turn has started, with a promise for its result.
   */
  async start(input: {
    title: string;
    text: string;
    options?: TurnOptions;
    origin: NonNullable<ConversationRecord['origin']>;
    extras: TurnExtras;
  }): Promise<{ conversationId: string; result: Promise<TurnResult> }> {
    const engine = this.deps.engine(input.options?.engine);
    const expanded = await this.deps.expand?.(input.text, engine).catch(() => undefined);
    const now = Date.now();
    const record: ConversationRecord = {
      id: newId('c'),
      title: input.title,
      preview: input.text.slice(0, 140),
      createdAt: now,
      updatedAt: now,
      status: 'idle',
      options: clean(input.options ?? {}),
      origin: input.origin,
      engine: engine.id,
    };
    const live: Live = {
      record,
      events: [],
      seq: 0,
      permissions: new Map(),
      alwaysAllow: new Set(),
    };
    this.#live.set(record.id, live);
    await this.deps.store.upsert(record);
    this.events.emit({ type: 'conversation.updated', conversation: summary(record) });
    this.#append(live, { type: 'user.message', messageId: newId('u'), text: input.text });
    if (expanded?.skill) this.#append(live, { type: 'skill.used', ...expanded.skill, by: 'user' });
    live.abort = new AbortController();
    live.extras = input.extras;
    this.#setStatus(live, 'running');
    await this.#persist(live);
    return {
      conversationId: record.id,
      result: this.#runTurn(live, engine, expanded?.prompt ?? input.text),
    };
  }

  /** Change a conversation's model/effort/mode without sending a message. */
  async configure(id: string, options: TurnOptions) {
    const live = await this.#get(id);
    this.#applyOptions(live, options);
    await this.deps.store.upsert(live.record);
    this.events.emit({ type: 'conversation.updated', conversation: summary(live.record) });
  }

  #applyOptions(live: Live, options: TurnOptions) {
    const next = clean({ ...live.record.options, ...options });
    if (JSON.stringify(next) === JSON.stringify(live.record.options)) return;
    live.record = { ...live.record, options: next };
    this.#append(live, { type: 'options', options: next });
  }

  async interrupt(id: string) {
    const live = await this.#get(id);
    live.abort?.abort();
  }

  async respond(id: string, permissionId: string, decision: PermissionDecision) {
    const live = await this.#get(id);
    const pending = live.permissions.get(permissionId);
    if (!pending) return;
    live.permissions.delete(permissionId);
    if (decision === 'allow-always' && pending.remember) live.alwaysAllow.add(pending.toolName);
    this.#append(live, { type: 'permission.resolved', permissionId, decision });
    if (live.permissions.size === 0) this.#setStatus(live, 'running');
    pending.resolve(decision);
  }

  async #runTurn(
    live: Live,
    engine: Engine,
    said: string,
    attachments: readonly Attachment[] = [],
  ): Promise<TurnResult> {
    const abort = live.abort ?? new AbortController();
    const conversationId = live.record.id;
    const settings = await this.deps.settings.get();
    const memories = await this.deps.memory.list();
    const started = new Map<string, number>();
    let outcome: 'success' | 'interrupted' | 'error' = 'success';
    let completed: { usage?: Usage; error?: string; problem?: TurnProblem } | undefined;
    const extras = live.extras;
    let finalText = '';
    let finalMessageId: string | undefined;

    // The default provider is the pinned one when there's a pin, whatever the preference says.
    const defaults = { ...settings.preferences, engine: this.deps.engine().id };
    const resolved = resolveOptions(live.record.options, defaults, engine.id);
    if (extras?.permissionMode) resolved.permissionMode = extras.permissionMode;
    // The mode the chat shows for this provider is the one it runs in.
    resolved.permissionMode = honouredMode(resolved.permissionMode, await honouredModes(engine));

    /** Puts a question to the user and waits; expires (deny) if the turn stops first. */
    const askUser = (
      request: AskRequest & { toolUseId?: string; remember: boolean },
      signal: AbortSignal,
    ): Promise<PermissionDecision> => {
      const permissionId = newId('perm');
      return new Promise<PermissionDecision>((resolve) => {
        live.permissions.set(permissionId, {
          resolve,
          toolName: request.toolName,
          remember: request.remember,
        });
        const expire = () => {
          if (!live.permissions.delete(permissionId)) return;
          this.#append(live, {
            type: 'permission.resolved',
            permissionId,
            decision: 'expired',
          });
          resolve('deny');
        };
        signal.addEventListener('abort', expire, { once: true });
        abort.signal.addEventListener('abort', expire, { once: true });
        // Nobody is watching an unattended run: after an hour, the answer is no.
        if (extras) {
          const timer = setTimeout(expire, UNATTENDED_PERMISSION_MS);
          timer.unref();
        }
        this.#append(live, {
          type: 'permission.requested',
          permissionId,
          toolUseId: request.toolUseId,
          toolName: request.toolName,
          input: request.input,
          summary: request.summary,
          browser: request.browser,
        });
        this.#setStatus(live, 'awaiting-permission');
      });
    };

    const tools = memoryTools({
      store: this.deps.memory,
      conversationId,
      onSaved: (memory) => {
        this.#append(live, { type: 'memory.saved', memory });
      },
      onForgotten: (memory) => {
        this.#append(live, {
          type: 'memory.forgotten',
          memoryId: memory.id,
          content: memory.content,
        });
      },
    });

    tools.push(
      // Unattended runs (routines) don't get the routine tools: a run that read
      // something hostile must not be able to reschedule or rewrite routines.
      ...(extras
        ? []
        : (this.deps.tools?.({
            conversationId,
            append: (event) => this.#append(live, event),
            engine,
            permissionMode: resolved.permissionMode,
            ask: (request) => askUser({ ...request, remember: false }, abort.signal),
            signal: abort.signal,
          }) ?? [])),
      ...(extras?.tools ?? []),
    );
    // This provider's own session, and whatever it missed while others answered.
    const session = live.record.sessions?.[engine.id];
    const asked = live.events.findLast((e) => e.type === 'user.message')?.seq ?? live.seq;
    const missed = handoff(live.events, { afterSeq: session?.seq ?? -1, beforeSeq: asked });
    let answeredWith: string | undefined;
    const integrations = this.deps.integrations;
    const appendIssue = (issue: IntegrationIssueInput) =>
      this.#append(live, { type: 'integration.issue', ...issue });

    let closeBridge: (() => Promise<void>) | undefined;
    const requestPermission = async (
      request: { toolName: string; toolUseId?: string; input: Record<string, unknown> },
      signal: AbortSignal,
    ): Promise<PermissionDecision> => {
      // Your choices on the Integrations page come first: "Don't ask", or a tool you turned off.
      const policy = await integrations?.decide(request.toolName).catch(() => undefined);
      if (policy === 'allow') return 'allow';
      if (policy === 'off') return 'deny';
      if (live.alwaysAllow.has(request.toolName)) return 'allow';
      const described = await integrations?.describeTool(request.toolName).catch(() => undefined);
      return askUser(
        {
          toolName: request.toolName,
          toolUseId: request.toolUseId,
          input: request.input,
          summary: described
            ? `${described.tool.charAt(0).toLowerCase()}${described.tool.slice(1)} in ${described.integration}`
            : summarizeToolUse(request.toolName, request.input),
          remember: true,
        },
        signal,
      );
    };

    // Attachments go in front of the words, as each provider can take them (ADR 0017).
    const can = engine.attachments ?? { images: false, files: false };
    const store = this.deps.attachments;
    const attached =
      store && attachments.length
        ? await attachmentsForTurn(store, attachments, can).catch(() => undefined)
        : undefined;
    const prompt = attached?.block
      ? said
        ? `${attached.block}\n\n${said}`
        : attached.block
      : said;
    // Files sent earlier in the chat stay readable to engines that open files.
    const readableDirs =
      store && can.files
        ? [
            ...new Set(
              live.events.flatMap((e) =>
                e.type === 'user.message'
                  ? (e.attachments ?? []).map((a) => store.folder(a.id))
                  : [],
              ),
            ),
          ]
        : [];

    try {
      // Only the person's words count as asking for an app, not what they pasted.
      const [loaded, apps] = await Promise.all([
        integrations?.forTurn(said).catch(() => undefined),
        this.#offers(live, engine, settings.preferences.mutedSuggestions),
      ]);
      for (const offer of apps.offers)
        this.#append(live, { type: 'integration.suggestion', ...offer });
      for (const issue of loaded?.issues ?? []) appendIssue(issue);
      // Engines that can't run MCP servers get the tools through Conch instead.
      const bridged =
        loaded && engine.integrations.mode === 'bridge' && Object.keys(loaded.servers).length
          ? await integrations
              ?.bridge(loaded.servers, loaded.disallowedTools)
              .catch(() => undefined)
          : undefined;
      closeBridge = bridged?.close;
      if (bridged?.failed.length)
        void integrations?.turnFailed(bridged.failed).then(
          (issues) => issues.forEach(appendIssue),
          () => undefined,
        );
      const bridgedTools: BridgedTool[] | undefined = bridged?.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        run: async (args, toolUseId) => {
          const decision = await requestPermission(
            { toolName: tool.name, toolUseId, input: args },
            abort.signal,
          );
          if (decision === 'deny') return { text: 'The user declined this action.', isError: true };
          return tool.call(args);
        },
      }));

      const stream = engine.runTurn({
        conversationId,
        prompt: missed ? `${missed}\n\n${prompt}` : prompt,
        ...(attached?.images.length && { images: attached.images }),
        ...(readableDirs.length && { readableDirs }),
        resumeId: session?.resumeId,
        systemAppend: [
          buildSystemAppend({
            persona: settings.persona,
            profile: settings.profile,
            memories,
            autoMemory: settings.preferences.autoMemory,
            tools: engine.hostTools !== false,
          }),
          await this.deps.context?.(engine),
          notConnectedPrompt(
            apps.unseen,
            apps.offers.map((o) => o.name),
          ),
          extras?.systemExtra,
        ]
          .filter(Boolean)
          .join('\n\n'),
        cwd: await this.deps.settings.workspace(),
        tools,
        options: resolved,
        mcpServers: engine.integrations.mode === 'native' ? loaded?.servers : undefined,
        disallowedTools: loaded?.disallowedTools,
        bridgedTools,
        signal: abort.signal,
        requestPermission,
      });

      for await (const event of stream) {
        switch (event.type) {
          case 'session':
            answeredWith = event.model ?? answeredWith;
            live.record = {
              ...live.record,
              engine: engine.id,
              resumeId: undefined,
              sessions: {
                ...live.record.sessions,
                [engine.id]: { resumeId: event.resumeId, seq: live.seq - 1 },
              },
            };
            break;
          case 'text':
            if (event.messageId !== finalMessageId) {
              finalMessageId = event.messageId;
              finalText = '';
            }
            finalText += event.delta;
            this.#append(live, {
              type: 'assistant.delta',
              messageId: event.messageId,
              kind: 'text',
              delta: event.delta,
            });
            break;
          case 'thinking':
            this.#append(live, {
              type: 'assistant.delta',
              messageId: event.messageId,
              kind: event.type,
              delta: event.delta,
            });
            break;
          case 'message-done':
            this.#append(live, { type: 'assistant.done', messageId: event.messageId });
            break;
          case 'tool-start':
            if (isHostTool(event.name)) break;
            if (event.name.startsWith('mcp__'))
              void integrations?.markUsed(event.name).catch(() => undefined);
            started.set(event.toolUseId, Date.now());
            this.#append(live, {
              type: 'tool.started',
              toolUseId: event.toolUseId,
              name: event.name,
              input: event.input,
            });
            break;
          case 'tool-end': {
            const at = started.get(event.toolUseId);
            if (at === undefined) break;
            this.#append(live, {
              type: 'tool.finished',
              toolUseId: event.toolUseId,
              status: event.status,
              output: event.output,
              durationMs: Date.now() - at,
            });
            break;
          }
          case 'notice':
            this.#append(live, { type: 'notice', code: event.code, message: event.message });
            break;
          case 'mcp-status':
            // Checking why takes a moment; don't hold up the reply for it.
            void integrations?.turnFailed(event.failed).then(
              (issues) => issues.forEach(appendIssue),
              () => undefined,
            );
            break;
          case 'done':
            outcome = event.outcome;
            completed = { usage: event.usage, error: event.error, problem: event.problem };
            break;
        }
      }
      if (!completed) outcome = abort.signal.aborted ? 'interrupted' : 'error';
    } catch (error) {
      outcome = 'error';
      completed = { error: (error as Error).message || 'Something went wrong.' };
    } finally {
      // The closing events are persisted before they're broadcast, so a client
      // that reloads the moment it sees `turn.completed` finds a complete log.
      const tail: ConversationEvent[] = [];
      // Close any tool call the engine never finished (e.g. interrupted mid-run).
      const finished = new Set(
        live.events.flatMap((e) => (e.type === 'tool.finished' ? [e.toolUseId] : [])),
      );
      for (const [toolUseId, at] of started) {
        if (!finished.has(toolUseId)) {
          this.#append(
            live,
            {
              type: 'tool.finished',
              toolUseId,
              status: 'error',
              output: outcome === 'interrupted' ? 'Stopped.' : undefined,
              durationMs: Date.now() - at,
            },
            tail,
          );
        }
      }
      // Why it failed decides what the chat offers: sign in, another provider, 1Password.
      const problem =
        outcome === 'error'
          ? (completed?.problem ?? (await turnProblem(engine, completed?.error)))
          : undefined;
      this.#append(
        live,
        {
          type: 'turn.completed',
          outcome,
          usage: completed?.usage,
          ...(problem && { problem }),
          error:
            outcome === 'error'
              ? (completed?.error ?? `${engine.label} stopped unexpectedly.`)
              : undefined,
          engine: engine.id,
          ...((answeredWith ?? resolved.model) && { model: answeredWith ?? resolved.model }),
        },
        tail,
      );
      // Everything up to here is part of this provider's session now.
      const own = live.record.sessions?.[engine.id];
      if (own)
        live.record = {
          ...live.record,
          sessions: { ...live.record.sessions, [engine.id]: { ...own, seq: live.seq - 1 } },
        };
      await closeBridge?.();
      live.abort = undefined;
      live.permissions.clear();
      const status: ConversationStatus = outcome === 'error' ? 'error' : 'idle';
      live.record = { ...live.record, status, updatedAt: Date.now() };
      this.#append(live, { type: 'status', status }, tail);
      await this.#persist(live);
      for (const event of tail) this.events.emit({ type: 'conversation.event', event });
      this.events.emit({ type: 'conversation.updated', conversation: summary(live.record) });
      live.extras?.onStatus?.(status);
      live.extras = undefined;
    }
    return { outcome, usage: completed?.usage, error: completed?.error, finalText };
  }

  /**
   * The apps this turn is about that aren't connected, and which of them to
   * offer: read from the words the person typed (not a pasted file or a
   * skill's instructions), each offered at most once per conversation, never
   * one they muted, and never in an unattended run — nobody is there to press
   * the button, though the assistant is still told what it can't see.
   */
  async #offers(
    live: Live,
    engine: Engine,
    muted: readonly string[],
  ): Promise<{ offers: IntegrationSuggestionInput[]; unseen: string[] }> {
    const none = { offers: [], unseen: [] };
    const integrations = this.deps.integrations;
    if (!integrations?.suggest) return none;
    const typed = live.events.findLast((e) => e.type === 'user.message')?.text;
    if (!typed?.trim()) return none;
    const offered = live.events.flatMap((e) =>
      e.type === 'integration.suggestion' ? [e.catalogId] : [],
    );
    const found = await integrations
      .suggest(typed, engine, new Set([...muted, ...offered]))
      .catch(() => none);
    const unattended = Boolean(live.extras || live.record.origin);
    return unattended ? { offers: [], unseen: found.unseen } : found;
  }

  /** “Not now”: put an offer away for the rest of this conversation. */
  async dismissSuggestion(id: string, catalogId: string) {
    const live = await this.#get(id);
    const offered = live.events.some(
      (e) => e.type === 'integration.suggestion' && e.catalogId === catalogId,
    );
    const dismissed = live.events.some(
      (e) => e.type === 'integration.suggestion.dismissed' && e.catalogId === catalogId,
    );
    if (!offered)
      throw new ConversationError('not-found', 'That wasn’t offered in this conversation.');
    if (dismissed) return;
    this.#append(live, { type: 'integration.suggestion.dismissed', catalogId });
    // A running turn saves the log when it ends; writing it now as well could race.
    if (!live.abort) await this.#persist(live);
  }

  /** Append to the log and broadcast — or, if `defer` is given, collect for later broadcast. */
  #append(live: Live, input: ConversationEventInput, defer?: ConversationEvent[]) {
    const event = {
      ...input,
      conversationId: live.record.id,
      seq: live.seq++,
      at: Date.now(),
    } as ConversationEvent;
    live.events.push(event);
    if (defer) defer.push(event);
    else this.events.emit({ type: 'conversation.event', event });
  }

  #setStatus(live: Live, status: ConversationStatus) {
    if (live.record.status === status) return;
    live.extras?.onStatus?.(status);
    live.record = { ...live.record, status };
    this.#append(live, { type: 'status', status });
    this.events.emit({ type: 'conversation.updated', conversation: summary(live.record) });
  }

  async #persist(live: Live) {
    await this.deps.store.upsert(live.record);
    await this.deps.store.saveEvents(live.record.id, live.events);
  }

  async #get(id: string): Promise<Live> {
    const cached = this.#live.get(id);
    if (cached) {
      // Most recently used last, so eviction drops the stalest first.
      this.#live.delete(id);
      this.#live.set(id, cached);
      return cached;
    }
    const stored = await this.deps.store.get(id);
    if (!stored) throw new ConversationError('not-found', 'Conversation not found.');
    const events = await this.deps.store.events(id);
    const live: Live = {
      record: upgrade(stored, events.at(-1)?.seq ?? -1),
      events,
      seq: (events.at(-1)?.seq ?? -1) + 1,
      permissions: new Map(),
      alwaysAllow: new Set(),
    };
    this.#live.set(id, live);
    this.#evict();
    return live;
  }

  /**
   * Keep memory bounded: forget the least recently used conversations that
   * are idle (nothing running, nothing waiting on the user). They reload from
   * disk when opened again.
   */
  #evict() {
    for (const [id, live] of this.#live) {
      if (this.#live.size <= MAX_LIVE) break;
      const busy = live.abort || live.extras || live.titling || live.permissions.size > 0;
      if (!busy) this.#live.delete(id);
    }
  }
}

function summary(record: ConversationRecord): ConversationSummary {
  const { id, title, preview, createdAt, updatedAt, status, origin, titling } = record;
  return {
    id,
    title,
    preview,
    createdAt,
    updatedAt,
    status,
    ...(titling && { titling }),
    options: record.options ?? {},
    ...(origin && { origin }),
  };
}

/** Drop unset keys so "no override" is stored as absence, not `undefined`. */
function clean(options: TurnOptions): TurnOptions {
  return Object.fromEntries(
    Object.entries(options).filter(([, v]) => v !== undefined),
  ) as TurnOptions;
}

/**
 * A conversation from before every provider was available at once (ADR 0012):
 * its one session belongs to the provider it recorded, and so does its model.
 */
export function upgrade(record: ConversationRecord, lastSeq: number): ConversationRecord {
  let next = record;
  if (record.resumeId && !record.sessions) {
    next = {
      ...next,
      resumeId: undefined,
      sessions: { [record.engine]: { resumeId: record.resumeId, seq: lastSeq } },
    };
  }
  if (record.options?.model && !record.options.engine) {
    next = { ...next, options: { ...record.options, engine: record.engine } };
  }
  return next;
}

/**
 * This turn's choices: the conversation's own over the user's defaults. A
 * model only means something to the provider it belongs to, so the default
 * model applies only when the default provider answers.
 */
export function resolveOptions(
  options: TurnOptions | undefined,
  defaults: Pick<Preferences, 'effort' | 'fastMode' | 'permissionMode'> & {
    model?: string;
    engine?: EngineId;
  },
  /** The provider answering; omit when there's only one. */
  engine?: EngineId,
): ResolvedOptions {
  const chosen = options?.engine ?? defaults.engine;
  const model =
    engine === undefined
      ? (options?.model ?? defaults.model)
      : options?.model
        ? chosen === undefined || chosen === engine
          ? options.model
          : undefined
        : engine === (defaults.engine ?? engine)
          ? defaults.model
          : undefined;
  return {
    model,
    effort: options?.effort ?? defaults.effort,
    fastMode: options?.fastMode ?? defaults.fastMode,
    permissionMode: options?.permissionMode ?? defaults.permissionMode,
  };
}

/** What a chat is named after: the words, or the names of what was attached when there are none. */
function titleSource(text: string, attachments: readonly Attachment[]): string {
  if (text.trim()) return text;
  return attachments.map((a) => (a.pasted ? 'Pasted text' : a.name)).join(', ');
}
