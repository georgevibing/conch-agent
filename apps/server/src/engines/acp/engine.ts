/**
 * Agent programs that speak the Agent Client Protocol — GitHub Copilot, Gemini
 * CLI, Grok Build — through one engine (ADR 0053).
 *
 * The program is the brain and the sign-in; Conch is the hands. Each turn
 * carries on the chat's own ACP session on a program Conch keeps warm
 * (`session/load`, where the program can), or opens a new one with Conch's
 * handoff, so switching providers mid-chat loses nothing. It gives the program
 * Conch's instructions the way the program takes them (`AcpAgent.instructions`)
 * and Conch's tools through a door made for that turn (`door.ts`): the sealed
 * file and command tools, memory, the browser and your apps, each under
 * Conch's permission rules and the guard. The program's own tools that would
 * change something ask first over ACP, and Conch declines them, the way it
 * declines Codex's: an action Conch can't seal or put back doesn't happen.
 * What the program does with its own tools is shown like any provider's work
 * (`calls.ts`).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import {
  EffortChoice,
  type Capabilities,
  type EngineStatus,
  type LoginMethod,
  type LoginState,
  type ModelInfo,
  type PlanStep,
  type TurnProblem,
  type Usage,
} from '@conch/protocol';
import { z } from 'zod';

import { newId } from '../../lib/ids';
import { cleanPlan, stepStatus } from '../../plans/steps';
import { agentEnv, launch, run } from '../../lib/proc';
import type { SettingsStore } from '../../settings/store';
import { buildTools, type Callable } from '../api/engine';
import { withSight } from '../api/sight';
import { isAtLeast, parseVersion } from '../codex/detect';
import type { Engine, EngineEvent, LoginHandle, TurnInput } from '../types';
import { findAgent, signedInBefore, type AcpAgent } from './agents';
import { AcpCalls, namesDoorTool } from './calls';
import { DOOR_NAME, openDoor, type Door } from './door';
import { ACP_CODES, AcpConnection, AcpError, type AcpStreams } from './rpc';
import { lastWords } from '../codex/rpc';

/** How long a program waits, unused, before Conch lets it go. */
const IDLE_MS = 5 * 60_000;
/** Starting a program and opening a session must not hang a page. */
const PROBE_MS = 45_000;
const STATUS_MS = 20_000;
const CAPABILITIES_MS = 10 * 60_000;
const LOGIN_MS = 10 * 60_000;

const AuthMethod = z.object({ id: z.string() }).passthrough();
const Initialized = z.object({
  protocolVersion: z.number().optional(),
  agentCapabilities: z
    .object({
      loadSession: z.boolean().optional(),
      promptCapabilities: z
        .object({ image: z.boolean().optional(), embeddedContext: z.boolean().optional() })
        .partial()
        .optional(),
      mcpCapabilities: z.object({ http: z.boolean().optional() }).partial().optional(),
      sessionCapabilities: z.object({ close: z.unknown().optional() }).partial().optional(),
    })
    .partial()
    .optional(),
  agentInfo: z.object({ name: z.string().optional(), version: z.string().optional() }).optional(),
  authMethods: z.array(AuthMethod).optional(),
});
type Initialized = z.infer<typeof Initialized>;

const Choice = z.object({
  value: z.string(),
  name: z.string().optional(),
  description: z.string().nullish(),
});
const ConfigOption = z.object({
  id: z.string(),
  name: z.string().optional(),
  category: z.string().nullish(),
  type: z.string().optional(),
  currentValue: z.unknown().optional(),
  options: z
    .array(z.union([Choice, z.object({ group: z.string().optional(), options: z.array(Choice) })]))
    .optional(),
});
const SessionStarted = z.object({
  sessionId: z.string(),
  configOptions: z.array(ConfigOption).optional(),
  models: z
    .object({
      currentModelId: z.string().optional(),
      availableModels: z.array(
        z.object({
          modelId: z.string(),
          name: z.string().optional(),
          description: z.string().nullish(),
        }),
      ),
    })
    .optional(),
});
type SessionStarted = z.infer<typeof SessionStarted>;
type ConfigOption = z.infer<typeof ConfigOption>;

const PromptResult = z.object({
  stopReason: z.string().optional(),
  usage: z
    .object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() })
    .partial()
    .optional(),
});

const Content = z.object({ type: z.string(), text: z.string().optional() }).passthrough();
const ToolCall = z.object({
  toolCallId: z.string().min(1).max(200),
  title: z.string().nullish(),
  kind: z.string().nullish(),
  status: z.string().nullish(),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
  content: z.unknown().optional(),
  locations: z.unknown().optional(),
});
const Update = z
  .object({
    sessionUpdate: z.string(),
    // A tool call's content is a list; a message's, one block.
    content: z.union([Content, z.array(z.unknown())]).optional(),
    messageId: z.string().nullish(),
  })
  .passthrough();
