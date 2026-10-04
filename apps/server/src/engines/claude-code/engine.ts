import {
  createSdkMcpServer,
  query,
  tool,
  type McpServerConfig,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  Capabilities,
  EngineStatus,
  LoginMethod,
  LoginState,
  PermissionMode,
  ToolView,
} from '@conch/protocol';

import type { ProviderKeys } from '../../providers/keys';
import type { SettingsStore } from '../../settings/store';
import { Emitter } from '../../lib/emitter';
import { programFile } from '../../lib/proc';
import type {
  Completion,
  CompletionInput,
  Engine,
  EngineEvent,
  EngineIntegrations,
  EngineMcpStatus,
  EngineUsage,
  HostToolResult,
  LimitSignal,
  LoginHandle,
  TurnInput,
} from '../types';
import { checkHostArgs, lenientShape, withNotes } from '../tools/args';
import { detectClaude } from './detect';
import { PROTECTED_MESSAGE, touchesProtected } from '../../lib/protect';
import { childEnv } from './env';
import { startClaudeLogin } from './login';
import { Translator } from './translate';
import { limitSignal, usageFromResponse, usageFromStatus } from './usage';

const CACHE_MS = 20_000;
const CAPABILITIES_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 30_000;
const USAGE_MS = 60_000;
const MCP_STATUS_MS = 60_000;
/** How long servers get to start before Conch reports on them. */
const MCP_SETTLE_MS = 20_000;
/** How long a turn waits for its integrations to connect before starting anyway. */
const MCP_CONNECT_WAIT_MS = 5_000;

/** A host tool's result as MCP content: its text, then any images (the model sees them). */
function sdkContent(result: string | HostToolResult) {
  if (typeof result === 'string') return [{ type: 'text' as const, text: result }];
  return [
    { type: 'text' as const, text: result.text },
    ...(result.images ?? []).map((image) => ({
      type: 'image' as const,
      data: image.data,
      mimeType: image.mimeType,
    })),
  ];
}

/**
 * The tool call Claude Code says a host tool is answering, from the MCP
 * request's `_meta['claudecode/toolUseId']`, so what the tool found for the
 * person (its view) can join the tool's row (ADR 0060).
 */
export function toolUseIdOf(extra: unknown): string | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  const meta = (extra as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== 'object') return undefined;
  const id = (meta as Record<string, unknown>)['claudecode/toolUseId'];
  return typeof id === 'string' && id.length > 0 && id.length <= 200 ? id : undefined;
}

