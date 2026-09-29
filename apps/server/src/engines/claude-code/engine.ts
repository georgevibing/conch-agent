import {
  createSdkMcpServer,
  query,
  tool,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { EngineStatus, LoginMethod, LoginState } from '@conch/protocol';

import type { SettingsStore } from '../../settings/store';
import type { Engine, EngineEvent, LoginHandle, TurnInput } from '../types';
import { detectClaude } from './detect';
import { childEnv } from './env';
import { startClaudeLogin } from './login';
import { Translator } from './translate';

const CACHE_MS = 20_000;

export class ClaudeCodeEngine implements Engine {
  readonly id = 'claude-code' as const;
  readonly label = 'Claude Code';
  #cache?: { status: EngineStatus; at: number };
  #inflight?: Promise<EngineStatus>;

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

  async setApiKey(apiKey: string | undefined): Promise<void> {
    await this.settings.setSecrets({ anthropicApiKey: apiKey });
    this.#cache = undefined;
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
