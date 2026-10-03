/**
 * An app's tools, run sealed off (ADR 0061 §2): one Node process per app,
 * started on first use, held by Node's permission model and fenced by
 * `runtime/host.mjs` (which documents what a tools module may do).
 *
 * - It reads only the runtime and its own folder, and writes only its data
 *   folder. No programs, workers, addons, WASI, inspector or `eval`.
 * - It has no network of its own: `app.fetch` asks the gateway over the IPC
 *   channel, and the gateway's `fetcher` decides (only `reaches`, through
 *   the SSRF guard), and only while one of its tools is running.
 * - It gets no environment at all. Settings (secrets too) go over IPC after
 *   it starts, never in its environment or its arguments.
 * - Every message it sends is checked here and capped in size; a call has
 *   `APP_LIMITS.callMs`, and one that runs over stops the process.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import { APP_LIMITS, ConchAppTool } from '@conch/protocol';
import { z } from 'zod';

import type {
  AppCallOutcome,
  AppFetchResponse,
  AppRuntime,
  AppToolDefinition,
  RuntimeOptions,
} from './types';

/** The runtime itself: beside this file in the source, which is what every way of running Conch ships. */
export const HOST_SCRIPT = join(import.meta.dirname, 'runtime', 'host.mjs');

/**
 * Whether the Node running Conch has a network permission. When it does,
 * `--permission` already denies the network, and the sealed process is
 * given none of it (no `--allow-net`), so the fence is a second wall.
 */
export const NETWORK_PERMISSION = process.allowedNodeEnvironmentFlags.has('--allow-net');

const IDLE_MS = 10 * 60_000;
/** The most text a tool's answer may be, for the model. */
const RESULT_CHARS = 100_000;
/** The most the sealed process may say in one message. */
const MAX_MESSAGE = 2 * 1024 * 1024;
/** What's kept of its stderr, for its log. */
const LOG_CHARS = 16 * 1024;

/** The arguments the sealed process starts with: the permission model, and nothing it may change. */
export function sealedArgs(paths: { host: string; appDir: string; dataDir: string }): string[] {
  return [
    '--permission',
    `--allow-fs-read=${paths.host}`,
    `--allow-fs-read=${paths.appDir}`,
    `--allow-fs-read=${paths.dataDir}`,
    `--allow-fs-write=${paths.dataDir}`,
    '--disallow-code-generation-from-strings',
    '--max-old-space-size=256',
    paths.host,
  ];
}

/**
 * On Windows, libuv hands a child these from the parent whenever they're
 * missing, even from an empty environment: so they're set, and empty.
 */
const WINDOWS_REQUIRED = [
  'HOMEDRIVE',
  'HOMEPATH',
  'LOGONSERVER',
  'PATH',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
];

/**
 * The sealed process's environment: nothing of the gateway's. On Windows,
 * only `SYSTEMROOT`, which Windows itself needs to start a process.
 */
export function sealedEnv(platform: NodeJS.Platform = process.platform): Record<string, string> {
  if (platform !== 'win32') return {};
  const env = Object.fromEntries(WINDOWS_REQUIRED.map((name) => [name, '']));
  env.SYSTEMROOT = process.env.SYSTEMROOT ?? process.env.SystemRoot ?? String.raw`C:\Windows`;
  return env;
}

// ── What the sealed process may say ───────────────────────────────────────

const RawTool = z.object({
  name: z.string().max(200),
  title: z.string().max(2000).nullable(),
  description: z.string().max(10_000).nullable(),
  input: z.unknown(),
  changes: z.boolean().nullable(),
  runs: z.boolean(),
});

const FetchRequest = z.object({
  url: z.string().max(4000),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']),
  headers: z.record(z.string().max(200), z.string().max(8192)),
  body: z.string().optional(),
  bodyBase64: z.boolean().optional(),
});