/** Claude Code's config scopes, in Conch's words. */
function sourceOf(source?: string): EngineMcpStatus['source'] {
  switch (source) {
    case 'user':
    case 'managed':
    case 'enterprise':
      return 'engine';
    case 'project':
    case 'local':
      return 'project';
    case 'claudeai':
      return 'account';
    case 'plugin':
      return 'plugin';
    default:
      return 'other';
  }
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), PROBE_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class ClaudeCodeEngine implements Engine {
  readonly id = 'claude-code' as const;
  readonly label = 'Claude Code';
  /** Claude Code maps this to Haiku on every provider (or ANTHROPIC_DEFAULT_HAIKU_MODEL). */
  readonly smallModel = 'haiku';
  /** Every Claude model sees, so it can describe a screenshot for a model that can't (ADR 0070). */
  readonly completeSees = true;
  /** It loads `~/.claude/skills` by itself, whatever Conch says. */
  readonly skillSources = ['claude'] as const;
  /** It keeps its own plan (its todos or tasks), translated into Conch's checklist. */
  readonly plans = 'native' as const;
  /**
   * Its program runs the loop and paces long work itself (compaction, its own
   * limits); Conch doesn't second-guess a coding session from outside (ADR 0077).
   */
  readonly turnBudget = 'own' as const;
  /**
   * Claude Code runs MCP servers itself, and loads the connectors from your
   * Claude account by itself. Conch brings the ones it can connect into
   * Conch, so they work with every model (ADR 0049).
   */
  readonly integrations: EngineIntegrations = {
    mode: 'native',
    signInHint: 'In a terminal, run claude, then /mcp, to sign it in.',
    account: { label: 'your Claude account', url: 'https://claude.ai/settings/connectors' },
  };
  /** Claude sees images, and Claude Code opens files (PDFs, spreadsheets…) with its own tools. */
  readonly attachments = { images: true, files: true };
  #cache?: { status: EngineStatus; at: number };
  #inflight?: Promise<EngineStatus>;
  #capabilities?: { value: Capabilities; at: number };
  #probing?: Promise<Capabilities>;
  #usage?: { value: EngineUsage; at: number };
  #usageProbe?: Promise<EngineUsage>;
  #limits = new Emitter<LimitSignal>();
  #mcp?: { value: EngineMcpStatus[]; at: number };
  #mcpProbe?: Promise<EngineMcpStatus[]>;

  #healed = new Set<string>();

  constructor(
    private readonly settings: SettingsStore,
    private readonly keys: ProviderKeys,
    private readonly explicitPath?: string,
    /** Leaves a “fixed on its own” note. */
    private readonly onHeal?: (message: string) => void,
  ) {}

  /**
   * Claude Code's own key, when you gave Conch one. `peek` is used wherever the
   * caller is only drawing a page: a key kept in 1Password must never make
   * Settings ask for a fingerprint.
   */
  #apiKey(options: { peek?: boolean } = {}) {
    return this.keys.value('claude-code', options).catch(() => undefined);
  }

  async detect({ force = false } = {}): Promise<EngineStatus> {
    if (!force && this.#cache && Date.now() - this.#cache.at < CACHE_MS) return this.#cache.status;
    this.#inflight ??= (async () => {
      const status = await detectClaude({
        explicitPath: this.explicitPath,
        apiKey: await this.#apiKey({ peek: true }),
        // Detection runs every few seconds; the note is worth saying once.
        onHeal: (message) => {
          if (this.#healed.has(message)) return;
          this.#healed.add(message);
          this.onHeal?.(message);
        },
      });
      this.#cache = { status, at: Date.now() };
      return status;
    })().finally(() => {
      this.#inflight = undefined;
    });
    return this.#inflight;
  }

  login(method: LoginMethod, onUpdate: (state: LoginState) => void): LoginHandle {
    const executablePath = this.#cache?.status.executablePath;
    if (!executablePath) {
      const loginId = 'login_unavailable';
      queueMicrotask(() =>
        onUpdate({ loginId, phase: 'failed', message: "Claude Code isn't installed yet." }),
      );
      return { submitCode() {}, cancel() {} };
    }
    return startClaudeLogin({
      executablePath,
      method,
      onUpdate,
      verify: async () => (await this.detect({ force: true })).state === 'ready',
    });
  }

  /**
   * Ask Claude Code itself which models and slash commands it offers. We start
   * a session with an input stream that never sends anything, read the
   * initialize handshake, and close it — no API request is made.
   */
  async capabilities({ force = false } = {}): Promise<Capabilities> {
    if (!force && this.#capabilities && Date.now() - this.#capabilities.at < CAPABILITIES_MS) {
      return this.#capabilities.value;
    }
    this.#probing ??= this.#probe().finally(() => {
      this.#probing = undefined;
    });
    return this.#probing;
  }

  async #probe(): Promise<Capabilities> {
    const status = await this.detect();
    const empty: Capabilities = {
      engine: this.id,
      label: this.label,
      models: [],
      tools: { host: true, files: true, shell: true, approvals: true },
      commands: [],
      permissionModes: ['default', 'acceptEdits', 'plan', 'bypassPermissions'],
    };
    if (status.state !== 'ready') return empty;
    const q = await this.#idleSession(status);
    try {
      const [models, commands] = await withTimeout(
        Promise.all([q.supportedModels(), q.supportedCommands()]),
        'Timed out asking Claude Code for its models.',
      );
      const autoMode = models.some((m) => m.supportsAutoMode);
      const value: Capabilities = {
        ...empty,
        models: models.map((m) => ({
          id: m.value,
          tools: true,
          label: m.displayName,
          description: m.description,
          efforts: m.supportsEffort ? (m.supportedEffortLevels ?? []) : [],
          supportsFastMode: Boolean(m.supportsFastMode),
          supportsAutoMode: Boolean(m.supportsAutoMode),
        })),
        commands: commands.map((c) => ({
          name: c.name,
          description: c.description,
          argumentHint: c.argumentHint,
        })),
        permissionModes: (autoMode
          ? ['default', 'auto', 'acceptEdits', 'plan', 'bypassPermissions']
          : empty.permissionModes) as PermissionMode[],
      };
      this.#capabilities = { value, at: Date.now() };
      return value;
    } finally {
      q.close();
    }
  }

  /**
   * A session whose input stream never yields: it completes the initialize
   * handshake (so control requests work) without ever sending a prompt.
   */
  async #idleSession(status: EngineStatus) {
    const anthropicApiKey = await this.#apiKey();
    const idle = async function* (): AsyncGenerator<SDKUserMessage> {
      yield* await new Promise<SDKUserMessage[]>(() => {});
    };
    return query({
      prompt: idle(),
      options: {
        pathToClaudeCodeExecutable: programFile(status.executablePath),
        env: childEnv({ ANTHROPIC_API_KEY: anthropicApiKey }),
        cwd: await this.settings.workspace(),
      },
    });
  }

  /**
   * Plan limits, read the way Claude Code's own `/usage` reads them. Metered
   * sign-ins (API key, Bedrock, …) are answered from the auth status alone;
   * subscriptions open an idle session and ask — no model request is made.
   */
  async usage({ force = false } = {}): Promise<EngineUsage> {
    const status = await this.detect();
    const quick = usageFromStatus(status);
    if (quick) return quick;
    if (!force && this.#usage && Date.now() - this.#usage.at < USAGE_MS) return this.#usage.value;
    this.#usageProbe ??= this.#probeUsage(status).finally(() => {
      this.#usageProbe = undefined;
    });
    return this.#usageProbe;
  }

  async #probeUsage(status: EngineStatus): Promise<EngineUsage> {
    const q = await this.#idleSession(status);
    try {
      // Experimental in the SDK; if it's renamed we degrade to "no plan limits known".
      type UsageApi = 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET';
      const read = (q as Partial<Pick<typeof q, UsageApi>>)
        .usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
      if (!read) {
        return {
          kind: 'unknown',
          source: status.auth?.description ?? this.label,
          windows: [],
          message: 'Update Claude Code to let Conch show your usage limits.',
        };
      }
      const response = await withTimeout(
        read.call(q, { skipBehaviors: true }),
        'Timed out asking Claude Code for your usage.',
      );
      const value = usageFromResponse(response);
      this.#usage = { value, at: Date.now() };
      return value;
    } finally {
      q.close();
    }
  }

  /**
   * The MCP servers Claude Code loads by itself — your `claude mcp add`
   * servers, the workspace's `.mcp.json`, plugins and your Claude account's
   * connectors — read from an idle session, like `/mcp` does.
   */
  async mcpStatus(): Promise<EngineMcpStatus[]> {
    if (this.#mcp && Date.now() - this.#mcp.at < MCP_STATUS_MS) return this.#mcp.value;
    this.#mcpProbe ??= (async () => {
      const status = await this.detect();
      if (status.state !== 'ready') return [];
      const q = await this.#idleSession(status);
      try {
        // Servers connect in the background. Ask until every one has settled
        // (or the deadline passes) — a snapshot taken too early says
        // "pending" for everything and would read as "checking" forever.
        const deadline = Date.now() + MCP_SETTLE_MS;
        let servers = await withTimeout(
          q.mcpServerStatus(),
          'Timed out asking Claude Code for its integrations.',
        );
        while (servers.some((s) => s.status === 'pending') && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 750));
          servers = await withTimeout(
            q.mcpServerStatus(),
            'Timed out asking Claude Code for its integrations.',
          );
        }
        const value = servers
          .filter((s) => s.source !== 'sdk' && s.source !== 'dynamic')
          .map((s): EngineMcpStatus => ({
            name: s.name.replace(/^claude\.ai\s+/i, '').replace(/^plugin:[^:]+:/, ''),
            // Still starting at the deadline: it isn't going to come up by itself.
            status: s.status === 'pending' ? 'failed' : s.status,
            source: sourceOf(s.source ?? s.scope),
            plugin: /^plugin:([^:]+):/.exec(s.name)?.[1],
            error:
              s.status === 'pending'
                ? `Didn’t finish starting within ${MCP_SETTLE_MS / 1000} seconds.`
                : s.error,
            toolCount: s.tools?.length ?? 0,
            url: s.config && 'url' in s.config ? s.config.url : undefined,
          }));
        this.#mcp = { value, at: Date.now() };
        return value;
      } finally {
        q.close();
      }
    })().finally(() => {
      this.#mcpProbe = undefined;
    });
    return this.#mcpProbe;
  }

  onLimits(listener: (signal: LimitSignal) => void): () => void {
    return this.#limits.on(listener);
  }

  /**
   * The key changed (the provider service stores it): forget everything that
   * depended on it, so the next check reflects the new sign-in.
   */
  async setApiKey(): Promise<void> {
    this.#cache = undefined;
    this.#capabilities = undefined;
    this.#usage = undefined;
  }

  /**
   * A single, cheap request: our own short system prompt instead of Claude
   * Code's, no tools, no MCP servers, no thinking, nothing written to disk.
   * User settings still load, because that's where provider config
   * (e.g. Bedrock) often lives.
   *
   * Where the sign-in allows it, Claude Code runs `--bare`: no CLAUDE.md,
   * rules, plugins or hooks. That context is thousands of tokens a title
   * doesn't need — about 20× the cost. Bare mode can't read OAuth or keychain
   * credentials, so subscriptions (and any bare failure) run normally.
   */
  async complete(input: CompletionInput): Promise<Completion> {
    const status = await this.detect();
    if (status.state !== 'ready') throw new Error(`${this.label} isn't ready.`);
    const anthropicApiKey = await this.#apiKey();
    const method = status.auth?.method;
    const bare =
      Boolean(anthropicApiKey) ||
      method === 'bedrock' ||
      method === 'vertex' ||
      method === 'foundry';
    if (bare) {
      try {
        return await this.#complete(input, status, anthropicApiKey, true);
      } catch (error) {
        if (input.signal.aborted) throw error;
      }
    }
    return this.#complete(input, status, anthropicApiKey, false);
  }

  async #complete(
    input: CompletionInput,
    status: EngineStatus,
    anthropicApiKey: string | undefined,
    bare: boolean,
  ): Promise<Completion> {
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    input.signal.addEventListener('abort', onAbort, { once: true });
    try {
      // Pictures go in a message of their own: a plain prompt can only be words.
      const images = input.images ?? [];
      async function* withPictures(): AsyncGenerator<SDKUserMessage> {
        yield {
          type: 'user',
          message: {
            role: 'user',
            content: [
              ...images.map((image) => ({
                type: 'image' as const,
                source: { type: 'base64' as const, media_type: image.mimeType, data: image.data },
              })),
              { type: 'text' as const, text: input.prompt },
            ],
          },
          parent_tool_use_id: null,
        } as SDKUserMessage;
      }
      const q = query({
        prompt: images.length ? withPictures() : input.prompt,
        options: {
          cwd: await this.settings.workspace(),
          pathToClaudeCodeExecutable: programFile(status.executablePath),
          env: childEnv({ ANTHROPIC_API_KEY: anthropicApiKey }),
          abortController: abort,
          systemPrompt: input.system,
          ...(input.model && input.model !== 'default' && { model: input.model }),
          tools: [],
          mcpServers: {},
          strictMcpConfig: true,
          settingSources: ['user'],
          thinking: { type: 'disabled' },
          maxTurns: 1,
          persistSession: false,
          ...(bare && { extraArgs: { bare: null } }),
        },
      });
      for await (const message of q) {
        if (message.type !== 'result') continue;
        if (message.subtype !== 'success' || message.is_error) {
          throw new Error(`${this.label} couldn't answer (${message.subtype}).`);
        }
        return {
          text: message.result,
          usage: {
            inputTokens: message.usage.input_tokens ?? 0,
            outputTokens: message.usage.output_tokens ?? 0,
            costUsd: message.total_cost_usd,
          },
        };
      }
      throw new Error(`${this.label} ended without an answer.`);
    } finally {
      input.signal.removeEventListener('abort', onAbort);
    }
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    const status = await this.detect();
    const anthropicApiKey = await this.#apiKey();
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    input.signal.addEventListener('abort', onAbort, { once: true });

    // What host tools found for the person, by tool call, until their row closes.
    const views = new Map<string, ToolView>();
    const conch = createSdkMcpServer({
      name: 'conch',
      version: '1.0.0',
      tools: input.tools.map((t) =>
        tool(
          t.name,
          t.description,
          // Advertised exactly as declared, read forgivingly and checked by Conch (ADR 0072).
          lenientShape(t.input),
          async (raw, extra) => {
            const checked = checkHostArgs(t, raw);
            if (!checked.ok)
              return { content: [{ type: 'text' as const, text: checked.message }], isError: true };
            const ran = await t.run(checked.args);
            const result =
              typeof ran === 'string'
                ? withNotes(ran, checked.notes)
                : { ...ran, text: withNotes(ran.text, checked.notes) };
            const id = toolUseIdOf(extra);
            if (id && typeof result !== 'string' && result.view) views.set(id, result.view);
            // The model gets the text (and pictures); the view is never sent to it.
            return { content: sdkContent(result) };
          },
          { alwaysLoad: t.alwaysLoad, searchHint: t.searchHint },
        ),
      ),
    });

    // Integrations are handed over on Claude Code's stdin (setMcpServers),
    // not in `options.mcpServers`: the SDK passes those as a command-line
    // argument, where any user on this computer could read tokens with `ps`.
    let release = () => {};
    const connected = new Promise<void>((resolve) => (release = resolve));
    let mcpReport: EngineEvent | undefined;

    // SDK MCP servers need streaming input; a one-message stream ends the turn cleanly.
    async function* prompt(): AsyncGenerator<SDKUserMessage> {
      await connected;
      yield {
        type: 'user',
        message: {
          role: 'user',
          content: input.images?.length
            ? [
                ...input.images.map((image) => ({
                  type: 'image' as const,
                  source: { type: 'base64' as const, media_type: image.mimeType, data: image.data },
                })),
                { type: 'text' as const, text: input.prompt },
              ]
            : input.prompt,
        },
        parent_tool_use_id: null,
      } as SDKUserMessage;
    }

    const translator = new Translator();
    const asksItself = input.tools.some((t) => t.name === 'ask');
    let finished = false;
    try {
      const q = query({
        prompt: prompt(),
        options: {
          cwd: input.cwd,
          // Attachments live in Conch's folder, not the workspace; let Claude Code read them.
          ...(input.readableDirs?.length && { additionalDirectories: input.readableDirs }),
          resume: input.resumeId,
          pathToClaudeCodeExecutable: programFile(status.executablePath),
          env: childEnv({ ANTHROPIC_API_KEY: anthropicApiKey }),
          abortController: abort,
          includePartialMessages: true,
          // Words only (a guest in a group, ADR 0075): no tools of its own, and none of
          // Claude Code's own prompt, which describes this computer.
          systemPrompt: input.wordsOnly
            ? input.systemAppend
            : { type: 'preset', preset: 'claude_code', append: input.systemAppend },
          ...(input.wordsOnly && { tools: [] }),
          ...(input.options.model &&
            input.options.model !== 'default' && { model: input.options.model }),
          ...(input.options.effort !== 'auto' && { effort: input.options.effort }),
          ...(input.options.fastMode && { settings: { fastMode: true } }),
          permissionMode: input.options.permissionMode,
          ...(input.options.permissionMode === 'bypassPermissions' && {
            allowDangerouslySkipPermissions: true,
          }),
          mcpServers: { conch },
          // Deny rules hold in every mode, Full trust included (`//` is an absolute path).
          ...((input.disallowedTools?.length || input.protectedPaths?.length || asksItself) && {
            disallowedTools: [
              ...(input.disallowedTools ?? []),
              // Conch's `ask` shows answers to tap (ADR 0060); Claude Code's own would be a bare prompt.
              ...(asksItself ? ['AskUserQuestion'] : []),
              ...(input.protectedPaths ?? []).flatMap((p) => {
                const rule = `/${p.replaceAll('\\', '/')}${/\.json$/.test(p) ? '' : '/**'}`;
                return [`Read(${rule})`, `Edit(${rule})`, `Write(${rule})`];
              }),
            ],
          }),
          // The sealed box (ADR 0028): commands write only to the work folder, temp and
          // caches, and can't read where keys live. Escaping it asks (the guard below).
          ...(input.sandbox && {
            sandbox: {
              enabled: true,
              failIfUnavailable: false,
              autoAllowBashIfSandboxed: false,
              allowUnsandboxedCommands: true,
              filesystem: {
                allowWrite: input.sandbox.allowWrite,
                denyRead: input.sandbox.denyRead,
              },
            },
          }),
          // Every tool call passes here, whatever the mode: canUseTool alone is skipped
          // when a mode allows by itself (Full trust, Accept edits), so what must hold
          // in every mode is decided here (ADR 0028).
          hooks: {
            PreToolUse: [
              {
                hooks: [
                  async (hookInput) => {
                    if (hookInput.hook_event_name !== 'PreToolUse') return {};
                    const toolName = hookInput.tool_name;
                    const toolInput = (hookInput.tool_input ?? {}) as Record<string, unknown>;
                    if (toolName.startsWith('mcp__conch__')) return {};
                    const deny = (reason: string) => ({
                      hookSpecificOutput: {
                        hookEventName: 'PreToolUse' as const,
                        permissionDecision: 'deny' as const,
                        permissionDecisionReason: reason,
                      },
                    });
                    if (touchesProtected(toolInput, input.protectedPaths ?? []))
                      return deny(PROTECTED_MESSAGE);
                    const verdict = await input.guard?.({
                      toolName,
                      toolUseId: hookInput.tool_use_id,
                      input: toolInput,
                    });
                    if (verdict?.decision === 'deny') return deny(verdict.message);
                    if (verdict?.decision === 'ask')
                      return {
                        hookSpecificOutput: {
                          hookEventName: 'PreToolUse' as const,
                          permissionDecision: 'ask' as const,
                          permissionDecisionReason: verdict.reason,
                        },
                      };
                    return {};
                  },
                ],
              },
            ],
          },
          canUseTool: async (toolName, toolInput, { signal, toolUseID }) => {
            // Conch's own tools (memory) are always allowed; the user sees their effects inline.
            if (toolName.startsWith('mcp__conch__'))
              return { behavior: 'allow', updatedInput: toolInput };
            // Passwords and Conch's keys are never read or changed with files or commands.
            if (touchesProtected(toolInput, input.protectedPaths ?? []))
              return { behavior: 'deny', message: PROTECTED_MESSAGE };
            const decision = await input.requestPermission(
              { toolName, toolUseId: toolUseID, input: toolInput },
              signal,
            );
            if (decision === 'deny') {
              // "Keep planning": the plan isn't wrong, it isn't finished.
              if (toolName === 'ExitPlanMode')
                return {
                  behavior: 'deny',
                  message:
                    'The person chose Keep planning: stay in plan mode and don’t start the work yet. Ask what they’d like changed, or refine the plan and present it again.',
                };
              return { behavior: 'deny', message: 'The user declined this action.' };
            }
            // "Always allow" lasts for this conversation only (the manager
            // remembers it). Claude Code's suggested rules are deliberately not
            // forwarded: they'd be written to .claude/settings.local.json and
            // silently apply to every future chat and routine.
            return { behavior: 'allow', updatedInput: toolInput };
          },
        },
      });

      // A mode picked mid-turn holds from the next tool call, not the next message.
      // Full trust picked mid-turn runs as Ask here, and Conch answers each ask
      // itself (the manager), so what must still ask (ADR 0028) still does.
      const startedTrusted = input.options.permissionMode === 'bypassPermissions';
      input.onModeChange?.((mode) => {
        const next = mode === 'bypassPermissions' && !startedTrusted ? 'default' : mode;
        void q.setPermissionMode(next).catch(() => undefined);
      });

      const integrations = Object.entries(input.mcpServers ?? {});
      if (!integrations.length) release();
      else {
        const servers: Record<string, McpServerConfig> = { conch };
        for (const [name, server] of integrations) servers[name] = server;
        void Promise.race([
          q.setMcpServers(servers).then(
            (result) => {
              const failed = Object.entries(result.errors).map(([name, error]) => ({
                name,
                error,
              }));
              if (failed.length) mcpReport = { type: 'mcp-status', failed };
            },
            () => undefined,
          ),
          new Promise((resolve) => setTimeout(resolve, MCP_CONNECT_WAIT_MS)),
        ]).finally(release);
      }

      for await (const message of q) {
        if (mcpReport) {
          yield mcpReport;
          mcpReport = undefined;
        }
        if (message.type === 'rate_limit_event') {
          this.#limits.emit(limitSignal(message.rate_limit_info));
          continue;
        }
        for (const event of translator.translate(message)) {
          if (event.type === 'done') finished = true;
          const view = event.type === 'tool-end' ? views.get(event.toolUseId) : undefined;
          if (view && event.type === 'tool-end') {
            views.delete(event.toolUseId);
            yield event.status === 'success' ? { ...event, view } : event;
            continue;
          }
          yield event;
        }
      }
      if (!finished) {
        yield input.signal.aborted
          ? { type: 'done', outcome: 'interrupted' }
          : { type: 'done', outcome: 'error', error: 'Claude Code ended without a result.' };
      }
    } catch (error) {
      if (finished) return;
      if (input.signal.aborted) {
        yield { type: 'done', outcome: 'interrupted' };
      } else {
        yield { type: 'done', outcome: 'error', error: (error as Error).message };
      }
    } finally {
      input.signal.removeEventListener('abort', onAbort);
    }
  }
}
