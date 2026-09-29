/**
 * The Codex CLI as a Conch engine.
 *
 * Codex is driven headlessly: `codex exec --json` prints one event per line and
 * exits when the turn is done. That shapes what this engine can and can't do:
 *
 * - **No approvals.** `codex exec` forces `approval_policy = never`, so Conch
 *   can't ask before a step. Safety comes from `--sandbox`, and the user is
 *   told in plain words on the first turn of every conversation.
 * - **No host tools.** Conch's own tools (memory) reach an engine through MCP or
 *   function calling; `codex exec` offers neither, so they are left out rather
 *   than faked into the prompt.
 * - **Integrations are native**: they're handed over as `-c` config overrides,
 *   with every secret carried in the child's environment. Nothing that would
 *   show up in `ps` is ever put on the command line.
 */
import { spawn } from 'node:child_process';

import {
  EffortChoice,
  type Capabilities,
  type EngineStatus,
  type LoginMethod,
  type LoginState,
  type ModelInfo,
  type PermissionMode,
} from '@conch/protocol';
import { z } from 'zod';

import { agentEnv, run } from '../../lib/proc';
import type { ProviderKeys } from '../../providers/keys';
import type { SettingsStore } from '../../settings/store';
import type {
  Engine,
  EngineEvent,
  EngineIntegrations,
  EngineMcpServer,
  EngineMcpStatus,
  LoginHandle,
  TurnInput,
} from '../types';
import { detectCodex } from './detect';
import { startCodexLogin } from './login';
import { Translator } from './translate';

const CACHE_MS = 20_000;
const CAPABILITIES_MS = 10 * 60_000;
const MCP_STATUS_MS = 60_000;
const PROBE_TIMEOUT_MS = 20_000;
/** A line longer than this can't be an event; drop it instead of buffering it. */
const MAX_LINE = 1_000_000;
/** Kept from stderr to explain a crash. */
const STDERR_TAIL = 8000;
/** Grace between asking Codex to stop and insisting. */
const KILL_GRACE_MS = 2000;

/** Modes Codex can actually honour. It has no "ask me first", so Conch doesn't offer one. */
const PERMISSION_MODES: PermissionMode[] = ['plan', 'acceptEdits', 'bypassPermissions'];

const EFFORTS = EffortChoice.exclude(['auto']).options;

export type Sandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

/**
 * How much of the computer Codex may touch. Because Conch can't ask before each
 * step here, every mode takes its cautious reading: "ask me first" becomes
 * read-only rather than a silent licence to write.
 */
export function sandboxFor(mode: PermissionMode): Sandbox {
  switch (mode) {
    case 'bypassPermissions':
      return 'danger-full-access';
    case 'acceptEdits':
    case 'auto':
      return 'workspace-write';
    // `plan` is read-only by definition, and `default` means "ask me first" —
    // which Codex can't do, so it gets the cautious reading too.
    default:
      return 'read-only';
  }
}

/** One plain sentence about what the agent can do in this conversation. */
export function sandboxNotice(sandbox: Sandbox): string {
  switch (sandbox) {
    case 'read-only':
      return 'Codex works inside its own sandbox and can’t ask you before each step, so in this mode it can only read — switch to Accept edits to let it change files.';
    case 'workspace-write':
      return 'Codex works inside its own sandbox and can’t ask you before each step: it can read and change files in this folder, but not the rest of your computer.';
    case 'danger-full-access':
      return 'Codex is running with full access: it can’t ask you before each step, and it can change anything on this computer.';
  }
}

// ── Integrations as config overrides ────────────────────────────────────────

export interface McpOverrides {
  /** `-c key=value` pairs, ready to pass to `codex exec`. Never contains a secret. */
  args: string[];
  /** Values the child needs in its environment, where other programs can't read them. */
  env: Record<string, string>;
  /** Servers Conch left out, with the reason to show the user. */
  skipped: { name: string; error: string }[];
}

/**
 * The one reason a working integration is left out: we could only give Codex
 * its token by putting it on the command line, where `ps` would show it to
 * every program running as this user.
 */