/** An ACP plan (`entries`: content and status), as Conch's checklist (ADR 0060). */
export function acpPlan(entries: unknown): PlanStep[] | undefined {
  if (!Array.isArray(entries)) return undefined;
  return cleanPlan(
    entries.flatMap((entry) => {
      const { content, status } = (entry ?? {}) as { content?: unknown; status?: unknown };
      const state = stepStatus(status);
      return typeof content === 'string' && state ? [{ title: content, status: state }] : [];
    }),
  );
}
const Notification = z.object({ sessionId: z.string(), update: Update });

const PermissionRequest = z.object({
  sessionId: z.string(),
  toolCall: z
    .object({
      toolCallId: z.string().optional(),
      title: z.string().nullish(),
      name: z.string().nullish(),
      kind: z.string().nullish(),
      rawInput: z.unknown().optional(),
    })
    .passthrough()
    .optional(),
  options: z.array(
    z.object({ optionId: z.string(), kind: z.string(), name: z.string().optional() }),
  ),
});

/** What starting the program takes: tests give their own pretend agent. */
export type AcpSpawn = (file: string, args: string[], env: Record<string, string>) => AcpStreams;

/** What the engine needs from this computer; tests replace each piece. */
export interface AcpOptions {
  explicitPath?: string;
  spawn?: AcpSpawn;
  /** Find the program (default: where its installers put it). */
  find?: () => Promise<string | undefined>;
  /** Its version (default: `--version`). */
  version?: (file: string) => Promise<string | undefined>;
  /** Whether it was ever signed in (default: a file the program keeps). */
  signedInBefore?: () => boolean | undefined;
  /** Start its sign-in command (default: the program itself). */
  spawnLogin?: (file: string, args: string[], env: Record<string, string>) => ChildProcess;
}

