import {
  createSdkMcpServer,
  query,
  tool,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  Capabilities,
  EngineStatus,
  LoginMethod,
  LoginState,
  PermissionMode,
} from '@conch/protocol';

import type { SettingsStore } from '../../settings/store';
import { Emitter } from '../../lib/emitter';
import type {
  Engine,
  EngineEvent,
  EngineUsage,
  LimitSignal,
  LoginHandle,
  TurnInput,
} from '../types';
import { detectClaude } from './detect';
import { childEnv } from './env';
import { startClaudeLogin } from './login';
import { Translator } from './translate';
import { limitSignal, usageFromResponse, usageFromStatus } from './usage';

const CACHE_MS = 20_000;
const CAPABILITIES_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 30_000;
const USAGE_MS = 60_000;

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
  #cache?: { status: EngineStatus; at: number };
  #inflight?: Promise<EngineStatus>;
  #capabilities?: { value: Capabilities; at: number };
  #probing?: Promise<Capabilities>;
  #usage?: { value: EngineUsage; at: number };
  #usageProbe?: Promise<EngineUsage>;
  #limits = new Emitter<LimitSignal>();

  constructor(
    private readonly settings: SettingsStore,
    private readonly explicitPath?: string,
  ) {}

  async detect({ force = false } = {}): Promise<EngineStatus> {
    if (!force && this.#cache && Date.now() - this.#cache.at < CACHE_MS) return this.#cache.status;
    this.#inflight ??= (async () => {
      const { anthropicApiKey } = await this.settings.secrets();
      const status = await detectClaude({
        explicitPath: this.explicitPath,
        apiKey: anthropicApiKey,
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
    const { anthropicApiKey } = await this.settings.secrets();
    const idle = async function* (): AsyncGenerator<SDKUserMessage> {
      yield* await new Promise<SDKUserMessage[]>(() => {});
    };
    return query({
      prompt: idle(),
      options: {
        pathToClaudeCodeExecutable: status.executablePath,
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

  onLimits(listener: (signal: LimitSignal) => void): () => void {
    return this.#limits.on(listener);
  }

  async setApiKey(apiKey: string | undefined): Promise<void> {
    await this.settings.setSecrets({ anthropicApiKey: apiKey });
    this.#cache = undefined;
    this.#capabilities = undefined;
    this.#usage = undefined;
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    const status = await this.detect();
    const { anthropicApiKey } = await this.settings.secrets();
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    input.signal.addEventListener('abort', onAbort, { once: true });

    const conch = createSdkMcpServer({
      name: 'conch',
      version: '1.0.0',
      tools: input.tools.map((t) =>
        tool(t.name, t.description, t.input, async (args) => ({
          content: [{ type: 'text', text: await t.run(args) }],
        })),
      ),
    });

    // SDK MCP servers need streaming input; a one-message stream ends the turn cleanly.
    async function* prompt(): AsyncGenerator<SDKUserMessage> {
      yield {
        type: 'user',
        message: { role: 'user', content: input.prompt },
        parent_tool_use_id: null,
      } as SDKUserMessage;
    }

    const translator = new Translator();
    let finished = false;
    try {
      const q = query({
        prompt: prompt(),
        options: {
          cwd: input.cwd,
          resume: input.resumeId,
          pathToClaudeCodeExecutable: status.executablePath,
          env: childEnv({ ANTHROPIC_API_KEY: anthropicApiKey }),
          abortController: abort,
          includePartialMessages: true,
          systemPrompt: { type: 'preset', preset: 'claude_code', append: input.systemAppend },
          ...(input.options.model &&
            input.options.model !== 'default' && { model: input.options.model }),
          ...(input.options.effort !== 'auto' && { effort: input.options.effort }),
          ...(input.options.fastMode && { settings: { fastMode: true } }),
          permissionMode: input.options.permissionMode,
          ...(input.options.permissionMode === 'bypassPermissions' && {
            allowDangerouslySkipPermissions: true,
          }),
          mcpServers: { conch },
          canUseTool: async (toolName, toolInput, { signal, suggestions, toolUseID }) => {
            // Conch's own tools (memory) are always allowed; the user sees their effects inline.
            if (toolName.startsWith('mcp__conch__'))
              return { behavior: 'allow', updatedInput: toolInput };
            const decision = await input.requestPermission(
              { toolName, toolUseId: toolUseID, input: toolInput },
              signal,
            );
            if (decision === 'deny') {
              return { behavior: 'deny', message: 'The user declined this action.' };
            }
            return {
              behavior: 'allow',
              updatedInput: toolInput,
              ...(decision === 'allow-always' &&
                suggestions && { updatedPermissions: suggestions }),
            };
          },
        },
      });

      for await (const message of q) {
        if (message.type === 'rate_limit_event') {
          this.#limits.emit(limitSignal(message.rate_limit_info));
          continue;
        }
        for (const event of translator.translate(message)) {
          if (event.type === 'done') finished = true;
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