const SECRET_IN_ARGV =
  'Codex can’t use this yet: its token would be visible to other programs on this computer.';
const ODD_TOKEN = 'Codex can’t use this yet: its token has characters Conch won’t pass on.';
const ODD_SETTING =
  'Codex can’t use this yet: one of its settings uses a name Conch won’t pass to a program.';
const ODD_ADDRESS = 'Codex can’t use this yet: its address isn’t a web address Conch can pass on.';

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * Variables that change how a program *runs*, not what it can reach. An
 * integration that asked for one of these could make Codex load code of its
 * choosing, so Conch refuses rather than passes them on.
 */
const RESERVED_ENV_RE =
  /^(PATH|HOME|SHELL|USER|LOGNAME|PWD|TMPDIR|IFS|ENV|BASH_ENV|NODE_OPTIONS|NODE_PATH|PYTHONPATH|PYTHONSTARTUP|PERL5LIB|PERL5OPT|RUBYOPT|GEM_PATH|LD_.*|DYLD_.*|CODEX_.*|CONCH_.*|ANTHROPIC_.*|OPENAI_.*)$/;

/** A TOML value Codex's `-c` parser accepts. JSON's escaping is a subset of TOML's. */
function toml(value: string): string {
  return JSON.stringify(value);
}

function tomlArray(values: string[]): string {
  return `[${values.map(toml).join(',')}]`;
}

/** Integration names become config keys, so they're reduced to `[a-z0-9_]`. */
export function configKey(name: string): string {
  const key = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return key || 'server';
}

function uniqueKey(key: string, used: Set<string>): string {
  let candidate = key;
  for (let n = 2; used.has(candidate); n++) candidate = `${key}_${n}`;
  used.add(candidate);
  return candidate;
}

function hasControlChars(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\x00-\x1f\x7f]/.test(value);
}

/**
 * Turn this turn's integrations into `codex exec` arguments.
 *
 * Secrets are the whole point of this function: an HTTP server's bearer token
 * goes into the environment and is referenced by name
 * (`bearer_token_env_var`), and a program's secrets stay in the environment
 * too (`env_vars` only names them). Anything we can't carry that way is
 * skipped and reported — never downgraded onto the command line.
 */
export function mcpOverrides(
  servers: Record<string, EngineMcpServer> | undefined,
  disallowed: string[] = [],
): McpOverrides {
  const args: string[] = [];
  const env: Record<string, string> = {};
  const skipped: { name: string; error: string }[] = [];
  const used = new Set<string>();

  for (const [name, server] of Object.entries(servers ?? {})) {
    const key = uniqueKey(configKey(name), used);
    const overrides: string[] = [];
    const secrets: Record<string, string> = {};
    let problem: string | undefined;

    if (server.type === 'http') {
      let url: URL | undefined;
      try {
        url = new URL(server.url);
      } catch {
        url = undefined;
      }
      if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
        skipped.push({ name, error: ODD_ADDRESS });
        continue;
      }
      overrides.push(`mcp_servers.${key}.url=${toml(url.toString())}`);

      const headers = Object.entries(server.headers ?? {});
      const authorization = headers.find(([header]) => header.toLowerCase() === 'authorization');
      // Codex can only carry a bearer token out of sight. Any other header
      // would have to go in `http_headers`, which lands in the argument list.
      if (headers.some(([header]) => header.toLowerCase() !== 'authorization')) {
        skipped.push({ name, error: SECRET_IN_ARGV });
        continue;
      }
      if (authorization) {
        // Only a bearer token fits `bearer_token_env_var`; any other scheme
        // would have to travel as a header, which means the argument list.
        const token = /^bearer[ \t]+([\s\S]+)$/i.exec(authorization[1])?.[1];
        if (!token) {
          skipped.push({ name, error: SECRET_IN_ARGV });
          continue;
        }
        // A token with a line break in it would break the request Codex sends.
        if (hasControlChars(token)) {
          skipped.push({ name, error: ODD_TOKEN });
          continue;
        }
        const variable = `CODEX_MCP_TOKEN_${key.toUpperCase()}`;
        secrets[variable] = token;
        overrides.push(`mcp_servers.${key}.bearer_token_env_var=${toml(variable)}`);
      }
    } else {
      if (!server.command.trim()) {
        skipped.push({ name, error: ODD_SETTING });
        continue;
      }
      overrides.push(`mcp_servers.${key}.command=${toml(server.command)}`);
      if (server.args.length) overrides.push(`mcp_servers.${key}.args=${tomlArray(server.args)}`);
      const names: string[] = [];
      for (const [variable, value] of Object.entries(server.env ?? {})) {
        if (!ENV_NAME_RE.test(variable) || RESERVED_ENV_RE.test(variable)) {
          problem = ODD_SETTING;
          break;
        }
        // Two servers can't both own one variable name: `env_vars` passes it by
        // name, so the second value would silently reach the first server.
        if (Object.hasOwn(env, variable) && env[variable] !== value) {
          problem = SECRET_IN_ARGV;
          break;
        }
        secrets[variable] = value;
        names.push(variable);
      }
      if (!problem && names.length) {
        overrides.push(`mcp_servers.${key}.env_vars=${tomlArray(names)}`);
      }
    }

    if (problem) {
      skipped.push({ name, error: problem });
      continue;
    }

    // Tools the user switched off never reach the model.
    const prefix = `mcp__${name}__`;
    const off = disallowed.flatMap((tool) =>
      tool.startsWith(prefix) ? [tool.slice(prefix.length)] : [],
    );
    if (off.length) overrides.push(`mcp_servers.${key}.disabled_tools=${tomlArray(off)}`);

    for (const override of overrides) args.push('-c', override);
    Object.assign(env, secrets);
  }

  return { args, env, skipped };
}

