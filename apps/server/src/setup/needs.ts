/**
 * What a feature needs from this computer, and getting it (ADR 0016).
 *
 * A need knows where it really lives — on `PATH`, behind a Windows app alias,
 * inside a macOS app bundle — and, where the computer has a package manager
 * that works without an administrator (winget, Homebrew, or npm through
 * Conch's own Node), how to install or update itself. Conch offers that install as one button, shows its progress, and
 * looks again by itself when it's done. What Conch can't install, it links to.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform as osPlatform } from 'node:os';
import { dirname, join } from 'node:path';

import type { Need, Readiness } from '@conch/protocol';

import { agentEnv, findExecutable, launch, type Launch } from '../lib/proc';

export type Platform = 'win32' | 'darwin' | 'linux';

/** An install through the computer's own package manager, run as you. */
export interface InstallRecipe {
  manager: 'winget' | 'brew' | 'npm';
  args: string[];
}

type Recipes = InstallRecipe | InstallRecipe[];

/**
 * npm as Conch's own Node has it, so an npm install works even when no npm is
 * on PATH (Conch runs on Node, so there always is one). Falls back to PATH.
 */
export async function ownNpm(): Promise<string | undefined> {
  const node = dirname(process.execPath);
  const candidates = [
    join(node, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(node, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.find((path) => existsSync(path)) ?? (await findExecutable('npm'));
}

/** How to start a package manager found at `path` (a `.js` runs with Conch's own Node). */
function launchOf(path: string): Launch {
  return /\.[cm]?js$/i.test(path) ? { command: process.execPath, prefix: [path] } : launch(path);
}

export interface NeedSpec {
  id: string;
  /** "The 1Password app" */
  name: string;
  /** Short, for buttons and progress: "1Password". */
  short: string;
  /** Where it exists at all; unset means everywhere. */
  platforms?: Platform[];
  /** Its absolute path, when it's here. */
  find(platform: Platform): Promise<string | undefined>;
  /** How to install it here, best first; the first whose package manager is present is used. */
  install?: Partial<Record<Platform, Recipes>>;
  /** How to bring the copy at `path` up to date: the same way it was installed. */
  update?: (path: string, platform: Platform) => InstallRecipe[];
  download?: Partial<Record<Platform, string>>;
  /** The need whose app Conch opens so you can change a setting (often itself). */
  opens?: string;
  /** Another need that brings this one: install that, and this comes too. */
  comesWith?: string;
  /** What to say while it's missing, given what else is here. */
  hint?: (has: (id: string) => boolean) => string | undefined;
}

type Spawn = typeof nodeSpawn;

export interface SetupDeps {
  platform?: Platform;
  /** Finds a package manager; tests point it at a fake. */
  manager?: (name: InstallRecipe['manager']) => Promise<string | undefined>;
  spawn?: Spawn;
  /** Longest an install may take. */
  timeoutMs?: number;
}

interface Job {
  kind: 'install' | 'update';
  progress: { percent?: number; label: string };
  done: Promise<void>;
}

const list = (recipes: Recipes | undefined): InstallRecipe[] =>
  recipes === undefined ? [] : Array.isArray(recipes) ? recipes : [recipes];

const INSTALL_TIMEOUT_MS = 15 * 60_000;

/** "42%" or "12.5 MB / 30 MB", as winget and Homebrew print them. */
const PERCENT = /(\d{1,3}(?:\.\d+)?)\s?%/;
const AMOUNT = /([\d.]+)\s*(KB|MB|GB)\s*\/\s*([\d.]+)\s*(KB|MB|GB)/i;
const UNIT: Record<string, number> = { KB: 1, MB: 1024, GB: 1024 * 1024 };

/** What an installer's output says about how far it got. */
export function readProgress(line: string): number | undefined {
  const amount = AMOUNT.exec(line);
  if (amount) {
    const done = Number(amount[1]) * (UNIT[(amount[2] ?? '').toUpperCase()] ?? 1);
    const total = Number(amount[3]) * (UNIT[(amount[4] ?? '').toUpperCase()] ?? 1);
    if (total > 0) return Math.min(100, Math.round((done / total) * 100));
  }
  const percent = PERCENT.exec(line);
  return percent ? Math.min(100, Math.round(Number(percent[1]))) : undefined;
}

/** An installer's failure, in words a person can act on. */
export function explainInstall(output: string, what: string): string {
  if (
    /0x80072ee7|0x80072efd|0x80072ee2|resolve host|ENOTFOUND|network|internet|timed? ?out/i.test(
      output,
    )
  )
    return `Couldn’t download ${what}: the internet seems to be unreachable.`;
  if (/0x800704c7|cancell?ed|denied by user|user declined/i.test(output))
    return `The install was cancelled, so ${what} wasn’t installed.`;
  if (/0x80070070|ENOSPC|no space|disk full/i.test(output))
    return `There isn’t enough disk space to install ${what}.`;
  if (/administrator|elevat|permission denied|EACCES/i.test(output))
    return `Installing ${what} needs an administrator. Get it from its website instead.`;
  return `Installing ${what} didn’t work. You can get it from its website instead.`;
}

/**
 * Looking for what features need, and installing it. Installs are
 * single-flight per need and their progress is kept in memory, so the page
 * can look away and come back.
 */
export class Setup {
  readonly platform: Platform;
  #jobs = new Map<string, Job>();
  #failed = new Map<string, string>();

  constructor(
    private readonly specs: ReadonlyMap<string, NeedSpec>,
    private readonly deps: SetupDeps = {},
  ) {
    const os = deps.platform ?? osPlatform();
    this.platform = os === 'win32' || os === 'darwin' ? os : 'linux';
  }

  spec(id: string): NeedSpec | undefined {
    return this.specs.get(id);
  }

  /** Where it is, when it's here. */
  path(spec: NeedSpec): Promise<string | undefined> {
    if (spec.platforms && !spec.platforms.includes(this.platform))
      return Promise.resolve(undefined);
    return spec.find(this.platform).catch(() => undefined);
  }

  async readiness(specs: NeedSpec[]): Promise<Readiness> {
    const found = new Map(
      await Promise.all(specs.map(async (s) => [s.id, await this.path(s)] as const)),
    );
    const has = (id: string) => Boolean(found.get(id));
    const needs = await Promise.all(specs.map((spec) => this.#describe(spec, has)));
    return { ready: needs.every((n) => n.state === 'ready'), needs };
  }

  async #describe(spec: NeedSpec, has: (id: string) => boolean): Promise<Need> {
    const base = { id: spec.id, name: spec.name, short: spec.short, openable: false };
    if (spec.platforms && !spec.platforms.includes(this.platform))
      return {
        ...base,
        state: 'unsupported',
        message: `${spec.name} isn’t made for this computer yet.`,
      };
    const opener = spec.opens ? this.specs.get(spec.opens) : undefined;
    const openable = Boolean(opener && has(opener.id));
    const job =
      this.#jobs.get(spec.id) ?? (spec.comesWith ? this.#jobs.get(spec.comesWith) : undefined);
    // An update runs while the old copy is still here, so the job comes first.
    if (job) return { ...base, state: 'installing', progress: job.progress, openable };
    if (has(spec.id)) {
      const failed = this.#failed.get(spec.id);
      return { ...base, state: 'ready', openable, ...(failed && { message: failed }) };
    }
    const recipe = await this.#recipe(spec);
    const download = spec.download?.[this.platform];
    const failed = this.#failed.get(spec.id);
    return {
      ...base,
      state: failed ? 'failed' : 'missing',
      message: failed ?? spec.hint?.(has),
      install: recipe && {
        label: `Install ${spec.short}`,
        command: [recipe.manager, ...recipe.args].join(' '),
      },
      download,
      openable,
    };
  }

  /** The install recipe to offer here: the first whose package manager is on this computer. */
  #recipe(spec: NeedSpec): Promise<InstallRecipe | undefined> {
    return this.#first(list(spec.install?.[this.platform]));
  }

  async #first(recipes: InstallRecipe[]): Promise<InstallRecipe | undefined> {
    for (const recipe of recipes) if (await this.#manager(recipe.manager)) return recipe;
    return undefined;
  }

  #manager(name: InstallRecipe['manager']): Promise<string | undefined> {
    if (this.deps.manager) return this.deps.manager(name);
    return name === 'npm' ? ownNpm() : findExecutable(name);
  }

  /**
   * Start installing (or join the install already running). Resolves when it
   * has started; progress and the outcome show up in `readiness`.
   */
  async install(spec: NeedSpec): Promise<void> {
    const recipe = await this.#recipe(spec);
    if (!recipe) throw new Error(`Conch can’t install ${spec.short} on this computer.`);
    await this.#start(spec, recipe, 'install');
  }

  /**
   * Bring an installed copy up to date, the way it was installed (winget,
   * Homebrew or npm). Like `install`, it resolves once started.
   */
  async update(spec: NeedSpec): Promise<void> {
    const path = await this.path(spec);
    const recipes = path && spec.update ? spec.update(path, this.platform) : [];
    const recipe = (await this.#first(recipes)) ?? (await this.#recipe(spec));
    if (!recipe) throw new Error(`Conch can’t update ${spec.short} on this computer.`);
    await this.#start(spec, recipe, 'update');
  }

  async #start(spec: NeedSpec, recipe: InstallRecipe, kind: Job['kind']): Promise<void> {
    const manager = await this.#manager(recipe.manager);
    if (!manager) throw new Error(`Conch can’t ${kind} ${spec.short} on this computer.`);
    // Checked after the awaits, so two presses can't both start one.
    if (this.#jobs.has(spec.id)) return;
    this.#failed.delete(spec.id);
    const job: Job = {
      kind,
      progress: {
        label: kind === 'update' ? `Updating ${spec.short}…` : `Getting ${spec.short} ready…`,
      },
      done: Promise.resolve(),
    };
    job.done = this.#run(spec, launchOf(manager), recipe.args, job)
      .then(async () => {
        if (!(await this.path(spec)))
          this.#failed.set(
            spec.id,
            `${spec.short} was installed, but Conch can’t find it yet. Open it once, then try again.`,
          );
      })
      .catch((error: Error) => void this.#failed.set(spec.id, error.message))
      .finally(() => this.#jobs.delete(spec.id));
    this.#jobs.set(spec.id, job);
  }

  /** Wait for a running install (tests, and callers that want to carry on after). */
  async settled(id: string): Promise<void> {
    await this.#jobs.get(id)?.done;
  }

  #run(spec: NeedSpec, manager: Launch, args: string[], job: Job): Promise<void> {
    const spawn = this.deps.spawn ?? nodeSpawn;
    const verb = job.kind === 'update' ? 'Updating' : 'Installing';
    return new Promise<void>((resolve, reject) => {
      const child = spawn(manager.command, [...manager.prefix, ...args], {
        env: agentEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let tail = '';
      const read = (chunk: Buffer) => {
        const text = String(chunk);
        tail = (tail + text).slice(-4_000);
        for (const line of text.split(/[\r\n]+/)) {
          if (
            /install(ing)?\b|starting package install|==> Installing|Moving App|added \d+ package/i.test(
              line,
            )
          )
            job.progress = { label: `${verb} ${spec.short}…` };
          const percent = readProgress(line);
          if (percent !== undefined)
            job.progress = { percent, label: `Downloading ${spec.short} · ${percent}%` };
        }
      };
      child.stdout?.on('data', read);
      child.stderr?.on('data', read);
      const timer = setTimeout(() => child.kill(), this.deps.timeoutMs ?? INSTALL_TIMEOUT_MS);
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new Error(explainInstall(error.message, spec.short)));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        // winget says so when it's there already; that's a success too.
        if (code === 0 || /already installed|no available upgrade|0x8a15002b/i.test(tail))
          return resolve();
        reject(new Error(explainInstall(tail, spec.short)));
      });
    });
  }

  /** Open an app, so you can change a setting in it. */
  async open(spec: NeedSpec): Promise<void> {
    const app = spec.opens ? this.specs.get(spec.opens) : undefined;
    const path = app && (await this.path(app));
    if (!app || !path) throw new Error(`Conch can’t open ${spec.short} on this computer.`);
    const [command, args] = this.platform === 'darwin' ? ['open', ['-a', path]] : [path, []];
    const spawn = this.deps.spawn ?? nodeSpawn;
    const child = spawn(command, args as string[], {
      env: agentEnv(),
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => undefined);
    child.unref();
  }
}