const FromHost = z.discriminatedUnion('t', [
  z.object({ t: z.literal('ready'), tools: z.array(RawTool).max(64) }),
  z.object({ t: z.literal('broken'), message: z.string().max(2000) }),
  z.object({
    t: z.literal('result'),
    id: z.number().int().positive(),
    ok: z.boolean(),
    text: z
      .string()
      .max(RESULT_CHARS + 100)
      .optional(),
    json: z.unknown().optional(),
    message: z.string().max(2100).optional(),
  }),
  z.object({ t: z.literal('fetch'), id: z.number().int().positive(), request: FetchRequest }),
]);

// ── Checking what the model sends against a tool's input schema ───────────

type Schema = Record<string, unknown>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const typeOf = (value: unknown): string =>
  value === null
    ? 'null'
    : Array.isArray(value)
      ? 'array'
      : typeof value === 'number'
        ? Number.isInteger(value)
          ? 'integer'
          : 'number'
        : typeof value;

const TYPE_WORDS: Record<string, string> = {
  string: 'text',
  number: 'a number',
  integer: 'a whole number',
  boolean: 'true or false',
  object: 'an object',
  array: 'a list',
  null: 'null',
};

function fits(type: string, value: unknown): boolean {
  const actual = typeOf(value);
  return actual === type || (type === 'number' && actual === 'integer');
}

/**
 * Why `value` doesn't fit `schema`, in a sentence a model can act on, or
 * nothing when it does. A small subset of JSON Schema: `type`, `properties`,
 * `required`, `additionalProperties: false`, `enum`, `const`,
 * `minimum`/`maximum`, `minLength`/`maxLength`, `minItems`/`maxItems` and
 * `items`. Anything else in a schema is left to the tool.
 */
export function inputProblem(schema: unknown, value: unknown, where = 'input'): string | undefined {
  if (!isObject(schema)) return undefined;
  const s = schema as Schema;
  const label = where === 'input' ? 'The input' : `“${where}”`;
  const types = typeof s.type === 'string' ? [s.type] : Array.isArray(s.type) ? s.type : [];
  if (types.length && !types.some((t) => typeof t === 'string' && fits(t, value)))
    return `${label} must be ${types.map((t) => TYPE_WORDS[String(t)] ?? String(t)).join(' or ')}.`;
  if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(value)))
    return `${label} must be one of: ${s.enum.map((e) => JSON.stringify(e)).join(', ')}.`;
  if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(value))
    return `${label} must be ${JSON.stringify(s.const)}.`;
  if (typeof value === 'string') {
    const length = [...value].length;
    if (typeof s.minLength === 'number' && length < s.minLength)
      return `${label} must be at least ${s.minLength} characters.`;
    if (typeof s.maxLength === 'number' && length > s.maxLength)
      return `${label} must be at most ${s.maxLength} characters.`;
  }
  if (typeof value === 'number') {
    if (typeof s.minimum === 'number' && value < s.minimum)
      return `${label} must be at least ${s.minimum}.`;
    if (typeof s.maximum === 'number' && value > s.maximum)
      return `${label} must be at most ${s.maximum}.`;
  }
  if (Array.isArray(value)) {
    if (typeof s.minItems === 'number' && value.length < s.minItems)
      return `${label} needs at least ${s.minItems} items.`;
    if (typeof s.maxItems === 'number' && value.length > s.maxItems)
      return `${label} takes at most ${s.maxItems} items.`;
    if (isObject(s.items))
      for (const [i, item] of value.entries()) {
        const problem = inputProblem(s.items, item, `${where === 'input' ? '' : where}[${i}]`);
        if (problem) return problem;
      }
  }
  if (isObject(value)) {
    const properties = isObject(s.properties) ? s.properties : {};
    if (Array.isArray(s.required))
      for (const key of s.required)
        if (typeof key === 'string' && value[key] === undefined)
          return `Missing “${where === 'input' ? key : `${where}.${key}`}”.`;
    for (const [key, item] of Object.entries(value)) {
      const path = where === 'input' ? key : `${where}.${key}`;
      const rule = properties[key];
      if (rule === undefined) {
        if (s.additionalProperties === false)
          return `“${path}” isn’t something this tool takes. It takes: ${Object.keys(properties).join(', ') || 'nothing'}.`;
        continue;
      }
      const problem = inputProblem(rule, item, path);
      if (problem) return problem;
    }
  }
  return undefined;
}

