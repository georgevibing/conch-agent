/**
 * A model on this computer, kept working (ADR 0022).
 *
 * The one place that knows where Ollama is and how it is: installed, running,
 * which models it has. It starts Ollama quietly when it has stopped (and says
 * so in "Fixed on its own"), downloads the model a person asked for with real
 * progress — pausable, cancellable, and never one that won't fit — and hands
 * the engine what it needs (`OllamaLink`).
 *
 * Nothing here reaches the internet except a pull, which Ollama does itself
 * when a person presses Download. Detection, the model list and starting
 * Ollama all happen on this computer, so they work offline.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { readdir, statfs } from 'node:fs/promises';
import { homedir, totalmem } from 'node:os';
import { dirname, join } from 'node:path';

import {
  LocalModelName,
  type DoctorItem,
  type EngineStatus,
  type LocalModel,
  type LocalPull,
  type LocalStatus,
  type OllamaState,
} from '@conch/protocol';
import { z } from 'zod';

import type { DoctorCheck } from '../doctor/service';
import { LOCAL_LABEL, type OllamaLink } from '../engines/api/ollama';
import { ApiError, type FetchLike } from '../engines/api/types';
import { Mutex, writeJson } from '../lib/fs';
import { agentEnv, presentSync } from '../lib/proc';
import { readStore } from '../lib/recover';
import type { NeedSpec, Platform, Setup } from '../setup/needs';
import { ollamaHost, type OllamaHost } from './host';
import {
  atLeast,
  catalogModel,
  DISK_SPARE,
  fitsMemory,
  gigabytes,
  labelFor,
  offersFor,
  sortModels,
} from './models';
import { OllamaClient, contextLength } from './ollama';
import { explainPull, PullMeter } from './pull';

/** How long Ollama gets to answer after Conch starts it (the first start finds the GPU). */
const START_TIMEOUT_MS = 25_000;
/** A finished download stays on the page this long, so "ready" is seen. */
const DONE_KEPT_MS = 2 * 60_000;

const LocalFile = z.object({
  version: z.literal(1).default(1),
  /** The model local chats use unless one is picked. */
  model: LocalModelName.optional(),
  /** How fast the last download went, for honest estimates next time. */
  bytesPerSecond: z.number().positive().optional(),
});
type LocalFile = z.infer<typeof LocalFile>;

export class LocalError extends Error {
  constructor(
    message: string,
    readonly code: 'not-found' | 'invalid' | 'unavailable' = 'invalid',
  ) {
    super(message);
  }
}

type Spawn = typeof nodeSpawn;

export interface LocalDeps {
  home: string;
  setup: Setup;
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
  spawn?: Spawn;
  /** This computer's memory, in bytes. */
  memory?: () => number;
  /** Free bytes on the disk that holds `dir`. */
  freeDisk?: (dir: string) => Promise<number | undefined>;
  /** "Fixed on its own" (`services.healed.note('providers', …)`). */
  heal?: (message: string) => void;
  /** Something changed that the engine should see (a model arrived, Ollama started). */
  onChange?: () => void;
  startTimeoutMs?: number;
  now?: () => number;
}

interface PullJob {
  model: string;
  label: string;
  state: LocalPull['state'];
  meter: PullMeter;
  controller?: AbortController;
  message?: string;
  startedAt: number;
  finishedAt?: number;
  done: Promise<void>;
}

/** Free space on the disk holding `dir` (or the nearest folder above it that exists). */
async function freeDiskOf(dir: string): Promise<number | undefined> {
  let at = dir;
  for (let i = 0; i < 12; i++) {
    try {
      const stats = await statfs(at);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      const up = dirname(at);
      if (up === at) return undefined;
      at = up;
    }
  }
  return undefined;
}