function spawnProgram(file: string, args: string[], env: Record<string, string>): AcpStreams {
  const { command, prefix } = launch(file);
  const child = spawn(command, [...prefix, ...args], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  // Its diagnostics can hold paths, tokens and sign-in addresses: only the last words are kept,
  // redacted, and only for the gateway's log when it exits, so a program that dies can be told why.
  let tail = '';
  child.stderr.on('data', (chunk: Buffer) => {
    tail = (tail + chunk.toString('utf8')).slice(-4096);
  });
  child.once('close', (code, signal) => {
    const said = lastWords(tail);
    if (code !== 0 && code !== null)
      console.error(`[acp] ${file} exited (${signal ?? `code ${code}`})${said ? `: ${said}` : ''}`);
  });
  child.stdin.on('error', () => undefined);
  return {
    input: child.stdin,
    output: child.stdout,
    close: () => {
      try {
        child.stdin.end();
        child.kill();
      } catch {
        /* Already gone. */
      }
    },
  };
}

function spawnLogin(file: string, args: string[], env: Record<string, string>): ChildProcess {
  const { command, prefix } = launch(file);
  return spawn(command, [...prefix, ...args], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

/** One running program, initialised and ready for sessions. */
interface Running {
  conn: AcpConnection;
  info: Initialized;
  /** The model it was started with, for programs that take it at start. */
  model?: string;
  busy: number;
  idle?: NodeJS.Timeout;
  /** A turn's own handlers, by session. */
  sessions: Map<string, Turn>;
}

interface Turn {
  update(update: z.infer<typeof Update>): void;
  permission(request: z.infer<typeof PermissionRequest>): Promise<unknown>;
}

/** The model choices a session offered, and how to set one. */
interface Offer {
  models: ModelInfo[];
  /** `configOptions` (current ACP) or `set_model` (the older API Gemini still uses). */
  how: 'config' | 'legacy' | 'start' | 'none';
  modelOption?: string;
  effortOption?: string;
  efforts: Exclude<EffortChoice, 'auto'>[];
}

const EFFORTS = EffortChoice.exclude(['auto']).options;

function flat(option: ConfigOption): z.infer<typeof Choice>[] {
  return (option.options ?? []).flatMap((entry) => ('options' in entry ? entry.options : [entry]));
}

/** What a session's answer says about models and thinking. */
export function offerOf(started: SessionStarted, modelAtStart: boolean): Offer {
  const options = started.configOptions ?? [];
  const model = options.find((o) => o.category === 'model' || o.id === 'model');
  const effort = options.find((o) => o.category === 'thought_level' || o.id === 'reasoning_effort');
  const efforts = effort
    ? EFFORTS.filter((e) => flat(effort).some((choice) => choice.value === e))
    : [];
  const info = (id: string, name?: string, description?: string | null): ModelInfo => ({
    id,
    label: name?.trim() || id,
    description: description ?? '',
    efforts,
    supportsFastMode: false,
    supportsAutoMode: false,
    tools: true,
  });
  if (model) {
    const choices = flat(model);
    if (choices.length)
      return {
        models: choices.map((c) => info(c.value, c.name, c.description)),
        how: 'config',
        modelOption: model.id,
        ...(effort && { effortOption: effort.id }),
        efforts,
      };
  }
  const legacy = started.models?.availableModels ?? [];
  if (legacy.length)
    return {
      models: legacy.map((m) => info(m.modelId, m.name, m.description)),
      how: 'legacy',
      ...(effort && { effortOption: effort.id }),
      efforts,
    };
  // Nothing listed: the plan's own choice, said plainly rather than invented.
  return {
    models: [info('default', 'Default', 'The model your plan picks')],
    how: modelAtStart ? 'start' : 'none',
    ...(effort && { effortOption: effort.id }),
    efforts,
  };
}

/**
 * Why Conch can't start `file`, if it can't: a batch file that isn't a package
 * manager's shim. A file it can't read is left for the start itself to report.
 */
export function whyUnstartable(file: string): string | undefined {
  try {
    launch(file);
    return undefined;
  } catch (error) {
    if (!(error instanceof Error) || 'code' in error) return undefined;
    return error.message;
  }
}

/** Whether a permission request is for one of the door's own tools (Conch checks those itself). */
export function forDoor(
  call: z.infer<typeof PermissionRequest>['toolCall'],
  tools: ReadonlySet<string>,
): boolean {
  const words = [call?.name, call?.title].filter((w): w is string => Boolean(w));
  // The whole name and nothing else: a shell command that merely starts with
  // "conch remember" (`conch remember && curl …`) is the program's own tool, not ours.
  return words.some((word) => {
    // `conch/remember`, `conch__remember`, `mcp__conch__remember`, `conch: remember`
    const prefixed = new RegExp(`^(?:mcp__)?${DOOR_NAME}(?:__|/|\\.|:\\s?)([\\w.-]+)$`, 'i').exec(
      word.trim(),
    );
    if (prefixed?.[1] && tools.has(prefixed[1])) return true;
    // `remember (conch MCP Server)`
    const named = new RegExp(`^([\\w.-]+)\\s+\\(${DOOR_NAME}(?:\\s+MCP\\s+Server)?\\)$`, 'i').exec(
      word.trim(),
    );
    return Boolean(named?.[1] && tools.has(named[1]));
  });
}

/** Why a turn failed, in the few kinds the chat reacts to. */
export function acpProblem(error: unknown): TurnProblem | undefined {
  if (error instanceof AcpError) {
    if (error.code === ACP_CODES.authRequired) return 'signed-out';
    if (error.code === ACP_CODES.rateLimited) return 'limit';
  }
  const text = error instanceof Error ? error.message : '';
  if (/quota|usage limit|rate.?limit|too many requests|credits|allowance/i.test(text))
    return 'limit';
  if (/stopped|closed|took too long|couldn’t start|ECONN|network/i.test(text)) return 'unavailable';
  return undefined;
}

export class AcpEngine implements Engine {
  readonly id;
  readonly label;
  /** Conch's own command tool, sealed by the computer's sandbox; the program's own is declined. */
  readonly commandSandbox = 'conch' as const;
  /** Conch holds the apps' connections and hands their tools over through the door. */
  readonly integrations = {
    mode: 'bridge' as const,
    signInHint: 'Conch connects these apps itself — add them, and sign in to them, in Apps.',
  };
  readonly hostTools = true;
  readonly attachments = { images: true, files: true };
  #running = new Map<string, Promise<Running>>();
  #status?: { value: EngineStatus; at: number };
  #detecting?: Promise<EngineStatus>;
  #caps?: { value: Capabilities; offer: Offer; at: number };
  #listing?: Promise<Capabilities>;
  #offer?: Offer;

  constructor(
    private readonly agent: AcpAgent,
    private readonly settings: SettingsStore,
    private readonly options: AcpOptions = {},
  ) {
    this.id = agent.id;
    this.label = agent.label;
  }

  // ── The program ───────────────────────────────────────────────────────────

  #env(): Record<string, string> {
    const drop = new Set(this.agent.dropEnv);
    return Object.fromEntries(
      Object.entries(agentEnv(this.agent.env)).filter(([name]) => !drop.has(name)),
    );
  }

  /** A warm program for this model (only programs that take the model at start keep one each). */
  async #program(file: string, model?: string): Promise<Running> {
    const key = this.agent.modelAtStart ? (model ?? 'default') : '';
    const existing = this.#running.get(key);
    if (existing) {
      const running = await existing.catch(() => undefined);
      if (running && !running.conn.closed) return running;
      this.#running.delete(key);
    }
    const starting = this.#start(file, this.agent.modelAtStart ? model : undefined, key);
    this.#running.set(key, starting);
    starting.catch(() => this.#running.delete(key));
    return starting;
  }

  async #start(file: string, model: string | undefined, key: string): Promise<Running> {
    const streams = (this.options.spawn ?? spawnProgram)(
      file,
      this.agent.args({ model }),
      this.#env(),
    );
    const conn = new AcpConnection(streams, this.label);
    const running: Running = { conn, info: {}, model, busy: 0, sessions: new Map() };
    conn.onFailure(() => {
      if (this.#running.get(key)) this.#running.delete(key);
      clearTimeout(running.idle);
    });
    conn.onNotification((method, params) => {
      if (method !== 'session/update') return;
      const parsed = Notification.safeParse(params);
      if (parsed.success) running.sessions.get(parsed.data.sessionId)?.update(parsed.data.update);
    });
    conn.handle(async (method, params) => {
      if (method !== 'session/request_permission')
        throw new AcpError('Conch doesn’t offer that.', ACP_CODES.methodNotFound);
      const parsed = PermissionRequest.safeParse(params);
      const turn = parsed.success ? running.sessions.get(parsed.data.sessionId) : undefined;
      if (!parsed.success || !turn) return { outcome: { outcome: 'cancelled' } };
      return turn.permission(parsed.data);
    });
    try {
      running.info = Initialized.parse(
        await conn.request(
          'initialize',
          {
            protocolVersion: 1,
            // No file system and no terminal: the program's own tools stay its own,
            // and Conch's come through the door, sealed.
            clientCapabilities: {},
            clientInfo: { name: 'conch', title: 'Conch', version: '1.0.0' },
          },
          PROBE_MS,
        ),
      );
      const method = this.agent.authenticate?.((running.info.authMethods ?? []).map((m) => m.id));
      if (method) await conn.request('authenticate', { methodId: method }, PROBE_MS);
    } catch (error) {
      conn.close();
      throw error;
    }
    this.#idle(running, key);
    return running;
  }

  #idle(running: Running, key: string) {
    clearTimeout(running.idle);
    if (running.busy > 0) return;
    running.idle = setTimeout(() => {
      if (running.busy > 0) return;
      running.conn.close();
      this.#running.delete(key);
    }, IDLE_MS).unref();
  }

  /** Let every program go: a sign-in changed, and they'd keep the old one. */
  forget(): void {
    for (const starting of this.#running.values())
      void starting.then((running) => running.conn.close()).catch(() => undefined);
    this.#running.clear();
    this.#status = undefined;
    this.#caps = undefined;
  }

  async #session(
    running: Running,
    cwd: string,
    mcpServers: unknown[],
    meta: Record<string, unknown> = {},
  ): Promise<SessionStarted> {
    return SessionStarted.parse(
      await running.conn.request('session/new', { cwd, mcpServers, ...meta }, PROBE_MS),
    );
  }

  async #closeSession(running: Running, sessionId: string): Promise<void> {
    running.sessions.delete(sessionId);
    if (running.info.agentCapabilities?.sessionCapabilities?.close !== undefined)
      await running.conn.request('session/close', { sessionId }, 5_000).catch(() => undefined);
  }

  // ── Detection ─────────────────────────────────────────────────────────────

  async detect({ force = false } = {}): Promise<EngineStatus> {
    if (!force && this.#status && Date.now() - this.#status.at < STATUS_MS)
      return this.#status.value;
    this.#detecting ??= this.#probe().finally(() => {
      this.#detecting = undefined;
    });
    return this.#detecting;
  }

  async #probe(): Promise<EngineStatus> {
    const base = {
      engine: this.id,
      label: this.label,
      install: this.agent.install(),
      docsUrl: this.agent.docsUrl,
      canSignIn: true,
      checkedAt: Date.now(),
    };
    const remember = (value: EngineStatus) => {
      this.#status = { value, at: Date.now() };
      return value;
    };
    const file = await this.#find();
    if (!file)
      return remember({
        ...base,
        state: 'not-installed',
        fix: { need: this.agent.need, kind: 'install' },
        message: `Install ${this.label} to use it here. Conch can do that for you.`,
      });
    // Found, but not something Conch can start (a hand-made batch file): say so now,
    // not after someone presses Sign in.
    const unstartable = whyUnstartable(file);
    if (unstartable)
      return remember({
        ...base,
        state: 'error',
        executablePath: file,
        fix: { need: this.agent.need, kind: 'install' },
        message: `${this.label} didn’t start: ${unstartable}`,
      });
    const version = await (this.options.version ?? ((path) => this.#version(path)))(file);
    if (version && !isAtLeast(version, this.agent.minVersion))
      return remember({
        ...base,
        state: 'error',
        executablePath: file,
        version,
        fix: { need: this.agent.need, kind: 'update' },
        message: `Update ${this.label} to ${this.agent.minVersion} or newer to use it with Conch.`,
      });
    // A Gemini or Grok that was never signed in can't be: no need to start it to find out.
    if ((this.options.signedInBefore ?? (() => signedInBefore(this.agent)))() === false)
      return remember({
        ...base,
        state: 'signed-out',
        executablePath: file,
        ...(version && { version }),
        message: this.agent.signedOut,
      });
    try {
      const running = await this.#program(file, this.agent.modelAtStart ? 'default' : undefined);
      running.busy++;
      try {
        const started = await this.#session(running, this.settings.workspaceDefault, []);
        this.#offer = offerOf(started, this.agent.modelAtStart);
        await this.#closeSession(running, started.sessionId);
      } finally {
        running.busy--;
        this.#idle(running, this.agent.modelAtStart ? 'default' : '');
      }
      return remember({
        ...base,
        state: 'ready',
        executablePath: file,
        version: running.info.agentInfo?.version ?? version,
        auth: { method: 'subscription', description: this.agent.account },
      });
    } catch (error) {
      const signedOut = error instanceof AcpError && error.code === ACP_CODES.authRequired;
      return remember({
        ...base,
        state: signedOut ? 'signed-out' : 'error',
        executablePath: file,
        ...(version && { version }),
        message: signedOut
          ? this.agent.signedOut
          : `${this.label} didn’t start: ${error instanceof Error ? error.message : 'it stopped.'}`,
      });
    }
  }

  #find(): Promise<string | undefined> {
    return this.options.find?.() ?? findAgent(this.agent, this.options.explicitPath);
  }

  async #version(file: string): Promise<string | undefined> {
    const result = await run(file, ['--version'], { env: this.#env(), timeout: 15_000 });
    // A program that crashed says nothing about its version; Node's own crash report
    // ("Node.js v24.21.0") isn't the program's.
    if (result.code !== 0) return undefined;
    return parseVersion(`${result.stdout}\n${result.stderr}`);
  }

  // ── Models ────────────────────────────────────────────────────────────────

  async capabilities({ force = false } = {}): Promise<Capabilities> {
    if (!force && this.#caps && Date.now() - this.#caps.at < CAPABILITIES_MS)
      return this.#caps.value;
    this.#listing ??= this.#capabilities(force).finally(() => {
      this.#listing = undefined;
    });
    return this.#listing;
  }

  async #capabilities(force: boolean): Promise<Capabilities> {
    const status = await this.detect({ force });
    const offer = status.state === 'ready' ? this.#offer : undefined;
    const value: Capabilities = {
      engine: this.id,
      label: this.label,
      models: offer?.models ?? [],
      commands: [],
      permissionModes: ['default', 'plan', 'acceptEdits', 'bypassPermissions'],
      tools: { host: true, files: true, shell: true, approvals: true },
      attachments: this.attachments,
    };
    if (offer) this.#caps = { value, offer, at: Date.now() };
    return value;
  }

  // ── Signing in ────────────────────────────────────────────────────────────

  login(method: LoginMethod, update: (state: LoginState) => void): LoginHandle {
    const loginId = newId('login');
    const abort = new AbortController();
    let done = false;
    const emit = (state: Omit<LoginState, 'loginId'>) => {
      if (done) return;
      update({ loginId, ...state });
      if (['done', 'failed', 'cancelled'].includes(state.phase)) done = true;
    };
    if (method === 'api-key') {
      queueMicrotask(() =>
        emit({ phase: 'failed', message: `${this.label} signs in with its own account here.` }),
      );
      return { submitCode() {}, cancel() {} };
    }
    const timer = setTimeout(() => {
      emit({ phase: 'failed', message: 'Sign-in took too long. Start again for a new code.' });
      abort.abort();
    }, LOGIN_MS).unref();
    queueMicrotask(() => {
      void (async () => {
        emit({ phase: 'starting' });
        const file = await this.#find();
        if (!file) throw new Error(`Install ${this.label} first.`);
        if (this.agent.login.kind === 'command') await this.#loginCommand(file, emit, abort.signal);
        else await this.#loginAuthenticate(file, this.agent.login.methodId, emit, abort.signal);
        emit({ phase: 'verifying' });
        // The programs started before still hold the old sign-in.
        this.forget();
        const status = await this.detect({ force: true });
        if (status.state !== 'ready')
          throw new Error(status.message ?? `${this.label} didn’t confirm the sign-in. Try again.`);
        emit({
          phase: 'done',
          message: `${this.label} is connected. Your plan’s models and limits apply.`,
        });
      })()
        .catch((error: unknown) =>
          emit({
            phase: abort.signal.aborted ? 'cancelled' : 'failed',
            message:
              error instanceof Error && error.message
                ? error.message
                : 'Sign-in didn’t finish. Please try again.',
          }),
        )
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

  /**
   * The program's own sign-in, with no terminal: it prints a page and a code,
   * which Conch passes on, and exits once the person has confirmed.
   */
  async #loginCommand(
    file: string,
    emit: (state: Omit<LoginState, 'loginId'>) => void,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.agent.login.kind !== 'command') return;
    const { args, hosts } = this.agent.login;
    const child = (this.options.spawnLogin ?? spawnLogin)(file, args, this.#env());
    let seen = '';
    let shown = false;
    const look = (chunk: Buffer) => {
      seen = (seen + chunk.toString('utf8')).slice(-8_000);
      if (shown) return;
      const found = deviceSignIn(seen, hosts);
      if (found) {
        shown = true;
        emit({ phase: 'waiting-for-browser', url: found.url, code: found.code });
      }
    };
    child.stdout?.on('data', look);
    child.stderr?.on('data', look);
    const stop = () => child.kill();
    signal.addEventListener('abort', stop, { once: true });
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', () => reject(new Error(`${this.label} couldn’t start its sign-in.`)));
        child.once('close', resolve);
      });
      if (signal.aborted) throw new Error('Cancelled.');
      if (code !== 0)
        throw new Error(
          shown
            ? 'The sign-in was declined or expired. Start again for a new code.'
            : `${this.label} couldn’t start its sign-in. Update it, or try again.`,
        );
    } finally {
      signal.removeEventListener('abort', stop);
    }
  }

  /** ACP's `authenticate`: the program opens the sign-in page on this computer itself. */
  async #loginAuthenticate(
    file: string,
    methodId: string,
    emit: (state: Omit<LoginState, 'loginId'>) => void,
    signal: AbortSignal,
  ): Promise<void> {
    this.forget();
    const running = await this.#program(file);
    running.busy++;
    try {
      emit({
        phase: 'waiting-for-browser',
        message: 'A sign-in page opened in a browser on this computer. Finish there and come back.',
      });
      await Promise.race([
        running.conn.request('authenticate', { methodId }, LOGIN_MS),
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('Cancelled.')), { once: true }),
        ),
      ]);
    } finally {
      running.busy--;
    }
  }

  // ── A turn ────────────────────────────────────────────────────────────────

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    const queue: EngineEvent[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    const push = (event: EngineEvent) => {
      queue.push(event);
      wake?.();
      wake = undefined;
    };
    const work = this.#turn(input, push)
      .catch((error: unknown) => {
        const problem = input.signal.aborted ? undefined : acpProblem(error);
        push({
          type: 'done',
          outcome: input.signal.aborted ? 'interrupted' : 'error',
          ...(!input.signal.aborted && {
            error:
              error instanceof AcpError && error.code === ACP_CODES.authRequired
                ? this.agent.signedOut
                : error instanceof Error && error.message
                  ? error.message
                  : `${this.label} couldn’t finish this turn.`,
            ...(problem && { problem }),
          }),
        });
      })
      .finally(() => {
        finished = true;
        wake?.();
      });
    while (!finished || queue.length) {
      const event = queue.shift();
      if (event) yield event;
      else
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
    }
    await work;
  }

  async #turn(input: TurnInput, push: (event: EngineEvent) => void): Promise<void> {
    const startedAt = Date.now();
    const status = await this.detect();
    if (status.state !== 'ready' || !status.executablePath)
      throw new AcpError(
        status.message ?? `Connect ${this.label} in Settings → Providers.`,
        status.state === 'signed-out' ? ACP_CODES.authRequired : 0,
      );
    input.signal.throwIfAborted();
    const model =
      input.options.model && input.options.model !== 'default' ? input.options.model : undefined;
    const running = await this.#program(status.executablePath, model);
    const key = this.agent.modelAtStart ? (model ?? 'default') : '';
    running.busy++;
    clearTimeout(running.idle);

    let messageId = newId('msg');
    let open = false;
    const close = () => {
      if (open) push({ type: 'message-done', messageId });
      open = false;
      messageId = newId('msg');
    };
    // A program that takes pictures in a prompt gets a tool's pictures too (an
    // MCP `image`); one that doesn't gets them in words (ADR 0070).
    const canSee = running.info.agentCapabilities?.promptCapabilities?.image === true;
    const tools = withSight(buildTools(input), {
      sees: () => canSee,
      ...(input.describe && { describe: input.describe }),
      signal: input.signal,
    });
    const names = new Set([...tools.values()].map((tool: Callable) => tool.spec.name));
    const local = new AbortController();
    const signal = AbortSignal.any([input.signal, local.signal]);
    const caps = running.info.agentCapabilities;
    const how = this.agent.instructions;
    // Conch's instructions, and where its tools are: the door's own, for programs
    // that read a tool server's instructions (`AcpAgent.instructions`).
    const instructions = conchInstructions(input.systemAppend, tools.size > 0);
    const door = tools.size
      ? await openDoor(
          tools,
          {
            start: ({ id, name, input: args }) => {
              close();
              push({ type: 'tool-start', toolUseId: id, name, input: args });
            },
            end: ({ id, status: state, output, view }) =>
              push({
                type: 'tool-end',
                toolUseId: id,
                status: state,
                output,
                ...(view && { view }),
              }),
          },
          signal,
          how === 'rules' ? {} : { instructions },
        )
      : undefined;
    // At an address where the program takes one; otherwise as a program of its own,
    // which every ACP program must take: a relay to the same door (`shim.mjs`).
    const servers = door ? [caps?.mcpCapabilities?.http ? httpDoor(door) : stdioDoor(door)] : [];
    const meta = how === 'rules' ? { _meta: { rules: instructions } } : {};
    const said = digestOf(instructions);

    let sessionId = '';
    const calls = new AcpCalls(names, push, `${newId('acp')}_`);
    try {
      // The chat's own session, carried on where the program can load one: it gets
      // only what it missed. Otherwise a new one, with the whole conversation.
      const wanted = parseAcpResume(input.resumeId);
      let started: SessionStarted | undefined;
      if (wanted && caps?.loadSession)
        try {
          const loaded = await running.conn.request(
            'session/load',
            { sessionId: wanted.sessionId, cwd: input.cwd, mcpServers: servers, ...meta },
            PROBE_MS,
          );
          started = SessionStarted.parse({
            ...(loaded && typeof loaded === 'object' ? loaded : {}),
            sessionId: wanted.sessionId,
          });
        } catch (error) {
          if (error instanceof AcpError && error.code === ACP_CODES.authRequired) throw error;
          // Gone (tidied away, another folder, a newer format): a new one, below.
        }
      const resumed = Boolean(started);
      started ??= await this.#session(running, input.cwd, servers, meta);
      sessionId = started.sessionId;
      push({
        type: 'session',
        resumeId: acpResumeId(sessionId, said),
        // It should have carried on and couldn't: healed with the whole conversation.
        ...(wanted && caps?.loadSession && !resumed && { restarted: 'lost' as const }),
      });
      const offer = offerOf(started, this.agent.modelAtStart);
      running.sessions.set(sessionId, {
        update: (update) => {
          // Some programs share their plan (ACP's `plan` update): drawn as Conch's checklist.
          if (update.sessionUpdate === 'plan') {
            const steps = acpPlan(update.entries);
            if (steps) push({ type: 'plan', steps });
            return;
          }
          // Its own tools at work: rows like every provider's (`calls.ts`).
          if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
            const call = ToolCall.safeParse(update);
            if (call.success) {
              close();
              calls.update(update.sessionUpdate, call.data);
            }
            return;
          }
          const content = Array.isArray(update.content) ? undefined : update.content;
          const text = content?.type === 'text' ? (content.text ?? '') : '';
          if (!text) return;
          if (update.sessionUpdate === 'agent_message_chunk') {
            open = true;
            push({ type: 'text', messageId, delta: text });
          } else if (update.sessionUpdate === 'agent_thought_chunk') {
            open = true;
            push({ type: 'thinking', messageId, delta: text });
          }
        },
        permission: async (request) => {
          // Once, never always: "always" can teach the program to skip asking for
          // anything that looks the same, and then Conch wouldn't see it.
          const allow =
            request.options.find((o) => o.kind === 'allow_once') ??
            request.options.find((o) => o.kind === 'allow_always');
          const reject =
            request.options.find((o) => o.kind === 'reject_once') ??
            request.options.find((o) => o.kind === 'reject_always');
          // Conch's own tools are checked at the door, every time: let the program through to it.
          if (
            allow &&
            (forDoor(request.toolCall, names) ||
              namesDoorTool(request.toolCall, names, { strict: true }))
          ) {
            calls.door(request.toolCall?.toolCallId);
            return { outcome: { outcome: 'selected', optionId: allow.optionId } };
          }
          // The program's own tools would change things Conch can't seal or put back.
          calls.declined(request.toolCall?.toolCallId);
          return reject
            ? { outcome: { outcome: 'selected', optionId: reject.optionId } }
            : { outcome: { outcome: 'cancelled' } };
        },
      });

      if (model && offer.how === 'config' && offer.modelOption)
        await running.conn.request('session/set_config_option', {
          sessionId,
          configId: offer.modelOption,
          value: model,
        });
      else if (model && offer.how === 'legacy')
        await running.conn.request('session/set_model', { sessionId, modelId: model });
      const effort = input.options.effort;
      if (effort !== 'auto' && offer.effortOption && offer.efforts.includes(effort))
        await running.conn
          .request('session/set_config_option', {
            sessionId,
            configId: offer.effortOption,
            value: effort,
          })
          .catch(() => undefined);

      // Conch's instructions lead the message only where the program can't take
      // them otherwise: no door to carry them, or a carried-on chat that read them
      // once, at its start, and they've changed since.
      const every = how === 'rules' || (how === 'server' && door);
      const lead = every
        ? undefined
        : !resumed
          ? door
            ? undefined
            : preamble(input.systemAppend, false)
          : wanted?.said !== said
            ? preamble(input.systemAppend, Boolean(door), { updated: true })
            : undefined;
      const words = resumed ? input.prompt : (input.freshPrompt ?? input.prompt);
      const prompt = [
        ...(lead ? [{ type: 'text', text: lead }] : []),
        ...(canSee ? (input.images ?? []) : []).map((image) => ({
          type: 'image',
          mimeType: image.mimeType,
          data: image.data,
        })),
        {
          type: 'text',
          text:
            !canSee && input.images?.length
              ? `${words}\n\n[The images named above couldn't be shown: ${this.label} can't see images here. If the message depends on them, say so.]`
              : words,
        },
      ];
      const cancel = () => running.conn.notify('session/cancel', { sessionId });
      input.signal.addEventListener('abort', cancel, { once: true });
      let result: z.infer<typeof PromptResult>;
      try {
        result = PromptResult.parse(
          await running.conn.request('session/prompt', { sessionId, prompt }, 0),
        );
      } finally {
        input.signal.removeEventListener('abort', cancel);
      }
      close();
      calls.end(result.stopReason === 'cancelled' || input.signal.aborted);
      const usage: Usage = {
        inputTokens: Math.max(0, Math.round(result.usage?.inputTokens ?? 0)),
        outputTokens: Math.max(0, Math.round(result.usage?.outputTokens ?? 0)),
        durationMs: Date.now() - startedAt,
      };
      if (result.stopReason === 'max_tokens')
        push({
          type: 'notice',
          code: 'length',
          message:
            'The answer was cut short: the model reached the most it can write at once. Ask it to carry on.',
        });
      if (result.stopReason === 'refusal')
        push({
          type: 'notice',
          code: 'refusal',
          message: `${this.label} declined to answer that.`,
        });
      const interrupted = result.stopReason === 'cancelled' || input.signal.aborted;
      push({
        type: 'done',
        outcome: interrupted ? 'interrupted' : 'success',
        usage,
        // The program's own step limit: a pause with Carry on, like Conch's own (ADR 0085).
        ...(!interrupted &&
          result.stopReason === 'max_turn_requests' && {
            paused: {
              reason: 'steps' as const,
              message: `Paused: ${this.label} took its most steps for one message, so it’s checking in.`,
            },
          }),
      });
    } finally {
      local.abort();
      await door?.close();
      if (sessionId) await this.#closeSession(running, sessionId);
      running.busy--;
      this.#idle(running, key);
    }
  }
}