// ── The runtime ───────────────────────────────────────────────────────────

interface Pending {
  child: ChildProcess;
  done: (outcome: AppCallOutcome) => void;
  timer: NodeJS.Timeout;
}

type Exit = 'stopped' | 'timeout' | 'crashed' | 'too-much';

export interface SealedRuntimeOptions extends RuntimeOptions {
  /** The runtime to start: `HOST_SCRIPT`, or a stand-in in tests. */
  hostScript?: string;
  /** How long a call (and starting) may take: `APP_LIMITS.callMs`. */
  callMs?: number;
  /** What its data folder may hold: `APP_LIMITS.data`. */
  dataLimit?: number;
}

export class SealedRuntime implements AppRuntime {
  #child: ChildProcess | undefined;
  #starting: Promise<AppToolDefinition[]> | undefined;
  #tools: AppToolDefinition[] | undefined;
  #pending = new Map<number, Pending>();
  #fetches = new Map<number, AbortController>();
  #lastId = 0;
  #idle: NodeJS.Timeout | undefined;
  #log = '';
  /** Why each process ended, when Conch ended it; anything else is a crash. */
  #why = new WeakMap<ChildProcess, Exit>();
  /** It crashed: the next start says it fixed that, once. */
  #healPending = false;

  constructor(private readonly options: SealedRuntimeOptions) {}

  get running(): boolean {
    const child = this.#child;
    return Boolean(child && child.exitCode === null && child.signalCode === null && !child.killed);
  }

  /** The end of what it wrote to stderr (`app.log`, a crash), for the app's health. */
  get log(): string {
    return this.#log;
  }

