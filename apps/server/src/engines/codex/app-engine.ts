/** Codex through its supported app-server API, with Conch-owned tools and credentials. */
import { dirname } from 'node:path';

import {
  EffortChoice,
  type Capabilities,
  type EngineStatus,
  type LoginMethod,
  type LoginState,
  type PlanStep,
  type Usage,
  type TurnProblem,
  type ToolView,
} from '@conch/protocol';
import { z } from 'zod';

import { sandboxSupport } from '../../conversations/sandbox';
import { newId } from '../../lib/ids';
import { cleanPlan, stepStatus } from '../../plans/steps';
import { run } from '../../lib/proc';
import type { ProviderKeys } from '../../providers/keys';
import type { SettingsStore } from '../../settings/store';
import { buildTools } from '../api/engine';
import { hostEnvironment } from '../host';
import type { Engine, EngineEvent, LoginHandle, TurnInput } from '../types';
import { DOCS_URL, MIN_VERSION, findCodex, installHints, isAtLeast, parseVersion } from './detect';
import { CodexHome } from './home';
import type { RpcMessage } from './rpc';

const Account = z.object({
  account: z
    .object({
      type: z.string(),
      email: z.string().nullable().optional(),
      planType: z.string().optional(),
    })
    .nullable(),
});
const Model = z.object({
  id: z.string(),
  model: z.string(),
  displayName: z.string(),
  description: z.string().default(''),
  hidden: z.boolean().optional(),
  supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })).default([]),
  inputModalities: z.array(z.string()).default([]),
});
const Models = z.object({ data: z.array(Model), nextCursor: z.string().nullable().optional() });
class CodexFailure extends Error {
  constructor(
    message: string,
    readonly problem?: TurnProblem,
  ) {
    super(message);
  }
}
export function codexProblem(info: unknown): TurnProblem | undefined {
  if (info === 'unauthorized') return 'signed-out';
  if (['usageLimitExceeded', 'rateLimitExceeded', 'sessionBudgetExceeded'].includes(String(info)))
    return 'limit';
  if (
    ['serverOverloaded', 'internalServerError'].includes(String(info)) ||
    (info && typeof info === 'object')
  )
    return 'unavailable';
  return undefined;
}
/**
 * Codex's plan (`turn/plan/updated`: its `update_plan` tool), as Conch's
 * checklist (ADR 0060). Each update is the whole plan.
 */