export class LocalService implements OllamaLink {
  readonly client: OllamaClient;
  #file?: LocalFile;
  #mutex = new Mutex();
  #starting?: Promise<boolean>;
  #shown = new Map<string, { digest: string; show: Awaited<ReturnType<OllamaClient['show']>> }>();
  #context = new Map<string, number>();
  #job?: PullJob;
  /** Ollama's version the last time it answered, for the model offers. */
  #version?: string;

  constructor(private readonly deps: LocalDeps) {
    this.client = new OllamaClient(() => this.host().url, deps.fetch);
  }

  // ── Where it is ─────────────────────────────────────────────────────────

  host(): OllamaHost {
    return ollamaHost((this.deps.env ?? process.env).OLLAMA_HOST);
  }

  #need(): NeedSpec | undefined {
    return this.deps.setup.spec('ollama');
  }

  /** The Ollama program, when it's installed. */
  async program(): Promise<string | undefined> {
    const need = this.#need();
    return need ? this.deps.setup.path(need) : undefined;
  }

  get #platform(): Platform {
    return this.deps.setup.platform;
  }

  /** Where Ollama keeps models: `OLLAMA_MODELS`, else `~/.ollama/models`. */
  modelsDir(): string {
    const env = this.deps.env ?? process.env;
    return env.OLLAMA_MODELS?.trim() || join(homedir(), '.ollama', 'models');
  }

  /**
   * Whether someone uses local models here: a model on disk, or one chosen in
   * Conch. Only then does Conch start a stopped Ollama by itself — an Ollama
   * installed for something else, and quit on purpose, is left alone.
   */
  async #wanted(): Promise<boolean> {
    if ((await this.#settings()).model) return true;
    const manifests = join(this.modelsDir(), 'manifests');
    const entries = await readdir(manifests).catch(() => [] as string[]);
    return entries.length > 0;
  }

  // ── Settings ────────────────────────────────────────────────────────────

  get #path() {
    return join(this.deps.home, 'local.json');
  }

  async #settings(): Promise<LocalFile> {
    if (!this.#file) {
      const read = await readStore(this.#path, LocalFile, {
        onRepair: () =>
          this.deps.heal?.(
            'The settings for the model on this computer couldn’t be read, so Conch kept a copy and started them afresh.',
          ),
      }).catch(() => undefined);
      this.#file ??= read?.value ?? LocalFile.parse({});
    }
    return this.#file;
  }

  #save(patch: Partial<LocalFile>): Promise<void> {
    return this.#mutex.run(async () => {
      const next = LocalFile.parse({ ...(await this.#settings()), ...patch });
      await writeJson(this.#path, next);
      this.#file = next;
    });
  }

  // ── Running ─────────────────────────────────────────────────────────────

  /** Ollama's version when it's running here; undefined when it isn't (or isn't allowed). */
  async running(): Promise<string | undefined> {
    if (this.host().refused) return undefined;
    const version = await this.client.version();
    if (version) this.#version = version;
    return version;
  }

  /**
   * Start Ollama if it's installed and stopped, and wait until it answers.
   * Single-flight: two turns that find it stopped start it once. With `note`,
   * a start leaves a "fixed on its own" line; a person pressing a button
   * doesn't need one.
   */
  ensureRunning(options: { note: boolean }): Promise<boolean> {
    this.#starting ??= this.#start(options.note).finally(() => (this.#starting = undefined));
    return this.#starting;
  }

  async #start(note: boolean): Promise<boolean> {
    if (this.host().refused) return false;
    if (await this.running()) return true;
    // The program is on disk before its installer is done; starting it then
    // leaves an app with no server behind. Wait for the install instead.
    if (await this.#installing()) return false;
    const program = await this.program();
    if (!program) return false;
    const now = this.deps.now ?? Date.now;
    const timeout = this.deps.startTimeoutMs ?? START_TIMEOUT_MS;
    const up = async (until: number) => {
      while (now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (await this.running()) return true;
      }
      return false;
    };
    const quiet = this.#launch(program);
    // The app may be there already without its server (it exits when another
    // copy runs): then `ollama serve` itself is the next good option.
    let started = await up(now() + (quiet ? timeout / 2 : timeout));
    if (!started && quiet) {
      this.#spawn(program, ['serve']);
      started = await up(now() + timeout / 2);
    }
    if (!started) return false;
    if (note) this.deps.heal?.('Ollama wasn’t running, so Conch started it.');
    this.deps.onChange?.();
    return true;
  }

  async #installing(): Promise<boolean> {
    const need = this.#need();
    if (!need) return false;
    const readiness = await this.deps.setup.readiness([need]).catch(() => undefined);
    return readiness?.needs[0]?.state === 'installing';
  }

  /**
   * Start it the quiet way for each system: the Windows app hidden in the
   * tray, the Mac app hidden, else `ollama serve` in the background. Says
   * whether it was the app (which can fail quietly) rather than the server.
   */
  #launch(program: string): boolean {
    if (this.#platform === 'win32') {
      const app = join(dirname(program), 'ollama app.exe');
      if (presentSync(app)) {
        this.#spawn(app, ['--hide', '--fast-startup']);
        return true;
      }
    } else if (this.#platform === 'darwin') {
      const at = program.indexOf('/Ollama.app/Contents/Resources/');
      if (at !== -1) {
        this.#spawn('open', ['-j', '-a', program.slice(0, at + '/Ollama.app'.length)]);
        return true;
      }
    }
    this.#spawn(program, ['serve']);
    return false;
  }

  /** Detached, so it outlives Conch, with Conch's own settings kept out of its environment. */
  #spawn(command: string, args: string[]): void {
    const spawn = this.deps.spawn ?? nodeSpawn;
    try {
      const child = spawn(command, args, {
        env: agentEnv(),
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('error', () => undefined);
      child.unref();
    } catch {
      // Not starting is reported by the wait that follows.
    }
  }

  // ── Models ──────────────────────────────────────────────────────────────

  /** Models here that can chat, with what each can do. Never reaches the internet. */
  async models(): Promise<LocalModel[]> {
    const tags = await this.client.tags();
    const chosen = (await this.#settings()).model;
    const models = await Promise.all(
      tags.map(async (tag): Promise<LocalModel | undefined> => {
        const name = LocalModelName.safeParse(tag.name);
        if (!name.success) return undefined;
        const show = await this.#show(tag.name, tag.digest ?? '').catch(() => undefined);
        const caps = show?.capabilities ?? [];
        // An embedding model can't chat; one that doesn't say is given the benefit of the doubt.
        if (caps.length && !caps.includes('completion')) return undefined;
        const context = show && contextLength(show);
        if (context) this.#context.set(tag.name, context);
        const parameters = tag.details?.parameter_size ?? undefined;
        return {
          name: tag.name,
          label: labelFor(tag.name, parameters),
          sizeBytes: Math.max(0, tag.size ?? 0),
          tools: caps.includes('tools'),
          vision: caps.includes('vision'),
          thinking: caps.includes('thinking'),
          ...(parameters && { parameters }),
        };
      }),
    );
    return sortModels(
      models.filter((m): m is LocalModel => Boolean(m)),
      chosen,
    );
  }

  async #show(name: string, digest: string) {
    const cached = this.#shown.get(name);
    if (cached && cached.digest === digest) return cached.show;
    const show = await this.client.show(name);
    this.#shown.set(name, { digest, show });
    return show;
  }

  /**
   * The context to ask for: 16K tokens on a computer with less than 12 GB of
   * memory, 32K above, never more than the model can read. The same number
   * every time for a model, or Ollama would reload it between requests.
   */
  contextFor(model: string): number {
    const budget = this.#memory() < 12 * 1024 ** 3 ? 16_384 : 32_768;
    const max = this.#context.get(model);
    return max ? Math.min(max, budget) : budget;
  }

  async loaded(model: string): Promise<boolean> {
    const loaded = await this.client.loaded();
    return loaded.some((m) => m.name === model || m.model === model);
  }

  #memory(): number {
    return (this.deps.memory ?? totalmem)();
  }

  /** The model local chats use unless one is picked. */
  async choose(name: string): Promise<LocalStatus> {
    const models = await this.models().catch(() => []);
    if (!models.some((m) => m.name === name))
      throw new LocalError(`${name} isn’t on this computer.`, 'not-found');
    await this.#save({ model: name });
    this.deps.onChange?.();
    return this.status();
  }

  // ── Where it stands ─────────────────────────────────────────────────────

  async #ollama(options: { heal: boolean }): Promise<LocalStatus['ollama']> {
    const host = this.host();
    if (host.refused) {
      return {
        state: 'elsewhere',
        message: `OLLAMA_HOST is set to “${host.refused}”, which isn’t this computer. Conch only uses a model on this computer, so it doesn’t follow it: remove OLLAMA_HOST, or set it to 127.0.0.1.`,
      };
    }
    let version = await this.running();
    const path = await this.program();
    if (!version && path && options.heal && (await this.#wanted())) {
      if (await this.ensureRunning({ note: true })) version = await this.running();
    }
    let state: OllamaState = version ? 'running' : path ? 'stopped' : 'missing';
    if (!version && this.#starting) state = 'starting';
    return {
      state,
      ...(version && { version }),
      ...(path && { path }),
      ...(state === 'stopped' && {
        message: 'Ollama is installed but isn’t running. Conch starts it when it’s needed.',
      }),
    };
  }

  /** Everything the page shows. Starts a stopped Ollama when someone uses it (`#wanted`). */
  async status(options: { heal?: boolean } = {}): Promise<LocalStatus> {
    const ollama = await this.#ollama({ heal: options.heal ?? true });
    const models = ollama.state === 'running' ? await this.models().catch(() => []) : [];
    const settings = await this.#settings();
    const freeDisk = await (this.deps.freeDisk ?? freeDiskOf)(this.modelsDir()).catch(
      () => undefined,
    );
    const chosen =
      settings.model && models.some((m) => m.name === settings.model)
        ? settings.model
        : models[0]?.name;
    return {
      ollama,
      models,
      ...(chosen && { chosen }),
      offers: offersFor({
        memoryBytes: this.#memory(),
        ...(freeDisk !== undefined && { freeDiskBytes: freeDisk }),
        ...(this.#version && { version: this.#version }),
        installed: models.map((m) => m.name),
        ...(settings.bytesPerSecond && { bytesPerSecond: settings.bytesPerSecond }),
      }),
      machine: {
        memoryBytes: this.#memory(),
        ...(freeDisk !== undefined && { freeDiskBytes: freeDisk }),
      },
      ...(this.#pullNow() && { pull: this.#pullNow() }),
    };
  }

  /** How it is, for the provider card and the model picker. */
  async engineStatus(): Promise<EngineStatus> {
    const base = {
      engine: 'ollama' as const,
      label: LOCAL_LABEL,
      install: this.#installHints(),
      docsUrl: 'https://docs.ollama.com',
      canSignIn: false,
      checkedAt: Date.now(),
    };
    const ollama = await this.#ollama({ heal: true });
    const paths = {
      ...(ollama.path && { executablePath: ollama.path }),
      ...(ollama.version && { version: `Ollama ${ollama.version}` }),
    };
    if (ollama.state === 'elsewhere') return { ...base, state: 'error', message: ollama.message };
    if (ollama.state === 'missing') {
      return {
        ...base,
        state: 'not-installed',
        message: 'Ollama runs the model. It isn’t on this computer yet.',
        fix: { need: 'ollama', kind: 'install' },
      };
    }
    if (ollama.state !== 'running') {
      return (await this.#wanted())
        ? {
            ...base,
            ...paths,
            state: 'error',
            message: 'Ollama is installed but didn’t start. Open Ollama once, or press Repair.',
          }
        : {
            ...base,
            ...paths,
            state: 'not-installed',
            message: 'Get a model to start chatting. It’s free, and it runs on this computer.',
          };
    }
    const models = await this.models().catch(() => undefined);
    if (!models) {
      return { ...base, ...paths, state: 'error', message: 'Ollama didn’t list its models.' };
    }
    if (!models.length) {
      return {
        ...base,
        ...paths,
        state: 'not-installed',
        message: 'Get a model to start chatting. It’s free, and it runs on this computer.',
      };
    }
    const settings = await this.#settings();
    const chosen = models.find((m) => m.name === settings.model) ?? models[0];
    const more = models.length > 1 ? ` and ${models.length - 1} more` : '';
    return {
      ...base,
      ...paths,
      state: 'ready',
      auth: {
        method: 'other',
        description: `${chosen?.label ?? 'A model'}${more} · works offline`,
      },
    };
  }

  #installHints() {
    if (this.#platform === 'win32')
      return [{ label: 'winget', command: 'winget install --id Ollama.Ollama --exact' }];
    if (this.#platform === 'darwin')
      return [{ label: 'Homebrew', command: 'brew install --cask ollama-app' }];
    return [];
  }

  // ── Downloads ───────────────────────────────────────────────────────────

  #pullNow(): LocalPull | undefined {
    const job = this.#job;
    if (!job) return undefined;
    const now = (this.deps.now ?? Date.now)();
    if (job.state === 'done' && job.finishedAt && now - job.finishedAt > DONE_KEPT_MS) {
      this.#job = undefined;
      return undefined;
    }
    return job.meter.snapshot({
      model: job.model,
      label: job.label,
      state: job.state,
      ...(job.message && { message: job.message }),
    });
  }

  /**
   * Get a model Conch suggests. Checks first that it will run here and that
   * there's room for it, then starts Ollama if it has to and follows the
   * download. Resolves once it has started; the page follows `status().pull`.
   */
  async pull(name: string): Promise<LocalStatus> {
    const model = catalogModel(name);
    if (!model) throw new LocalError('Conch only downloads the models it suggests.', 'not-found');
    const job = this.#job;
    if (job && job.state === 'pulling') {
      if (job.model === name) return this.status();
      throw new LocalError(
        `Conch is already getting ${job.label}. Wait for it, or cancel it first.`,
      );
    }
    if (!fitsMemory(model.sizeBytes, this.#memory())) {
      throw new LocalError(
        `${model.label} needs more memory than this computer has, so Conch won’t download it. Pick a smaller one.`,
      );
    }
    const resumed = job && job.model === name && job.state !== 'done' ? job : undefined;
    const already = resumed?.meter.completedBytes ?? 0;
    const free = await (this.deps.freeDisk ?? freeDiskOf)(this.modelsDir()).catch(() => undefined);
    const wanted = model.sizeBytes - already + DISK_SPARE;
    if (free !== undefined && free < wanted) {
      throw new LocalError(
        `${model.label} needs ${gigabytes(wanted)} of free space, and this computer has ${gigabytes(free)}. Free up about ${gigabytes(wanted - free)}, then try again.`,
      );
    }
    if (!(await this.ensureRunning({ note: false }))) {
      throw new LocalError(
        (await this.program())
          ? 'Ollama didn’t start. Open it once, then try again.'
          : 'Install Ollama first: it’s what runs the model.',
        'unavailable',
      );
    }
    if (!atLeast(this.#version, model.minVersion)) {
      throw new LocalError(
        `${model.label} needs a newer Ollama (${model.minVersion} or later). Update Ollama, then try again.`,
      );
    }
    this.#begin(name, model.label, resumed);
    return this.status();
  }

  #begin(model: string, label: string, resumed: PullJob | undefined): void {
    const now = this.deps.now ?? Date.now;
    const meter = resumed?.meter ?? new PullMeter(now);
    meter.resume();
    const controller = new AbortController();
    const job: PullJob = {
      model,
      label,
      state: 'pulling',
      meter,
      controller,
      startedAt: now(),
      done: Promise.resolve(),
    };
    this.#job = job;
    const before = meter.completedBytes;
    job.done = (async () => {
      try {
        for await (const line of this.client.pull(model, controller.signal)) meter.update(line);
        if (!meter.done) throw new ApiError('network', 'The download ended early.');
        job.state = 'done';
        job.finishedAt = now();
        const seconds = (now() - job.startedAt) / 1000;
        const bytes = meter.completedBytes - before;
        const settings = await this.#settings();
        await this.#save({
          // The first model becomes the one local chats use.
          ...(!settings.model && { model }),
          ...(seconds > 5 && bytes > 50_000_000 && { bytesPerSecond: bytes / seconds }),
        });
        this.deps.onChange?.();
      } catch (error) {
        // Paused or cancelled: the state was set by whoever stopped it.
        if (controller.signal.aborted) return;
        job.state = 'failed';
        job.message = explainPull((error as Error).message, label);
      } finally {
        job.controller = undefined;
      }
    })();
  }

  /** Stop the download, keeping what's here; `pull` again carries on from it. */
  pause(): LocalPull | undefined {
    const job = this.#job;
    if (job?.state !== 'pulling') return this.#pullNow();
    job.state = 'paused';
    job.controller?.abort();
    return this.#pullNow();
  }

  /** Stop the download and forget it. Ollama tidies away the part it had. */
  cancel(): void {
    const job = this.#job;
    if (!job) return;
    this.#job = undefined;
    job.controller?.abort();
  }

  /** For tests and callers that want to carry on once a download settles. */
  async settled(): Promise<void> {
    await this.#job?.done;
  }

  // ── Repair everything ───────────────────────────────────────────────────

  /**
   * The `local-model` check. Not set up is not a problem ("off"); a stopped
   * Ollama that someone uses is started by a repair.
   */
  doctorCheck(): DoctorCheck {
    const item = (state: DoctorItem['state'], message: string, action?: DoctorItem['action']) => ({
      id: 'local-model:ollama',
      group: 'Providers',
      title: 'Model on this computer',
      state,
      message,
      ...(action && { action }),
    });
    const open = (label: string): DoctorItem['action'] => ({
      kind: 'open',
      label,
      place: 'providers',
      focus: 'ollama',
    });
    return {
      id: 'local-model',
      group: 'Providers',
      title: 'Model on this computer',
      run: async ({ repair }) => {
        const before = await this.#ollama({ heal: false });
        if (before.state === 'elsewhere')
          return [item('needs-you', before.message ?? '', open('Open providers'))];
        if (before.state === 'missing')
          return [
            item(
              'off',
              'Not set up. A private model that works offline is one click away.',
              open('Set it up'),
            ),
          ];
        let state = before.state;
        let started = false;
        if (state !== 'running' && (repair || this.#starting)) {
          started = await this.ensureRunning({ note: false });
          state = started ? 'running' : 'stopped';
        }
        if (state !== 'running') {
          return (await this.#wanted())
            ? [
                item(
                  repair ? 'needs-you' : 'warning',
                  repair
                    ? 'Ollama didn’t start. Open it once, then look again.'
                    : 'Ollama isn’t running. Repair starts it.',
                  repair ? open('Open providers') : undefined,
                ),
              ]
            : [item('off', 'Ollama is installed, with no model yet.', open('Get a model'))];
        }
        const models = await this.models().catch(() => []);
        if (!models.length)
          return [item('off', 'Ollama is running, with no model yet.', open('Get a model'))];
        const picked = (await this.#settings()).model;
        const chosen = models.find((m) => m.name === picked) ?? (models[0] as LocalModel);
        const more = models.length > 1 ? `, and ${models.length - 1} more` : '';
        return [
          started
            ? item('fixed', `Started Ollama. ${chosen.label} is ready${more}.`)
            : item('ok', `${chosen.label} is ready${more}.`),
        ];
      },
    };
  }
}
