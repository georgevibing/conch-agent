/**
 * Codex through its supported app-server API, with Conch-owned credentials.
 * Two ways (ADR 0066): `tools` (Codex) with every Codex tool off and Conch's
 * tools doing the work (ADR 0036), and `agent` (Codex CLI) with Codex's own
 * shell and file edits on, every approval it asks for going through Conch.
 */
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  EffortChoice,
  severityFor,
  type Capabilities,
  type EngineStatus,
  type LoginMethod,
  type LoginState,
  type PlanStep,
  type Usage,
  type TurnProblem,
  type ToolView,
  ALL_MODES,
} from '@conch/protocol';
import { z } from 'zod';

import { PROTECTED_MESSAGE, touchesProtected } from '../../lib/protect';
import { newId } from '../../lib/ids';
import { cleanPlan, stepStatus } from '../../plans/steps';
import { run } from '../../lib/proc';
import type { ProviderKeys } from '../../providers/keys';
import type { SettingsStore } from '../../settings/store';
import { buildTools } from '../api/engine';
import { withSight } from '../api/sight';
import { secretPlaces } from '../../conversations/sandbox';
import { hostEnvironment } from '../host';
import {
  failureText,
  type Completion,
  type CompletionInput,
  type Engine,
  type EngineEvent,
  type EngineUsage,
  type LoginHandle,
  type PermissionRequest,
  type PictureMaker,
  type PictureRequest,
  type ToolImage,
  type TurnInput,
} from '../types';
import { DOCS_URL, MIN_VERSION, findCodex, installHints, isAtLeast, parseVersion } from './detect';
import { CodexHome } from './home';
import { completeWithCodex } from './complete';
import { makeCodexPicture, PICTURE_LINE } from './pictures';
import type { RpcMessage } from './rpc';
import { ToolQueue } from './tool-queue';
import { CodexToolEvents } from './tool-events';
import { CodexThreads, digest, parseResumeId, resumeIdFor, toolsDigest } from './threads';

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
  // A refused connection says so by its status: `{responseStreamDisconnected: {httpStatusCode: 401}}`.
  const status =
    info && typeof info === 'object'
      ? Object.values(info)
          .map((v) => object(v).httpStatusCode)
          .find((s) => typeof s === 'number')
      : undefined;
  if (status === 401 || status === 403) return 'signed-out';
  if (status === 429) return 'limit';
  if (['usageLimitExceeded', 'rateLimitExceeded', 'sessionBudgetExceeded'].includes(String(info)))
    return 'limit';
  if (
    ['serverOverloaded', 'internalServerError'].includes(String(info)) ||
    (info && typeof info === 'object')
  )
    return 'unavailable';
  return undefined;
}
const LimitWindow = z.object({
  usedPercent: z.number(),
  windowDurationMins: z.number().nullable().optional(),
  resetsAt: z.number().nullable().optional(),
});
const RateLimits = z.object({
  primary: LimitWindow.nullable().optional(),
  secondary: LimitWindow.nullable().optional(),
  planType: z.string().nullable().optional(),
  rateLimitReachedType: z.string().nullable().optional(),
});

/** A window's name by its length: Codex's are five hours and a week. */
function windowWords(minutes: number | null | undefined, fallback: string) {
  if (!minutes)
    return { id: fallback, label: fallback === 'primary' ? 'Current session' : 'Longer window' };
  if (minutes <= 24 * 60) return { id: 'session', label: 'Current session' };
  if (Math.abs(minutes - 7 * 24 * 60) <= 24 * 60) return { id: 'weekly', label: 'This week' };
  const days = Math.round(minutes / (24 * 60));
  return { id: `window-${minutes}`, label: `${days}-day window` };
}

/**
 * Codex's plan limits (`account/rateLimits/read`, and `account/rateLimits/updated`
 * while a turn runs) as Conch's usage windows: the five-hour session and the week.
 */