export function codexPlan(plan: unknown): PlanStep[] | undefined {
  if (!Array.isArray(plan)) return undefined;
  return cleanPlan(
    plan.flatMap((entry) => {
      const { step, status } = (entry ?? {}) as { step?: unknown; status?: unknown };
      const state = stepStatus(status);
      return typeof step === 'string' && state ? [{ title: step, status: state }] : [];
    }),
  );
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// Native tools stay in a read-only sandbox and are declined if they ask. All
// useful work goes through dynamic tools, which call Conch's guard every time.
const TOOL_CONFIG = [
  'features.hooks=false',
  'features.skill_mcp_dependency_install=false',
  'project_doc_max_bytes=0',
  'features.shell_tool=false',
  'features.unified_exec=false',
  'features.multi_agent=false',
  'features.apps=false',
  'features.browser_use=false',
  'features.computer_use=false',
  'features.view_image=false',
  'features.image_generation=false',
  'features.memories=false',
  'web_search="disabled"',
  'approval_policy="untrusted"',
  'sandbox_mode="read-only"',
];

export class CodexEngine implements Engine {
  readonly id = 'codex-cli' as const;
  readonly label = 'Codex';
  readonly commandSandbox = 'conch' as const;
  readonly conversationHistory = true;
  readonly integrations = { mode: 'bridge' as const };
  readonly hostTools = true;
  /** Its plan updates (`turn/plan/updated`) are drawn as Conch's checklist. */
  readonly plans = 'native' as const;
  readonly attachments = { images: true, files: true };
  readonly #home: CodexHome;
  #status?: EngineStatus;
  #at = 0;
  #caps?: Capabilities;
  #detecting?: Promise<EngineStatus>;
  #listing?: Promise<Capabilities>;

  constructor(
    private readonly settings: SettingsStore,
    private readonly keys: ProviderKeys,
    private readonly explicitPath?: string,
    home = dirname(settings.workspaceDefault),
  ) {
    this.#home = new CodexHome(home);
  }

  async detect({ force = false } = {}): Promise<EngineStatus> {
    if (!force && this.#status && Date.now() - this.#at < 20_000) return this.#status;
    this.#detecting ??= this.#detect().finally(() => {
      this.#detecting = undefined;
    });
    return this.#detecting;
  }

  async #detect(): Promise<EngineStatus> {
    const base = {
      engine: this.id,
      label: this.label,
      install: installHints(),
      docsUrl: DOCS_URL,
      canSignIn: true,
      checkedAt: Date.now(),
    };
    const executablePath = await findCodex(this.explicitPath);
    if (!executablePath)
      return {
        ...base,
        state: 'not-installed',
        fix: { need: 'codex', kind: 'install' },
        message: 'Install Codex to use your ChatGPT subscription. No API key is needed.',
      };
    const versionRun = await run(executablePath, ['--version'], {
      env: hostEnvironment(),
      timeout: 15_000,
    });
    const version = parseVersion(versionRun.stdout);
    if (versionRun.code !== 0 || !version || !isAtLeast(version, MIN_VERSION))
      return {
        ...base,
        state: 'error',
        executablePath,
        version,
        fix: { need: 'codex', kind: 'update' },
        message: `Update Codex to ${MIN_VERSION} or newer for Conch’s tools and sign-in.`,
      };
    try {
      const key = await this.keys.value(this.id, { peek: true });
      const account = await this.#home.withClient(executablePath, async (rpc) => {
        if (key) await rpc.request('account/login/start', { type: 'apiKey', apiKey: key });
        return Account.parse(await rpc.request('account/read', { refreshToken: true })).account;
      });
      this.#status = {
        ...base,
        executablePath,
        version,
        state: account ? 'ready' : 'signed-out',
        ...(account
          ? {
              auth: {
                method:
                  account.type === 'chatgpt' ? ('subscription' as const) : ('api-key' as const),
                description:
                  account.type === 'chatgpt'
                    ? `ChatGPT${account.planType ? ` ${account.planType}` : ''}`
                    : 'OpenAI API key',
                ...(account.email ? { email: account.email } : {}),
              },
            }
          : {
              message:
                'Sign in with your ChatGPT subscription. Conch keeps its own connection; no API key is needed.',
            }),
      };
    } catch {
      this.#status = {
        ...base,
        executablePath,
        version,
        state: 'signed-out',
        message:
          'Conch could not verify this ChatGPT connection. Reconnect, or check your network and try again.',
      };
    }
    this.#at = Date.now();
    return this.#status;
  }

  login(method: LoginMethod, update: (state: LoginState) => void): LoginHandle {
    const loginId = newId('login');
    if (method === 'api-key') {
      queueMicrotask(() =>
        update({
          loginId,
          phase: 'failed',
          message:
            'Save your OpenAI key in the provider’s key settings, or choose ChatGPT subscription sign-in.',
        }),
      );
      return { submitCode() {}, cancel() {} };
    }
    const abort = new AbortController();
    let terminal = false;
    const emit = (state: Omit<LoginState, 'loginId'>) => {
      if (!terminal) {
        update({ loginId, ...state });
        if (['done', 'failed', 'cancelled'].includes(state.phase)) terminal = true;
      }
    };
    const timer = setTimeout(() => {
      emit({ phase: 'failed', message: 'Sign-in expired. Start again for a new code.' });
      abort.abort();
    }, 10 * 60_000).unref();
    queueMicrotask(() => {
      void (async () => {
        emit({ phase: 'starting' });
        const executable = await findCodex(this.explicitPath);
        if (!executable) throw new Error('Install Codex first.');
        await this.#home.withClient(
          executable,
          async (rpc) => {
            const completion = new Promise<void>((resolve, reject) => {
              rpc.onFailure(reject);
              rpc.listen((message) => {
                if (message.method !== 'account/login/completed') return;
                const params = object(message.params);
                if (params.success === true) resolve();
                else reject(new Error('ChatGPT sign-in was declined or expired. Start again.'));
              });
            });
            // Attach a handler immediately: a transport failure during login/start
            // must not leave an unhandled rejection waiting for the device code.
            void completion.catch(() => {});
            const result = z
              .object({
                type: z.literal('chatgptDeviceCode'),
                verificationUrl: z.string().url(),
                userCode: z.string().min(1).max(64),
              })
              .parse(await rpc.request('account/login/start', { type: 'chatgptDeviceCode' }));
            const url = new URL(result.verificationUrl);
            if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com')
              throw new Error(
                'Codex returned an unexpected sign-in address. Update Codex and try again.',
              );
            emit({ phase: 'waiting-for-browser', url: url.href, code: result.userCode });
            await completion;
            emit({ phase: 'verifying' });
            const account = Account.parse(
              await rpc.request('account/read', { refreshToken: true }),
            ).account;
            if (account?.type !== 'chatgpt')
              throw new Error('ChatGPT did not confirm the sign-in. Please reconnect.');
          },
          { signal: abort.signal },
        );
        this.#status = undefined;
        this.#caps = undefined;
        emit({
          phase: 'done',
          message: 'ChatGPT connected. Your plan’s available models and limits apply.',
        });
      })()
        .catch((error: unknown) => {
          // Conch's own sentences are shown. What the system or a parser said
          // (`EBUSY: … unlink 'C:\…'`) means nothing to the person signing in.
          const plain =
            error instanceof Error && !(error instanceof z.ZodError) && !('code' in error);
          if (!plain && !abort.signal.aborted) console.error('[codex] sign-in', error);
          emit({
            phase: abort.signal.aborted ? 'cancelled' : 'failed',
            message: plain
              ? error.message
              : 'Conch couldn’t set up the sign-in on this computer. Please try again.',
          });
        })
        .finally(() => clearTimeout(timer));
    });
    return {
      submitCode() {},
      cancel() {
        emit({ phase: 'cancelled' });
        clearTimeout(timer);
        abort.abort();
      },
    };
  }

  async disconnect(): Promise<void> {
    const executable = await findCodex(this.explicitPath);
    if (!executable) throw new Error('Install Codex to safely disconnect this account.');
    await this.#home.withClient(executable, (rpc) => rpc.request('account/logout', {}), {
      signOut: true,
    });
    this.#status = undefined;
    this.#caps = undefined;
  }
  async setApiKey(): Promise<void> {
    this.#status = undefined;
    this.#caps = undefined;
  }
  async capabilities({ force = false } = {}): Promise<Capabilities> {
    if (this.#caps && !force) return this.#caps;
    this.#listing ??= this.#capabilities().finally(() => {
      this.#listing = undefined;
    });
    return this.#listing;
  }

  async #capabilities(): Promise<Capabilities> {
    const value: Capabilities = {
      engine: this.id,
      label: this.label,
      models: [],
      commands: [],
      permissionModes: ['default', 'plan', 'acceptEdits', 'bypassPermissions'],
      tools: { host: true, files: true, shell: sandboxSupport().available, approvals: true },
      attachments: this.attachments,
    };
    const status = await this.detect();
    if (status.state !== 'ready' || !status.executablePath) return value;
    const listed = await this.#home.withClient(status.executablePath, (rpc) =>
      rpc.request('model/list', { limit: 100 }),
    );
    value.models = Models.parse(listed)
      .data.filter((m) => !m.hidden)
      .map((m) => ({
        id: m.model,
        label: m.displayName,
        description: m.description,
        efforts: EffortChoice.exclude(['auto']).options.filter((e) =>
          m.supportedReasoningEfforts.some((v) => v.reasoningEffort === e),
        ),
        supportsFastMode: false,
        supportsAutoMode: false,
        images: m.inputModalities.includes('image'),
        tools: true,
      }));
    this.#caps = value;
    return value;
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    let usage: Usage | undefined;
    const queue: { event: EngineEvent; ack?: () => void }[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    const emit = (event: EngineEvent) => {
      queue.push({ event });
      wake?.();
      wake = undefined;
    };
    const local = new AbortController();
    const signal = AbortSignal.any([input.signal, local.signal]);
    const publish = (event: EngineEvent) =>
      new Promise<void>((resolve) => {
        const ack = () => {
          signal.removeEventListener('abort', ack);
          resolve();
        };
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener('abort', ack, { once: true });
        queue.push({ event, ack });
        wake?.();
        wake = undefined;
      });
    const work = (async () => {
      const status = await this.detect();
      if (status.state !== 'ready' || !status.executablePath)
        throw new CodexFailure(
          status.message ?? 'Reconnect ChatGPT in Settings → Providers.',
          status.state === 'signed-out' ? 'signed-out' : 'unavailable',
        );
      signal.throwIfAborted();
      const tools = buildTools({ ...input, signal });
      const profile = [
        ...(input.protectedPaths ?? []),
        this.#home.home,
        ...(input.sandbox?.denyRead ?? []),
      ]
        .map((p) => `${JSON.stringify(p)}="deny"`)
        .join(',');
      await this.#home.withClient(
        status.executablePath,
        async (rpc) => {
          let threadId = '';
          let turnId = '';
          const pendingTools = new Set<Promise<void>>();
          let toolTail = Promise.resolve();
          const invoked = new Set<string>();
          let complete!: () => void;
          let fail!: (error: Error) => void;
          const done = new Promise<void>((resolve, reject) => {
            complete = resolve;
            fail = reject;
          });
          void done.catch(() => {});
          rpc.onFailure(fail);
          const onMessage = (message: RpcMessage) => {
            const p = object(message.params);
            if (message.id !== undefined && message.method) {
              if (message.method === 'item/tool/call') {
                const job = toolTail.then(async () => {
                  const parsed = z
                    .object({
                      threadId: z.string(),
                      tool: z.string(),
                      callId: z.string(),
                      arguments: z.record(z.string(), z.unknown()),
                    })
                    .safeParse(p);
                  if (
                    !parsed.success ||
                    parsed.data.threadId !== threadId ||
                    invoked.has(parsed.data.callId) ||
                    invoked.size >= 512
                  ) {
                    rpc.send({
                      id: message.id,
                      result: {
                        success: false,
                        contentItems: [{ type: 'inputText', text: 'Invalid or stale tool call.' }],
                      },
                    });
                    return;
                  }
                  const call = parsed.data;
                  invoked.add(call.callId);
                  const tool = tools.get(call.tool);
                  await publish({
                    type: 'tool-start',
                    toolUseId: call.callId,
                    name: tool?.display ?? call.tool,
                    input: call.arguments,
                  });
                  let text = 'This tool is not enabled in this conversation.';
                  let isError = true;
                  let view: ToolView | undefined;
                  try {
                    if (tool) {
                      signal.throwIfAborted();
                      const result = await tool.run(call.arguments, call.callId);
                      text = result.text;
                      isError = result.isError;
                      view = result.isError ? undefined : result.view;
                    }
                  } catch {
                    text = signal.aborted
                      ? 'Stopped.'
                      : 'The tool could not complete. Check the action and try again.';
                  }
                  await publish({
                    type: 'tool-end',
                    toolUseId: call.callId,
                    status: isError ? 'error' : 'success',
                    output: text,
                    ...(view && { view }),
                  });
                  if (!signal.aborted)
                    rpc.send({
                      id: message.id,
                      result: { success: !isError, contentItems: [{ type: 'inputText', text }] },
                    });
                });
                toolTail = job.catch(() => {});
                pendingTools.add(job);
                void job.catch(fail).finally(() => pendingTools.delete(job));
              } else if (message.method.endsWith('/requestApproval')) {
                // Native tools have no Conch before/after contract: never grant a bypass.
                rpc.send({
                  id: message.id,
                  result:
                    message.method === 'item/permissions/requestApproval'
                      ? { permissions: {}, scope: 'turn' }
                      : { decision: 'decline' },
                });
              } else
                rpc.send({
                  id: message.id,
                  error: { code: -32601, message: 'Use the tools supplied by Conch.' },
                });
              return;
            }
            if (threadId && typeof p.threadId === 'string' && p.threadId !== threadId) return;
            if (message.method === 'item/agentMessage/delta' && typeof p.delta === 'string')
              emit({ type: 'text', messageId: String(p.itemId), delta: p.delta });
            if (message.method === 'item/reasoning/summaryTextDelta' && typeof p.delta === 'string')
              emit({ type: 'thinking', messageId: String(p.itemId), delta: p.delta });
            if (message.method === 'item/completed' && object(p.item).type === 'agentMessage')
              emit({ type: 'message-done', messageId: String(object(p.item).id) });
            if (message.method === 'turn/plan/updated') {
              const steps = codexPlan(p.plan);
              if (steps) emit({ type: 'plan', steps });
            }
            if (message.method === 'thread/tokenUsage/updated') {
              const total = z
                .object({
                  inputTokens: z.number().nonnegative(),
                  outputTokens: z.number().nonnegative(),
                })
                .safeParse(object(p.tokenUsage).total);
              if (total.success) {
                usage = total.data;
                // A running total, so an unattended run can stop at its limit (ADR 0057).
                emit({ type: 'usage', usage });
              }
            }
            if (message.method === 'turn/completed') {
              const turn = object(p.turn);
              if (turn.status === 'completed') complete();
              else if (turn.status === 'interrupted') {
                local.abort();
                complete();
              } else
                fail(
                  new CodexFailure(
                    'Codex could not finish this turn. Check your ChatGPT connection and plan limits in Settings → Providers.',
                    codexProblem(object(turn.error).codexErrorInfo),
                  ),
                );
            }
          };
          rpc.listen(onMessage);
          // Fresh thread each turn: dynamic tools are persisted on thread/start
          // and cannot be replaced on resume in the supported protocol. Reusing
          // an old schema could expose an app the user has since disconnected.
          const started = object(
            await rpc.request('thread/start', {
              cwd: input.cwd,
              environments: [],
              model: input.options.model,
              approvalPolicy: 'untrusted',
              permissions: 'conch',
              config: { [`projects.${JSON.stringify(input.cwd)}.trust_level`]: 'untrusted' },
              developerInstructions: input.systemAppend,
              allowProviderModelFallback: false,
              ephemeral: true,
              dynamicTools: [...tools.values()].map((tool) => ({
                type: 'function',
                name: tool.spec.name,
                description: tool.spec.description,
                inputSchema: tool.spec.schema,
              })),
            }),
          );
          threadId = String(object(started.thread).id ?? '');
          if (!threadId) throw new Error('Codex did not create a conversation.');
          const startedTurn = object(
            await rpc.request('turn/start', {
              threadId,
              environments: [],
              input: [
                { type: 'text', text: input.prompt },
                ...(input.images ?? []).map((image) => ({
                  type: 'image',
                  url: `data:${image.mimeType};base64,${image.data}`,
                })),
              ],
              ...(input.options.effort !== 'auto' ? { effort: input.options.effort } : {}),
            }),
          );
          turnId = String(object(startedTurn.turn).id ?? '');
          const interrupt = () => {
            if (turnId) {
              try {
                rpc.send({
                  id: 'interrupt',
                  method: 'turn/interrupt',
                  params: { threadId, turnId },
                });
              } catch {
                /* Already stopped. */
              }
            }
          };
          signal.addEventListener('abort', interrupt, { once: true });
          try {
            await done;
            await Promise.all(pendingTools);
          } finally {
            signal.removeEventListener('abort', interrupt);
          }
        },
        {
          signal,
          config: [
            ...TOOL_CONFIG,
            'permissions.conch.extends=":read-only"',
            `permissions.conch.filesystem={${profile}}`,
            'permissions.conch.network={enabled=false}',
          ],
        },
      );
      emit({ type: 'done', outcome: signal.aborted ? 'interrupted' : 'success', usage });
    })()
      .catch((error: unknown) =>
        emit({
          type: 'done',
          outcome: signal.aborted ? 'interrupted' : 'error',
          ...(!signal.aborted
            ? {
                error: error instanceof Error ? error.message : 'Codex could not finish this turn.',
                ...(error instanceof CodexFailure ? { problem: error.problem } : {}),
              }
            : {}),
        }),
      )
      .finally(() => {
        finished = true;
        wake?.();
      });
    try {
      while (!finished || queue.length) {
        const entry = queue.shift();
        if (entry) {
          yield entry.event;
          entry.ack?.();
        } else
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
      }
      await work;
    } finally {
      local.abort();
      await work;
    }
  }
}