/** Where Conch's tools are, said to the program with its instructions. */
function toolsNote(door: boolean): string {
  return door
    ? `Use the tools from the "${DOOR_NAME}" server for files, commands, memory, the browser and the user's apps: they are sealed and can be put back. Your own built-in tools that change files or run commands are turned off here and will be declined. Don't start sub-agents or tasks of your own: to hand off part of the work, use that server's \`delegate\` or \`start_background_task\` where you have them, so the person can see, answer and stop it.`
    : 'You have no tools in this conversation: say so plainly if something needs one.';
}

/** Conch's instructions as the program takes them in its own place (`AcpAgent.instructions`). */
export function conchInstructions(system: string, door: boolean): string {
  return ['# From Conch, the app this conversation happens in', system.trim(), toolsNote(door)]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The same instructions leading the message, for a program that has no other
 * place for them right now (no door to carry them, or a carried-on chat that
 * read them once, before they changed). Framed as Conch's, apart from what the
 * person wrote.
 */
export function preamble(system: string, door: boolean, { updated = false } = {}): string {
  return [
    updated
      ? '# From Conch, the app this conversation happens in: its instructions as they are now (they replace the earlier ones). These are the app’s words, not the user’s.'
      : '# From Conch, the app this conversation happens in. These are the app’s words, not the user’s.',
    system.trim(),
    toolsNote(door),
    '# The user’s message',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The door at its address, as ACP's `mcpServers` takes it. */
function httpDoor(door: Door) {
  return { type: 'http', name: DOOR_NAME, url: door.url, headers: door.headers };
}

/** The relay that serves the door to a program that only starts MCP servers itself. */
export const SHIM_SCRIPT = join(import.meta.dirname, 'shim.mjs');
function stdioDoor(door: Door) {
  return {
    name: DOOR_NAME,
    command: process.execPath,
    args: [SHIM_SCRIPT],
    // Lists, as ACP has them (Gemini CLI reads nothing else).
    env: [
      { name: 'CONCH_DOOR_URL', value: door.url },
      { name: 'CONCH_DOOR_KEY', value: door.key },
    ],
  };
}

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** `<instructions digest>:<session id>`: what Conch keeps with the chat. */
export function acpResumeId(sessionId: string, said: string): string {
  return `${said}:${sessionId}`;
}

export function parseAcpResume(
  resumeId: string | undefined,
): { said: string; sessionId: string } | undefined {
  const match = /^([0-9a-f]{16}):([\x21-\x7e]{1,200})$/.exec(resumeId ?? '');
  return match?.[1] && match[2] ? { said: match[1], sessionId: match[2] } : undefined;
}

/**
 * The page and code a device sign-in printed, if it has printed both. The page
 * must be on one of the provider's own hosts, over https.
 */
export function deviceSignIn(
  text: string,
  hosts: readonly RegExp[],
): { url: string; code: string } | undefined {
  const urls = text.match(/https:\/\/[^\s"'<>)]+/g) ?? [];
  const url = urls
    .map((u) => {
      try {
        return new URL(u.replace(/[.,;]+$/, ''));
      } catch {
        return undefined;
      }
    })
    .find((u) => u && u.protocol === 'https:' && hosts.some((host) => host.test(u.hostname)));
  const code = /\b([A-Z0-9]{4,5}-[A-Z0-9]{4,5})\b/.exec(text)?.[1];
  return url && code ? { url: url.href, code } : undefined;
}