export function codexUsage(result: unknown, source: string): EngineUsage {
  const parsed = RateLimits.safeParse(object(result).rateLimits ?? result);
  if (!parsed.success) return { kind: 'unknown', source, windows: [] };
  const limits = parsed.data;
  const windows = (
    [
      [limits.primary, 'primary'],
      [limits.secondary, 'secondary'],
    ] as const
  ).flatMap(([window, fallback]) => {
    if (!window) return [];
    const used = Math.min(100, Math.max(0, window.usedPercent));
    const at = window.resetsAt ?? undefined;
    return [
      {
        ...windowWords(window.windowDurationMins, fallback),
        usedPercent: used,
        // Codex says seconds; a value this large is already milliseconds.
        ...(at !== undefined && { resetsAt: at < 1e12 ? at * 1000 : at }),
        severity: severityFor(used),
      },
    ];
  });
  const plan = limits.planType && limits.planType !== 'unknown' ? limits.planType : undefined;
  return {
    kind: windows.length ? 'plan' : 'unknown',
    source: plan ? `ChatGPT ${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : source,
    windows,
    ...(!windows.length && { message: 'Codex didn’t say how much of your plan is left.' }),
  };
}

/** How long a limit Codex reported stays fresh enough to show without asking again. */
const LIMITS_MS = 60_000;

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

// What neither way of running Codex uses: Conch brings apps, the browser,
// memory and the web, each asking as Conch does.
const SHARED_CONFIG = [
  'features.hooks=false',
  'features.skill_mcp_dependency_install=false',
  'project_doc_max_bytes=0',
  // Its own sub-agents (spawn_agent and the rest, both generations): work is handed
  // off as Conch's tasks instead (ADR 0033), seen, stopped and answered in Conch.
  'features.multi_agent=false',
  'features.multi_agent_v2=false',
  'features.apps=false',
  'features.browser_use=false',
  'features.computer_use=false',
  'features.view_image=false',
  'features.image_generation=false',
  'features.memories=false',
  'web_search="disabled"',
  // The profile below is the one every thread uses. (How it asks is set per thread:
  // `approvalPolicy: 'untrusted'` on thread/start; Codex no longer takes it in config.)
  'default_permissions="conch"',
];

// Codex: native tools stay in a read-only sandbox and are declined if they ask.
// All useful work goes through dynamic tools, which call Conch's guard every time.
const TOOL_CONFIG = [
  ...SHARED_CONFIG,
  'features.shell_tool=false',
  'features.unified_exec=false',
  'sandbox_mode="read-only"',
];

// A picture on the ChatGPT plan (`pictures.ts`): Codex's image tool and nothing else,
// no files to read or write and no network for anything but the model.
const PICTURE_CONFIG = [
  ...TOOL_CONFIG.filter((line) => !line.startsWith('features.image_generation=')),
  'features.image_generation=true',
  'permissions.conch.extends=":read-only"',
  'permissions.conch.filesystem={}',
  'permissions.conch.network={enabled=false}',
];

// A short answer for the small jobs around a chat (`complete.ts`): no tools at all,
// no files to read or write and no network for anything but the model.
const COMPLETE_CONFIG = [
  ...TOOL_CONFIG,
  'permissions.conch.extends=":read-only"',
  'permissions.conch.filesystem={}',
  'permissions.conch.network={enabled=false}',
];

/** How long whether the plan makes pictures is believed before asking Codex again. */
const PICTURES_MS = 10 * 60_000;

// Codex CLI (ADR 0066): its own shell and file edits, in a sandbox that writes
// only where Conch allows, reads nowhere secrets live, and has no network.
const AGENT_CONFIG = SHARED_CONFIG;

/** Where installs put programs, writable in Full trust with your home folder (ADR 0100). */
const OPEN_WRITES = ['/usr/local', '/opt/homebrew', '/opt/local'].filter((p) => existsSync(p));

/**
 * Why an approval request asks for more than "do this, in the sandbox": the
 * network, lasting write access somewhere else, or a retry outside the
 * sandbox after it blocked the command. Conch never grants any of these
 * (ADR 0066); undefined for an ordinary request.
 */
export function escapes(
  method: string,
  params: Record<string, unknown>,
  alreadyAsked: boolean,
): string | undefined {
  if (method === 'item/fileChange/requestApproval' && params.grantRoot)
    return 'Codex asked to write outside your work folder from now on. Conch never allows that.';
  if (method !== 'item/commandExecution/requestApproval') return undefined;
  const amendments = params.proposedNetworkPolicyAmendments;
  if (params.networkApprovalContext || (Array.isArray(amendments) && amendments.length))
    return 'Codex asked to reach the network. Its commands have no network in Conch.';
  if (alreadyAsked)
    return 'Codex asked to run that again outside its sandbox. Conch never allows that.';
  const reason = typeof params.reason === 'string' ? params.reason : '';
  if (
    /sandbox|escalat|outside|unrestricted|network|without (?:the )?(?:sandbox|restrictions)/i.test(
      reason,
    )
  )
    return 'Codex asked to run a command outside its sandbox. Conch never allows that.';
  return undefined;
}

/** What Codex CLI's command or change is, as Conch's guard and approval cards read a tool call. */
export function nativeRequest(
  method: string,
  params: Record<string, unknown>,
  item: Record<string, unknown> | undefined,
): PermissionRequest | undefined {
  const itemId = typeof params.itemId === 'string' ? params.itemId : undefined;
  if (method === 'item/commandExecution/requestApproval') {
    const command =
      typeof params.command === 'string'
        ? params.command
        : typeof item?.command === 'string'
          ? item.command
          : undefined;
    if (!command) return undefined;
    const cwd = typeof params.cwd === 'string' ? params.cwd : item?.cwd;
    return {
      toolName: 'Bash',
      ...(itemId && { toolUseId: itemId }),
      input: {
        command,
        ...(typeof cwd === 'string' && { cwd }),
        ...(params.kind === 'writeStdin' && { stdin: true }),
        ...(typeof params.reason === 'string' && { description: params.reason }),
      },
    };
  }
  if (method === 'item/fileChange/requestApproval') {
    const changes = Array.isArray(item?.changes) ? item.changes : [];
    const paths = changes.flatMap((change) => {
      const c = object(change);
      const moved = object(c.kind).move_path;
      return [c.path, moved].filter((p): p is string => typeof p === 'string' && p.length > 0);
    });
    const root = typeof params.grantRoot === 'string' ? params.grantRoot : undefined;
    if (!paths.length && !root) return undefined;
    return {
      toolName: 'Edit',
      ...(itemId && { toolUseId: itemId }),
      input: {
        file_path: paths[0] ?? root,
        ...(paths.length > 1 && { paths }),
        ...(root && { grant_root: root }),
      },
    };
  }
  return undefined;
}

export class CodexEngine implements Engine {
  readonly id: 'codex-cli' | 'codex-agent';
  readonly label: string;
  /** Codex's commands go through Conch's sealed tools; Codex CLI's run in Codex's own sandbox. */
  readonly commandSandbox?: 'conch';
  readonly integrations = { mode: 'bridge' as const };
  readonly hostTools = true;
  /** Codex's commands are Conch's, so they run where the chat's work runs; Codex CLI's are its own (ADR 0106). */
  readonly places: boolean;
  /** Its plan updates (`turn/plan/updated`) are drawn as Conch's checklist. */
  readonly plans = 'native' as const;
  /** A plan update's explanation, when it gives one, is said as narration (ADR 0103). */
  readonly narration = 'provider' as const;
  readonly attachments = { images: true, files: true };
  /**
   * Codex's own image tool, on the ChatGPT plan, for Conch's `image_generate`
   * (its chats keep the tool off: their pictures go through Conch's).
   */
  readonly pictures: PictureMaker = {
    available: () => this.#picturesAvailable(),
    make: (request) => this.#picture(request),
  };
  #canPicture?: { at: number; account: string; value: boolean };
  readonly #home: CodexHome;
  /** Threads carried on from one turn to the next (ADR 0066 § Carrying on). */
  readonly #threads: CodexThreads;
  #status?: EngineStatus;
  #at = 0;
  #caps?: Capabilities;
  #detecting?: Promise<EngineStatus>;
  #listing?: Promise<Capabilities>;
  /** The plan's limits as Codex last reported them: read, or sent during a turn. */
  #limits?: { value: EngineUsage; at: number };
  #limitsRead?: Promise<EngineUsage>;

  constructor(
    private readonly settings: SettingsStore,
    private readonly keys: ProviderKeys,
    private readonly explicitPath?: string,
    home = dirname(settings.workspaceDefault),
    /** `agent`: Codex CLI, with Codex's own tools (ADR 0066). */
    readonly variant: 'tools' | 'agent' = 'tools',
  ) {
    this.#home = new CodexHome(home);
    this.#threads = new CodexThreads(join(home, 'codex-sessions'));
    this.id = variant === 'agent' ? 'codex-agent' : 'codex-cli';
    this.places = variant !== 'agent';
    this.label = variant === 'agent' ? 'Codex CLI' : 'Codex';
    if (variant === 'tools') this.commandSandbox = 'conch';
  }

  /** The plan makes pictures when Codex says its provider can (`modelProvider/capabilities/read`). */
  async #picturesAvailable() {
    const status = await this.detect().catch(() => undefined);
    if (status?.state !== 'ready' || !status.executablePath || !status.auth) return undefined;
    const account = `${status.auth.method}:${status.auth.email ?? ''}`;
    const known = this.#canPicture;
    let value =
      known && known.account === account && Date.now() - known.at < PICTURES_MS
        ? known.value
        : undefined;
    if (value === undefined) {
      const executable = status.executablePath;
      value = await this.#home
        .withClient(executable, async (rpc) => {
          const caps = await rpc.request('modelProvider/capabilities/read', {}, 15_000);
          return (caps as { imageGeneration?: unknown } | null)?.imageGeneration === true;
        })
        // A Codex that can't say (older, or offline) isn't counted on for pictures.
        .catch(() => false);
      this.#canPicture = { at: Date.now(), account, value };
    }
    if (!value) return undefined;
    return status.auth.method === 'subscription'
      ? { cost: 'included' as const, by: 'your ChatGPT plan', to: 'OpenAI' }
      : { cost: 'paid' as const, by: 'OpenAI, through Codex', to: 'OpenAI' };
  }

  async #picture(request: PictureRequest) {
    const status = await this.detect();
    if (status.state !== 'ready' || !status.executablePath)
      throw new Error(status.message ?? 'Reconnect ChatGPT in Settings → Providers.');
    let home = '';
    return this.#home.withClient(
      status.executablePath,
      (rpc) => makeCodexPicture(rpc, request, home),
      {
        signal: request.signal,
        prepare: async (dir) => {
          home = dir;
        },
        config: PICTURE_CONFIG,
        // The picture comes back whole, in one message.
        maxLine: PICTURE_LINE,
      },
    );
  }

  /**
   * One short answer, in a thread of its own (`complete.ts`), for a story's
   * headline, "Why?" or a title (ADR 0103): on the person's ChatGPT plan or
   * key, with the lightest thinking the model offers.
   */
  async complete(input: CompletionInput): Promise<Completion> {
    const status = await this.detect();
    if (status.state !== 'ready' || !status.executablePath)
      throw new Error(status.message ?? 'Reconnect ChatGPT in Settings → Providers.');
    const caps = await this.capabilities().catch(() => undefined);
    const model = caps?.models.find((m) => m.id === input.model) ?? caps?.models[0];
    const effort = model?.efforts?.includes('low') ? 'low' : undefined;
    return this.#home.withClient(
      status.executablePath,
      (rpc) => completeWithCodex(rpc, input, effort ? { effort } : {}),
      { signal: input.signal, config: COMPLETE_CONFIG },
    );
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
      // One ChatGPT connection serves Codex and Codex CLI: the key is Codex's.
      const key = await this.keys.value('codex-cli', { peek: true });
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
  /** The chat was deleted: Conch's copy of its Codex thread goes with it. */
  async forgetSession(resumeId: string): Promise<void> {
    const kept = parseResumeId(resumeId);
    if (kept) await this.#threads.forget(kept.threadId);
  }
  async setApiKey(): Promise<void> {
    this.#status = undefined;
    this.#caps = undefined;
  }
  /**
   * Your ChatGPT plan's limits, as Codex's own `/status` shows them. Codex and
   * Codex CLI share the sign-in, so they share the limits. An API key has none:
   * Conch counts what it spends.
   */
  async usage({ force = false } = {}): Promise<EngineUsage> {
    if (!force && this.#limits && Date.now() - this.#limits.at < LIMITS_MS)
      return this.#limits.value;
    const status = await this.detect();
    const source = status.auth?.description ?? this.label;
    if (status.state !== 'ready' || !status.executablePath)
      return { kind: 'unknown', source, windows: [] };
    if (status.auth?.method === 'api-key') return { kind: 'metered', source, windows: [] };
    const executable = status.executablePath;
    this.#limitsRead ??= this.#home
      .withClient(executable, (rpc) =>
        rpc.request('account/rateLimits/read', { excludeResetCreditDetails: true }),
      )
      .then((result) => {
        const value = codexUsage(result, source);
        this.#limits = { value, at: Date.now() };
        return value;
      })
      .finally(() => {
        this.#limitsRead = undefined;
      });
    return this.#limitsRead;
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
      // Codex summarises its own thread when asked (`thread/compact/start`).
      commands: [
        {
          name: 'compact',
          description: 'Summarise the conversation so far, to make room',
          argumentHint: '',
        },
      ],
      // Every mode, Auto through Conch's risk policy (ADR 0100).
      permissionModes: [...ALL_MODES],
      tools: { host: true, files: true, shell: true, approvals: true },
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
    /** What the thread had used before this turn's first request. */
    let before:
      Required<Pick<Usage, 'inputTokens' | 'outputTokens' | 'cachedInputTokens'>> | undefined;
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
      const agent = this.variant === 'agent';
      // A screenshot goes back as a picture to a model that takes them (every
      // Codex model so far); one that doesn't gets it in words (ADR 0070).
      const sees =
        (await this.capabilities().catch(() => undefined))?.models.find(
          (m) => m.id === input.options.model,
        )?.images ?? true;
      const tools = withSight(buildTools({ ...input, signal }, { computer: !agent, bare: true }), {
        sees: () => sees,
        ...(input.describe && { describe: input.describe }),
        signal,
      });
      // The thread this chat had, carried on while its tools are the same (Codex
      // can't be given new ones: ADR 0036). Otherwise a new one, with the handoff.
      const toolsKey = toolsDigest(
        this.variant,
        [...tools.values()].map((tool) => ({ name: tool.spec.name, schema: tool.spec.schema })),
      );
      const wanted = parseResumeId(input.resumeId);
      const kept =
        wanted && wanted.tools === toolsKey ? await this.#threads.meta(wanted.threadId) : undefined;
      const instructions = digest(input.systemAppend);
      let restored = false;
      let threadId = '';
      // One entry per path: Codex reads this as a TOML table, and a path twice is an error that
      // stops it before it answers. Where a path is both written and denied, the deny stands.
      const modes = new Map<string, 'write' | 'deny'>();
      // Codex CLI's sandbox for this turn's mode (ADR 0100). Full trust: your folders and the
      // network, as you'd have them; Auto: the work folder and the network; otherwise sealed.
      const reach = agent ? (input.reach ?? 'sealed') : 'sealed';
      const secrets = new Set(secretPlaces().map((p) => p.path));
      if (agent) for (const p of input.sandbox?.allowWrite ?? []) modes.set(p, 'write');
      if (reach === 'open')
        for (const p of [homedir(), tmpdir(), '/tmp', ...OPEN_WRITES]) modes.set(p, 'write');
      for (const p of [
        ...(input.protectedPaths ?? []),
        this.#home.home,
        // Full trust reads your keys as you would (a push over SSH); Conch's own stay out.
        ...(input.sandbox?.denyRead ?? []).filter((p) => reach !== 'open' || !secrets.has(p)),
      ])
        modes.set(p, 'deny');
      const profile = [...modes].map(([p, mode]) => `${JSON.stringify(p)}="${mode}"`).join(',');
      /** Codex CLI's own commands and changes, by item id, as Codex announced them. */
      const items = new Map<string, Record<string, unknown>>();
      /** Items already asked about: a second request for one is Codex wanting out of its sandbox. */
      const asked = new Set<string>();
      /**
       * Codex CLI asks before a command or a change (ADR 0066): the protected
       * places first, then Conch's guard in every mode (ADR 0028), then the
       * chat's mode, then the person.
       */
      const decide = async (
        method: string,
        params: Record<string, unknown>,
      ): Promise<'accept' | 'decline'> => {
        const itemId = typeof params.itemId === 'string' ? params.itemId : '';
        const again = Boolean(itemId) && asked.has(itemId);
        if (itemId) asked.add(itemId);
        // More than "this, in the sandbox" is never granted, whatever the mode.
        const escape = escapes(method, params, again);
        if (escape) {
          emit({ type: 'notice', code: 'sandbox', message: escape });
          return 'decline';
        }
        const request = nativeRequest(
          method,
          params,
          typeof params.itemId === 'string' ? items.get(params.itemId) : undefined,
        );
        if (!request) return 'decline';
        if (touchesProtected(request.input, input.protectedPaths ?? [])) {
          emit({ type: 'notice', code: 'protected', message: PROTECTED_MESSAGE });
          return 'decline';
        }
        const verdict = await input.guard?.(request);
        if (verdict?.decision === 'deny') return 'decline';
        const change = request.toolName === 'Edit';
        const mode = input.options.permissionMode;
        if (verdict?.decision !== 'ask') {
          if (mode === 'plan') return 'decline';
          // Full trust and Auto: the guard above already stopped anything serious (ADR 0100).
          if (mode === 'bypassPermissions' || mode === 'auto') return 'accept';
          if (mode === 'acceptEdits' && change) return 'accept';
        }
        const decision = await input.requestPermission(request, signal);
        return decision === 'deny' ? 'decline' : 'accept';
      };
      await this.#home.withClient(
        status.executablePath,
        async (rpc) => {
          let turnId = '';
          const pendingTools = new Set<Promise<void>>();
          const toolQueue = new ToolQueue();
          const invoked = new Set<string>();
          const providerTools = new CodexToolEvents(new Set(tools.keys()));
          let complete!: () => void;
          let fail!: (error: Error) => void;
          const done = new Promise<void>((resolve, reject) => {
            complete = resolve;
            fail = reject;
          });
          void done.catch(() => {});
          rpc.onFailure(fail);
          /** `/compact`: Codex summarises the thread so far instead of taking a turn. */
          const compacting = /^\/compact(\s|$)/i.test(input.prompt.trim());
          let compacted = false;
          const onMessage = (message: RpcMessage) => {
            const p = object(message.params);
            if (
              compacting &&
              !compacted &&
              (message.method === 'thread/compacted' ||
                (message.method === 'item/completed' &&
                  object(p.item).type === 'contextCompaction'))
            ) {
              compacted = true;
              emit({ type: 'compacted', summary: '', turns: 0 });
              complete();
            }
            if (message.id !== undefined && message.method) {
              // Native clock requests use the same guarded, receipted host tool.
              if (message.method === 'currentTime/read') {
                const requestId = message.id;
                const id = `clock:${typeof requestId}:${requestId}`;
                const clock = tools.get('conch__current_time');
                if (
                  !threadId ||
                  p.threadId !== threadId ||
                  !clock ||
                  signal.aborted ||
                  invoked.has(id) ||
                  invoked.size >= 512
                ) {
                  rpc.send({
                    id: requestId,
                    error: { code: -32602, message: 'Invalid or unavailable clock request.' },
                  });
                  return;
                }
                invoked.add(id);
                const job = toolQueue.run(clock.display, async () => {
                  await publish({
                    type: 'tool-start',
                    toolUseId: id,
                    name: clock.display,
                    input: {},
                  });
                  try {
                    signal.throwIfAborted();
                    const result = await clock.run({}, id);
                    if (result.isError) throw new Error(result.text);
                    const sample = z
                      .object({ current_time_at: z.number().int() })
                      .safeParse(JSON.parse(result.text));
                    if (!sample.success)
                      throw new Error('Clock observation failed. Call current_time again.');
                    await publish({
                      type: 'tool-end',
                      toolUseId: id,
                      status: 'success',
                      output: result.text,
                    });
                    if (!signal.aborted)
                      rpc.send({
                        id: requestId,
                        result: { currentTimeAt: sample.data.current_time_at },
                      });
                  } catch (error) {
                    const output = failureText(error);
                    await publish({
                      type: 'tool-end',
                      toolUseId: id,
                      status: 'error',
                      output,
                    });
                    if (!signal.aborted)
                      rpc.send({
                        id: requestId,
                        error: { code: -32603, message: output },
                      });
                  }
                });
                pendingTools.add(job);
                void job.finally(() => pendingTools.delete(job)).catch(fail);
                return;
              }
              if (message.method === 'item/tool/call') {
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
                const job = toolQueue.run(tool?.display, async () => {
                  signal.throwIfAborted();
                  await publish({
                    type: 'tool-start',
                    toolUseId: call.callId,
                    name: tool?.display ?? call.tool,
                    input: call.arguments,
                  });
                  let text = 'This tool is not enabled in this conversation.';
                  let isError = true;
                  let view: ToolView | undefined;
                  let images: readonly ToolImage[] = [];
                  try {
                    if (tool) {
                      signal.throwIfAborted();
                      const result = await tool.run(call.arguments, call.callId);
                      text = result.text;
                      isError = result.isError;
                      view = result.isError ? undefined : result.view;
                      images = result.images ?? [];
                    }
                  } catch (error) {
                    // What went wrong, as it was said (ADR 0102).
                    text = signal.aborted ? 'Stopped.' : failureText(error);
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
                      result: {
                        success: !isError,
                        // The app server takes pictures back from a tool as `inputImage`.
                        contentItems: [
                          { type: 'inputText', text },
                          ...images.map((image) => ({
                            type: 'inputImage',
                            imageUrl: `data:${image.mimeType};base64,${image.data}`,
                          })),
                        ],
                      },
                    });
                });
                pendingTools.add(job);
                void job.catch(fail).finally(() => pendingTools.delete(job));
              } else if (
                agent &&
                (message.method === 'item/commandExecution/requestApproval' ||
                  message.method === 'item/fileChange/requestApproval')
              ) {
                // Codex CLI's own command or change: Conch decides, in order.
                const id = message.id;
                void decide(message.method, p)
                  .catch(() => 'decline' as const)
                  .then((decision) => {
                    if (!signal.aborted) rpc.send({ id, result: { decision } });
                  });
              } else if (message.method.endsWith('/requestApproval')) {
                // Anything else asking for more (permissions, a network rule) gets nothing.
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
            if (turnId && typeof p.turnId === 'string' && p.turnId !== turnId) return;
            if (message.method === 'item/agentMessage/delta' && typeof p.delta === 'string')
              emit({ type: 'text', messageId: String(p.itemId), delta: p.delta });
            if (message.method === 'item/reasoning/summaryTextDelta' && typeof p.delta === 'string')
              emit({ type: 'thinking', messageId: String(p.itemId), delta: p.delta });
            if (message.method === 'item/completed' && object(p.item).type === 'agentMessage')
              emit({ type: 'message-done', messageId: String(object(p.item).id) });
            for (const event of providerTools.read(message.method, p, invoked)) emit(event);
            // Codex CLI's own commands and changes, drawn as tool cards like Claude Code's.
            if (
              agent &&
              (message.method === 'item/started' || message.method === 'item/completed')
            ) {
              const item = object(p.item);
              const id = typeof item.id === 'string' ? item.id : '';
              const kind = item.type;
              if (id && (kind === 'commandExecution' || kind === 'fileChange')) {
                items.set(id, item);
                const shown = nativeRequest(
                  kind === 'commandExecution'
                    ? 'item/commandExecution/requestApproval'
                    : 'item/fileChange/requestApproval',
                  { itemId: id },
                  item,
                );
                if (message.method === 'item/started' && shown)
                  emit({
                    type: 'tool-start',
                    toolUseId: id,
                    name: shown.toolName,
                    input: shown.input,
                  });
                if (message.method === 'item/completed') {
                  const ok =
                    item.status === 'completed' &&
                    (kind !== 'commandExecution' || item.exitCode === 0 || item.exitCode === null);
                  const output =
                    kind === 'commandExecution'
                      ? typeof item.aggregatedOutput === 'string'
                        ? item.aggregatedOutput.slice(-8_000)
                        : ''
                      : item.status === 'declined'
                        ? 'Not changed: it wasn’t allowed.'
                        : '';
                  emit({
                    type: 'tool-end',
                    toolUseId: id,
                    status: ok ? 'success' : 'error',
                    output:
                      item.status === 'declined' && kind === 'commandExecution'
                        ? 'Not run: it wasn’t allowed.'
                        : output,
                    ...(item.status === 'declined' && { refused: true as const }),
                  });
                  items.delete(id);
                }
              }
            }
            // Limits move as the turn spends them: kept, so the meter shows them when it next looks.
            if (message.method === 'account/rateLimits/updated') {
              const value = codexUsage(p, this.#limits?.value.source ?? this.label);
              if (value.kind === 'plan') this.#limits = { value, at: Date.now() };
            }
            if (message.method === 'turn/plan/updated') {
              const steps = codexPlan(p.plan);
              if (steps) emit({ type: 'plan', steps });
              // Why the plan changed, in its words for the person watching (ADR 0103).
              if (typeof p.explanation === 'string' && p.explanation.trim())
                emit({ type: 'narration', text: p.explanation });
            }
            if (message.method === 'thread/tokenUsage/updated') {
              // Codex's `total` is the whole thread's, every earlier turn included, and
              // its input counts what the provider's cache served. This turn's share is
              // the total less what the thread had before this turn's first request
              // (that request's total minus its own `last`), with the cached part named,
              // so a long chat never starts a turn already over its budget.
              const counts = z.object({
                inputTokens: z.number().nonnegative(),
                outputTokens: z.number().nonnegative(),
                cachedInputTokens: z.number().nonnegative().optional(),
                totalTokens: z.number().nonnegative().optional(),
              });
              const total = counts.safeParse(object(p.tokenUsage).total);
              const last = counts.safeParse(object(p.tokenUsage).last);
              // How full the thread is: its latest request, read and answered, of the window.
              const window = z
                .number()
                .int()
                .positive()
                .safeParse(object(p.tokenUsage).modelContextWindow);
              const context = last.success
                ? {
                    used: last.data.totalTokens ?? last.data.inputTokens + last.data.outputTokens,
                    ...(window.success && { window: window.data }),
                  }
                : undefined;
              if (total.success) {
                before ??= {
                  inputTokens: Math.max(0, total.data.inputTokens - (last.data?.inputTokens ?? 0)),
                  outputTokens: Math.max(
                    0,
                    total.data.outputTokens - (last.data?.outputTokens ?? 0),
                  ),
                  cachedInputTokens: Math.max(
                    0,
                    (total.data.cachedInputTokens ?? 0) - (last.data?.cachedInputTokens ?? 0),
                  ),
                };
                const cached = Math.max(
                  0,
                  (total.data.cachedInputTokens ?? 0) - (before.cachedInputTokens ?? 0),
                );
                usage = {
                  inputTokens: Math.max(0, total.data.inputTokens - before.inputTokens),
                  outputTokens: Math.max(0, total.data.outputTokens - before.outputTokens),
                  ...(cached > 0 && { cachedInputTokens: cached }),
                };
                // A running total, so an unattended run can stop at its limit (ADR 0057).
                emit({ type: 'usage', usage, ...(context && { context }) });
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
          const trust = { [`projects.${JSON.stringify(input.cwd)}.trust_level`]: 'untrusted' };
          // Carry on the chat's thread: the same tools (checked above), asking as
          // every thread does, in the same sealed profile (set per run, below).
          let resumed = false;
          if (restored && wanted)
            try {
              const thread = object(
                object(
                  await rpc.request('thread/resume', {
                    threadId: wanted.threadId,
                    cwd: input.cwd,
                    ...(input.options.model && { model: input.options.model }),
                    approvalPolicy: 'untrusted',
                    permissions: 'conch',
                    config: trust,
                    excludeTurns: true,
                  }),
                ).thread,
              );
              resumed = thread.id === wanted.threadId;
            } catch {
              // Codex couldn't read it back (a newer format, a damaged file): a new one, below.
            }
          if (resumed && wanted) threadId = wanted.threadId;
          else {
            if (wanted) await this.#threads.forget(wanted.threadId);
            const started = object(
              await rpc.request('thread/start', {
                cwd: input.cwd,
                environments: [],
                model: input.options.model,
                approvalPolicy: 'untrusted',
                permissions: 'conch',
                config: trust,
                developerInstructions: input.systemAppend,
                allowProviderModelFallback: false,
                // Kept, so the next turn can carry it on (`threads.ts`).
                ephemeral: false,
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
          }
          emit({
            type: 'session',
            resumeId: resumeIdFor(threadId, toolsKey),
            // It should have carried on and couldn't: healed, with the whole conversation.
            ...(input.resumeId &&
              !resumed &&
              (!wanted || wanted.tools === toolsKey) && { restarted: 'lost' as const }),
          });
          if (compacting) {
            if (resumed) await rpc.request('thread/compact/start', { threadId });
            else {
              const said = newId('msg');
              emit({
                type: 'text',
                messageId: said,
                delta: 'There’s nothing to summarise yet: this conversation is just getting going.',
              });
              emit({ type: 'message-done', messageId: said });
              complete();
            }
            await done;
            return;
          }
          // A carried-on thread gets what it missed; a new one, the whole conversation.
          const text = resumed ? input.prompt : (input.freshPrompt ?? input.prompt);
          const startedTurn = object(
            await rpc.request('turn/start', {
              threadId,
              environments: [],
              // Codex keeps a thread's instructions from when it started: when Conch's
              // have changed since (a memory, a setting), the new ones go with the turn.
              ...(resumed &&
                kept?.instructions !== instructions && {
                  additionalContext: {
                    conch: {
                      kind: 'application',
                      value: `Conch's instructions for this conversation, as they are now. They replace the earlier ones.\n\n${input.systemAppend}`,
                    },
                  },
                }),
              input: [
                { type: 'text', text },
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
          // The provider may finish before yielded tools return. Stop must still
          // release the run (and its temporary home) while those tools wind down.
          let stopWaiting!: () => void;
          const stopped = new Promise<void>((resolve) => {
            stopWaiting = resolve;
          });
          signal.addEventListener('abort', interrupt, { once: true });
          signal.addEventListener('abort', stopWaiting, { once: true });
          if (signal.aborted) stopWaiting();
          try {
            await Promise.race([
              done.then(async () => {
                await Promise.all(pendingTools);
              }),
              stopped,
            ]);
          } finally {
            signal.removeEventListener('abort', interrupt);
            signal.removeEventListener('abort', stopWaiting);
          }
        },
        {
          signal,
          ...(kept &&
            wanted && {
              prepare: async (home: string) => {
                restored = await this.#threads.restore(wanted.threadId, home);
              },
            }),
          after: async (home: string) => {
            if (threadId) await this.#threads.keep(threadId, home, instructions);
          },
          config: [
            ...(agent ? AGENT_CONFIG : TOOL_CONFIG),
            `permissions.conch.extends="${agent ? ':workspace' : ':read-only'}"`,
            `permissions.conch.filesystem={${profile}}`,
            `permissions.conch.network={enabled=${reach !== 'sealed'}}`,
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