  get #name() {
    return this.options.manifest.name;
  }

  get #callMs() {
    return this.options.callMs ?? APP_LIMITS.callMs;
  }

  async definitions(): Promise<AppToolDefinition[]> {
    if (!this.options.manifest.tools) return [];
    return this.#ensure();
  }

  async list(): Promise<ConchAppTool[]> {
    const definitions = await this.definitions();
    const tools: ConchAppTool[] = [];
    for (const d of definitions) {
      if (!d.runs)
        throw new Error(
          `The tool “${d.name.slice(0, 40)}” has no run function: add run(input, app).`,
        );
      const parsed = ConchAppTool.safeParse({
        name: d.name,
        title: d.title ?? '',
        description: d.description ?? '',
        changes: d.changes === true,
      });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path.join('.') || 'it';
        throw new Error(
          `The tool “${d.name.slice(0, 40)}” doesn’t fit: its ${field} ${issue?.message.charAt(0).toLowerCase()}${issue?.message.slice(1) ?? ''}`.trim(),
        );
      }
      tools.push(parsed.data);
    }
    return tools;
  }

  async call(
    tool: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AppCallOutcome> {
    if (!this.options.manifest.tools) return { ok: false, text: `${this.#name} has no tools.` };
    let definitions: AppToolDefinition[];
    try {
      definitions = await this.#ensure();
    } catch (error) {
      return { ok: false, text: error instanceof Error ? error.message : String(error) };
    }
    const definition = definitions.find((d) => d.name === tool && d.runs);
    if (!definition)
      return {
        ok: false,
        text: `${this.#name} has no tool called “${tool.slice(0, 40)}”. Its tools are: ${definitions.map((d) => d.name).join(', ') || 'none'}.`,
      };
    const problem = inputProblem(definition.input, input);
    if (problem) return { ok: false, text: `${problem} Check the tool’s input and call it again.` };
    if (signal?.aborted) return { ok: false, text: 'Stopped before it started.' };
    const child = this.#child;
    if (!child || !this.running)
      return { ok: false, text: `${this.#name}’s tools stopped just then. Try again.` };
    const id = ++this.#lastId;
    this.#touch();
    return new Promise<AppCallOutcome>((resolve) => {
      let settled = false;
      const done = (outcome: AppCallOutcome) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve(outcome);
      };
      const onAbort = () => done({ ok: false, text: 'Stopped.' });
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => {
        // The process may be mid-anything: it's stopped, and starts afresh next time.
        this.#kill('timeout');
        done({
          ok: false,
          text: `“${tool}” took longer than ${Math.round(this.#callMs / 1000)} seconds, so Conch stopped it. Try again with less to do at once.`,
        });
      }, this.#callMs);
      this.#pending.set(id, {
        child,
        timer,
        done: (outcome) => {
          clearTimeout(timer);
          this.#pending.delete(id);
          this.#touch();
          done(outcome);
        },
      });
      this.#send(child, { t: 'call', id, tool, input });
    });
  }

  async stop(): Promise<void> {
    clearTimeout(this.#idle);
    const child = this.#child;
    if (!child) return;
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once('exit', () => resolve());
    });
    this.#kill('stopped');
    await exited;
  }

  // ── Starting ──

  #ensure(): Promise<AppToolDefinition[]> {
    if (this.#tools && this.running) return Promise.resolve(this.#tools);
    this.#starting ??= this.#start().finally(() => {
      this.#starting = undefined;
    });
    return this.#starting;
  }

  async #start(): Promise<AppToolDefinition[]> {
    const toolsPath = this.options.manifest.tools as string;
    await mkdir(this.options.dataDir, { recursive: true });
    // The permission model compares real paths: a link or an 8.3 name would otherwise miss.
    const [host, appDir, dataDir] = await Promise.all([
      realpath(this.options.hostScript ?? HOST_SCRIPT),
      realpath(this.options.appDir),
      realpath(this.options.dataDir),
    ]);
    const settings = await this.options.settings();
    this.#tools = undefined;
    const child = spawn(process.execPath, sealedArgs({ host, appDir, dataDir }), {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      // Nothing of the gateway's: no PATH, no keys, no NODE_OPTIONS.
      env: sealedEnv(),
      cwd: dataDir,
      windowsHide: true,
      serialization: 'json',
    });
    this.#child = child;
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.#log = (this.#log + chunk).slice(-LOG_CHARS);
    });
    const ready = new Promise<AppToolDefinition[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#kill('timeout');
        reject(
          new Error(
            `${this.#name}’s tools took longer than ${Math.round(this.#callMs / 1000)} seconds to load, so Conch stopped them. Make what ${toolsPath} does when it loads quicker.`,
          ),
        );
      }, this.#callMs);
      child.on('message', (raw: unknown) => {
        const message = this.#read(child, raw);
        if (!message) return;
        if (message.t === 'ready') {
          clearTimeout(timer);
          resolve(message.tools);
        } else if (message.t === 'broken') {
          clearTimeout(timer);
          this.#kill('stopped');
          reject(new Error(`${toolsPath} didn’t load: ${message.message}`));
        } else if (message.t === 'result') {
          const pending = this.#pending.get(message.id);
          pending?.done(
            message.ok
              ? {
                  ok: true,
                  text: message.text ?? 'Done.',
                  ...(message.json !== undefined && { json: message.json }),
                }
              : { ok: false, text: message.message ?? 'The tool failed without saying why.' },
          );
        } else this.#fetch(child, message.id, message.request);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new Error(`${this.#name}’s tools couldn’t start: ${error.message}`));
      });
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        const why = this.#why.get(child) ?? 'crashed';
        if (this.#child === child) {
          this.#child = undefined;
          this.#tools = undefined;
          for (const controller of this.#fetches.values()) controller.abort();
          this.#fetches.clear();
        }
        this.#failPending(child, why);
        if (why === 'crashed') this.#healPending = true;
        const last = this.#log.trim().split('\n').at(-1)?.slice(0, 300);
        reject(
          new Error(
            `${this.#name}’s tools stopped as they loaded${code !== null ? ` (exit ${code})` : signal ? ` (${signal})` : ''}${last ? `: ${last}` : '.'}`,
          ),
        );
      });
    });
    this.#send(child, {
      t: 'init',
      appDir,
      dataDir,
      tools: toolsPath,
      settings,
      limits: {
        data: this.options.dataLimit ?? APP_LIMITS.data,
        fetchOut: APP_LIMITS.fetchOut,
        text: RESULT_CHARS,
        error: 2000,
      },
    });
    const tools = await ready;
    this.#tools = tools;
    if (this.#healPending) {
      this.#healPending = false;
      this.options.heal?.(
        `${this.#name}’s tools stopped unexpectedly, so Conch started them again.`,
      );
    }
    this.#touch();
    return tools;
  }

  /** A message from the process, checked; anything else stops it. */
  #read(child: ChildProcess, raw: unknown): z.infer<typeof FromHost> | undefined {
    let size = 0;
    try {
      size = JSON.stringify(raw)?.length ?? 0;
    } catch {
      size = Infinity;
    }
    if (size > MAX_MESSAGE) {
      if (this.#child === child) this.#kill('too-much');
      return undefined;
    }
    const parsed = FromHost.safeParse(raw);
    if (!parsed.success) {
      // It only ever speaks through host.mjs: anything else means something's wrong in there.
      if (this.#child === child) this.#kill('crashed');
      return undefined;
    }
    return parsed.data;
  }

  #send(child: ChildProcess, message: unknown) {
    if (!child.connected) return;
    try {
      child.send(message as object, (error) => {
        if (error && this.#child === child) this.#kill('crashed');
      });
    } catch {
      if (this.#child === child) this.#kill('crashed');
    }
  }

  // ── app.fetch ──

  #fetch(child: ChildProcess, id: number, request: z.infer<typeof FetchRequest>) {
    const answer = (response: AppFetchResponse) =>
      this.#send(child, { t: 'fetched', id, response });
    const refused = (message: string): AppFetchResponse => ({
      ok: false,
      status: 0,
      headers: {},
      body: '',
      refused: message,
    });
    // Only while one of its tools is running: never in the background, after a call has answered.
    if (!this.#pending.size)
      return answer(refused('app.fetch only works while one of the app’s tools is running.'));
    const controller = new AbortController();
    this.#fetches.set(id, controller);
    this.options
      .fetcher(
        { id: this.options.manifest.id, reaches: this.options.manifest.reaches },
        { ...request, ...(request.bodyBase64 !== undefined && { bodyBase64: request.bodyBase64 }) },
        controller.signal,
      )
      .then(
        (response) => answer(response),
        (error: unknown) =>
          answer(
            refused(
              error instanceof Error && error.message
                ? error.message
                : 'Conch couldn’t make that request.',
            ),
          ),
      )
      .finally(() => this.#fetches.delete(id));
  }

  // ── Stopping ──

  #kill(why: Exit) {
    const child = this.#child;
    if (!child) return;
    if (!this.#why.has(child)) this.#why.set(child, why);
    this.#tools = undefined;
    clearTimeout(this.#idle);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }

  #failPending(child: ChildProcess, why: Exit) {
    const text =
      why === 'timeout'
        ? `${this.#name}’s tools were stopped because a call took too long. Try again.`
        : why === 'too-much'
          ? `${this.#name}’s tools sent back more than Conch takes, so it stopped them. Return less at once.`
          : why === 'stopped'
            ? `${this.#name}’s tools were stopped.`
            : `${this.#name}’s tools stopped while working (they crashed). Try again: Conch starts them afresh.`;
    for (const pending of [...this.#pending.values()])
      if (pending.child === child) pending.done({ ok: false, text });
  }

  /** Stops after `idleMs` with nothing to do. */
  #touch() {
    clearTimeout(this.#idle);
    if (this.#pending.size || !this.#child) return;
    this.#idle = setTimeout(() => void this.stop(), this.options.idleMs ?? IDLE_MS);
    this.#idle.unref();
  }
}

export function createRuntime(options: SealedRuntimeOptions): SealedRuntime {
  return new SealedRuntime(options);
}