// ── The model catalogue ─────────────────────────────────────────────────────

const WireModel = z.object({
  id: z.string().optional(),
  slug: z.string().optional(),
  model: z.string().optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  display_name: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  efforts: z.array(z.string()).optional(),
  reasoning_efforts: z.array(z.string()).optional(),
  supported_reasoning_efforts: z.array(z.string()).optional(),
  reasoning_levels: z.array(z.string()).optional(),
});

/** JSON somewhere in a program's output: the whole thing, a slice, or one per line. */
function jsonFrom(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // Fall through: there may be a banner around it.
  }
  const start = [text.indexOf('['), text.indexOf('{')].filter((i) => i !== -1);
  if (start.length) {
    const from = Math.min(...start);
    const to = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'));
    if (to > from) {
      try {
        return JSON.parse(text.slice(from, to + 1));
      } catch {
        // Fall through to JSONL.
      }
    }
  }
  const lines: unknown[] = [];
  for (const line of text.split('\n')) {
    try {
      lines.push(JSON.parse(line.trim()));
    } catch {
      continue;
    }
  }
  return lines.length ? lines : undefined;
}

/** The list of models inside whatever shape `codex debug models` printed. */
function modelEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  for (const nested of Object.values(record)) {
    if (Array.isArray(nested) && nested.length) return nested;
  }
  // A map of id → model is just as plausible as a list.
  return Object.entries(record).flatMap(([id, entry]) =>
    entry && typeof entry === 'object' && !Array.isArray(entry) ? [{ id, ...entry }] : [],
  );
}

/**
 * Codex's model catalogue, read defensively. If the shape isn't what we expect
 * we return nothing at all: an empty list makes Conch use Codex's own default
 * model, while a hard-coded list of guesses would offer models that don't exist.
 */
export function parseModels(stdout: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const entry of modelEntries(jsonFrom(stdout))) {
    const parsed = WireModel.safeParse(entry);
    if (!parsed.success) continue;
    const wire = parsed.data;
    const id = wire.id ?? wire.slug ?? wire.model ?? wire.name;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const levels =
      wire.efforts ??
      wire.reasoning_efforts ??
      wire.supported_reasoning_efforts ??
      wire.reasoning_levels ??
      [];
    models.push({
      id,
      label: wire.display_name ?? wire.displayName ?? wire.label ?? wire.name ?? id,
      description: wire.description ?? '',
      // Codex's levels are per model and include ones Conch has no word for.
      efforts: EFFORTS.filter((effort) => levels.includes(effort)),
      supportsFastMode: false,
      supportsAutoMode: false,
    });
  }
  return models;
}

const WireMcpServer = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  url: z.string().optional(),
  tools: z.array(z.unknown()).optional(),
});

/**
 * Codex's own MCP servers, from `codex mcp list`. That command lists what is
 * *configured*, not what connected — so an enabled entry is reported as
 * connected without a tool count, and a disabled one as off. Unparseable
 * output (the human table, an older release) means an empty list, never an error.
 */
export function parseMcpList(stdout: string): EngineMcpStatus[] {
  const out: EngineMcpStatus[] = [];
  const parsed = jsonFrom(stdout);
  const entries: [string | undefined, unknown][] = Array.isArray(parsed)
    ? parsed.map((entry) => [undefined, entry])
    : parsed && typeof parsed === 'object'
      ? Object.entries(parsed as Record<string, unknown>)
      : [];
  for (const [key, entry] of entries) {
    const server = WireMcpServer.safeParse(entry);
    if (!server.success) continue;
    const name = server.data.name ?? key;
    if (!name) continue;
    out.push({
      name,
      status: server.data.enabled === false ? 'disabled' : 'connected',
      source: 'engine',
      toolCount: server.data.tools?.length ?? 0,
      url: server.data.url,
    });
  }
  return out;
}

// ── Turn arguments ──────────────────────────────────────────────────────────

export interface TurnArgs {
  prompt: string;
  resumeId?: string;
  sandbox: Sandbox;
  model?: string;
  effort?: string;
  overrides?: string[];
}

/**
 * The command line for one turn. The prompt goes last, and a prompt that starts
 * with a dash is separated with `--` so it can never be read as an option.
 */
export function turnArgs(options: TurnArgs): string[] {
  const args = options.resumeId ? ['exec', 'resume', options.resumeId] : ['exec'];
  args.push('--json', '--skip-git-repo-check', '--sandbox', options.sandbox);
  if (options.model) args.push('-m', options.model);
  if (options.effort && options.effort !== 'auto') {
    args.push('-c', `model_reasoning_effort=${toml(options.effort)}`);
  }
  args.push(...(options.overrides ?? []));
  if (options.prompt.startsWith('-')) args.push('--');
  args.push(options.prompt);
  return args;
}

/**
 * `codex exec` has no flag for extra system instructions, so Conch's own
 * briefing (who the assistant is, what it remembers, which integrations are
 * broken) rides at the top of the message, clearly fenced.
 *
 * It's sent on the first turn of a thread and again whenever it *changes* —
 * a new memory, an integration that broke — but not otherwise: a resumed
 * thread already carries every earlier message, so repeating an unchanged
 * briefing would fill the context with copies of itself.
 */
export function promptFor(
  input: Pick<TurnInput, 'prompt' | 'systemAppend' | 'resumeId'>,
  lastSent?: string,
): string {
  const append = input.systemAppend.trim();
  if (!append) return input.prompt;
  if (input.resumeId && append === lastSent) return input.prompt;
  const label = input.resumeId && lastSent ? ' updated="true"' : '';
  return `<conch-instructions${label}>\n${append}\n</conch-instructions>\n\n${input.prompt}`;
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

/** What to tell the user when Codex stopped without saying why. */
function exitMessage(code: number | null, signal: string | null, stderr: string): string {
  const how = signal ? `stopped (${signal})` : `stopped with exit code ${code ?? '?'}`;
  const tail = stripAnsi(stderr)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(' ')
    .slice(0, 500);
  return tail ? `Codex ${how}: ${tail}` : `Codex ${how}.`;
}

export class CodexEngine implements Engine {
  readonly id = 'codex-cli' as const;
  readonly label = 'Codex';
  /**
   * Codex runs MCP servers itself. It has no account connectors of its own, so
   * everything comes from Conch's integrations or Codex's own config.
   */
  readonly integrations: EngineIntegrations = {
    mode: 'native',
    signInHint: 'In a terminal, run codex, then /mcp, to sign it in.',
  };
  /**
   * `codex exec` takes no tool definitions and speaks no in-process MCP, so
   * Conch's own tools (saving a memory, making a routine) have no channel here.
   * Saying so keeps them out of the prompt instead of promising them.
   */
  readonly hostTools = false;
  #cache?: { status: EngineStatus; at: number };
  #inflight?: Promise<EngineStatus>;
  #capabilities?: { value: Capabilities; at: number };
  #probing?: Promise<Capabilities>;
  #mcp?: { value: EngineMcpStatus[]; at: number };
  #mcpProbe?: Promise<EngineMcpStatus[]>;
  /** The briefing each conversation has already been given, so it isn't repeated. */
  #briefings = new Map<string, string>();

  constructor(
    private readonly settings: SettingsStore,
    private readonly keys: ProviderKeys,
    private readonly explicitPath?: string,
  ) {}

  /**
   * Codex's own key, when you gave Conch one. `peek` is used wherever the
   * caller is only drawing a page: a key kept in 1Password must never make
   * Settings ask for a fingerprint.
   */
  #apiKey(options: { peek?: boolean } = {}) {
    return this.keys.value('codex-cli', options).catch(() => undefined);
  }

  async detect({ force = false } = {}): Promise<EngineStatus> {
    if (!force && this.#cache && Date.now() - this.#cache.at < CACHE_MS) return this.#cache.status;
    this.#inflight ??= (async () => {
      const status = await detectCodex({
        explicitPath: this.explicitPath,
        apiKey: await this.#apiKey({ peek: true }),
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
      queueMicrotask(() =>
        onUpdate({
          loginId: 'login_unavailable',
          phase: 'failed',
          message: 'Codex isn’t installed yet.',
        }),
      );
      return { submitCode() {}, cancel() {} };
    }
    return startCodexLogin(executablePath, method, onUpdate);
  }

  /** The key changed: forget everything that depended on it. */
  async setApiKey(): Promise<void> {
    this.#cache = undefined;
    this.#capabilities = undefined;
    this.#mcp = undefined;
  }

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
    const empty: Capabilities = {
      engine: this.id,
      label: this.label,
      models: [],
      // Codex has no slash commands a headless turn can use.
      commands: [],
      permissionModes: PERMISSION_MODES,
    };
    const status = await this.detect();
    if (status.state !== 'ready' || !status.executablePath) return empty;
    const result = await run(status.executablePath, ['debug', 'models'], {
      env: agentEnv({ CODEX_API_KEY: await this.#apiKey({ peek: true }) }),
      cwd: await this.#cwd(),
      timeout: PROBE_TIMEOUT_MS,
    });
    const models = result.code === 0 ? parseModels(result.stdout) : [];
    const value: Capabilities = { ...empty, models };
    // Only a real answer is worth remembering; a failure should be retried.
    if (models.length) this.#capabilities = { value, at: Date.now() };
    return value;
  }

  async mcpStatus(): Promise<EngineMcpStatus[]> {
    if (this.#mcp && Date.now() - this.#mcp.at < MCP_STATUS_MS) return this.#mcp.value;
    this.#mcpProbe ??= (async () => {
      try {
        const status = await this.detect();
        if (status.state !== 'ready' || !status.executablePath) return [];
        const env = agentEnv({ CODEX_API_KEY: await this.#apiKey({ peek: true }) });
        const options = { env, cwd: await this.#cwd(), timeout: PROBE_TIMEOUT_MS };
        let result = await run(status.executablePath, ['mcp', 'list', '--json'], options);
        // Older releases don't know `--json`; their table simply won't parse.
        if (result.code !== 0) {
          result = await run(status.executablePath, ['mcp', 'list'], options);
        }
        const value = parseMcpList(result.stdout);
        this.#mcp = { value, at: Date.now() };
        return value;
      } catch {
        return [];
      }
    })().finally(() => {
      this.#mcpProbe = undefined;
    });
    return this.#mcpProbe;
  }

  async #cwd(): Promise<string | undefined> {
    return this.settings.workspace().catch(() => undefined);
  }

  /**
   * One turn of `codex exec`. `input.tools` and `input.requestPermission` go
   * unused on purpose: this command line offers no way to add a tool and no
   * channel to ask a question, and writing Conch's tools into the prompt would
   * only teach the model to call something that isn't there.
   */
  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    const status = await this.detect();
    if (status.state !== 'ready' || !status.executablePath) {
      yield {
        type: 'done',
        outcome: 'error',
        error: status.message ?? `${this.label} isn’t ready.`,
      };
      return;
    }

    const mcp = mcpOverrides(input.mcpServers, input.disallowedTools);
    if (mcp.skipped.length) yield { type: 'mcp-status', failed: mcp.skipped };

    const sandbox = sandboxFor(input.options.permissionMode);
    // Codex can't ask before a step, so the first turn says what it may do.
    if (!input.resumeId) {
      yield { type: 'notice', code: 'sandbox', message: sandboxNotice(sandbox) };
    }

    const args = turnArgs({
      prompt: promptFor(input, this.#briefings.get(input.conversationId)),
      resumeId: input.resumeId,
      sandbox,
      model: input.options.model,
      effort: input.options.effort,
      overrides: mcp.args,
    });

    this.#briefings.set(input.conversationId, input.systemAppend.trim());

    const child = spawn(status.executablePath, args, {
      cwd: input.cwd,
      env: agentEnv({ CODEX_API_KEY: await this.#apiKey(), ...mcp.env }),
      // Codex exec reads nothing from stdin; leaving it open would only risk a hang.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const translator = new Translator();
    const queue: EngineEvent[] = [];
    let wake: (() => void) | undefined;
    const push = (events: EngineEvent[]) => {
      for (const event of events) queue.push(event);
      wake?.();
      wake = undefined;
    };

    let pending = '';
    let stderr = '';
    let closed = false;
    let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let failure: Error | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      pending += chunk;
      for (let cut = pending.indexOf('\n'); cut !== -1; cut = pending.indexOf('\n')) {
        const line = pending.slice(0, cut);
        pending = pending.slice(cut + 1);
        push(translator.translate(line));
      }
      if (pending.length > MAX_LINE) pending = '';
    });
    // Human progress and errors only: the events are all on stdout.
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });

    const settle = () => {
      closed = true;
      wake?.();
      wake = undefined;
    };
    child.on('error', (error) => {
      failure = error;
      settle();
    });
    child.on('close', (code, signal) => {
      exit = { code, signal };
      settle();
    });

    /** Ask Codex to stop, and insist if it doesn't. */
    const stop = () => {
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref();
      wake?.();
      wake = undefined;
    };
    if (input.signal.aborted) stop();
    else input.signal.addEventListener('abort', stop, { once: true });

    let done = false;
    let flushed = false;
    try {
      for (;;) {
        const event = queue.shift();
        if (event) {
          if (event.type === 'done') done = true;
          yield event;
          if (done) return;
          continue;
        }
        if (input.signal.aborted) break;
        if (closed) {
          // A last line without its newline still counts.
          if (!flushed) {
            flushed = true;
            push(translator.translate(pending));
            pending = '';
            continue;
          }
          break;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }

      if (input.signal.aborted) {
        yield { type: 'done', outcome: 'interrupted' };
      } else if (failure) {
        yield { type: 'done', outcome: 'error', error: `Couldn’t start Codex: ${failure.message}` };
      } else if (exit?.code === 0) {
        // Exited cleanly without a `turn.completed`: nothing was said, but
        // nothing went wrong either.
        yield { type: 'done', outcome: 'success' };
      } else {
        yield {
          type: 'done',
          outcome: 'error',
          error: exitMessage(exit?.code ?? null, exit?.signal ?? null, stderr),
        };
      }
    } finally {
      input.signal.removeEventListener('abort', stop);
      if (exit) {
        if (killTimer) clearTimeout(killTimer);
      } else {
        stop();
      }
      child.stdout.destroy();
      child.stderr.destroy();
    }
  }
}
