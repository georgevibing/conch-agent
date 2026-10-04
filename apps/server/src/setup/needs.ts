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
import { homedir, platform as osPlatform } from 'node:os';
import { dirname, join } from 'node:path';

import type { Need, Readiness } from '@conch/protocol';

import { agentEnv, findExecutable, launch, type Launch } from '../lib/proc';
import { fetchedBin, fetchRelease, type FetchOptions } from './release';

export type Platform = 'win32' | 'darwin' | 'linux';

/**
 * An install through the computer's own package manager, run as you. An
 * update can also be `self`: the program brings itself up to date
 * (`claude update`), run from where it was found.
 *
 * - `uv` installs a Python program as a tool of its own (`uv tool install
 *   piper-tts`), with the Python it needs, for this user only.
 * - `github` is Conch fetching a project's own release itself (`release.ts`):
 *   `args` are the repository, the file and the program inside it.
 *
 * `via` names the need that brings the package manager (`uv`): when it isn't
 * here yet, installing this gets that first, in the same press.
 */
export interface InstallRecipe {
  manager: 'winget' | 'brew' | 'npm' | 'self' | 'uv' | 'github';
  args: string[];
  via?: string;
}

/** Where the newest version of a program is asked for (see `updates/latest.ts`). */
export interface LatestLookup {
  npm(pkg: string): Promise<string | undefined>;
  winget(id: string): Promise<string | undefined>;
  brew(name: string, cask?: boolean): Promise<string | undefined>;
  /** The newest release on PyPI (what `uv tool upgrade` would bring). */
  pypi(pkg: string): Promise<string | undefined>;
  /** The newest finished release of a GitHub repository that has `asset`. */
  github(repo: string, asset: string): Promise<string | undefined>;
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
  /**
   * The version of the copy at `path` (usually its `--version`). A need that
   * can't say is left out of Updates.
   */
  version?: (path: string) => Promise<string | undefined>;
  /**
   * The newest version, asked of where the copy at `path` came from — the
   * same judgement as `update` (winget, Homebrew, else npm).
   */
  latest?: (path: string, platform: Platform, lookup: LatestLookup) => Promise<string | undefined>;
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
  manager?: (
    name: Exclude<InstallRecipe['manager'], 'self' | 'github'>,
  ) => Promise<string | undefined>;
  /** Fetches a release from GitHub (`release.ts`); tests stand in for it. */
  github?: (options: FetchOptions) => Promise<unknown>;
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
        command: await this.#command(recipe),
      },
      download,
      openable,
    };
  }

  /** The install recipe to offer here: the first whose package manager is on this computer. */
  #recipe(spec: NeedSpec): Promise<InstallRecipe | undefined> {
    return this.#first(list(spec.install?.[this.platform]));
  }

  /**
   * The first recipe Conch can carry out here: its package manager is here,
   * or the need that brings it (`via`) can be installed first.
   */
  async #first(recipes: InstallRecipe[], path?: string): Promise<InstallRecipe | undefined> {
    for (const recipe of recipes) {
      if (await this.#manager(recipe.manager, path)) return recipe;
      if (await this.#viaRecipe(recipe)) return recipe;
    }
    return undefined;
  }

  /** How to get the package manager a recipe runs with, when it isn't here yet. */
  async #viaRecipe(
    recipe: InstallRecipe,
  ): Promise<{ spec: NeedSpec; recipe: InstallRecipe } | undefined> {
    const via = recipe.via ? this.specs.get(recipe.via) : undefined;
    if (!via) return undefined;
    // One step deep: the manager's own install must use a manager that's here.
    for (const first of list(via.install?.[this.platform]))
      if (await this.#manager(first.manager)) return { spec: via, recipe: first };
    return undefined;
  }

  /** What the person is shown before pressing Install. */
  async #command(recipe: InstallRecipe): Promise<string> {
    const words = (r: InstallRecipe) =>
      r.manager === 'github'
        ? `download ${r.args[1] ?? ''} from github.com/${r.args[0] ?? ''}`
        : [r.manager, ...r.args].join(' ');
    if (await this.#manager(recipe.manager)) return words(recipe);
    const via = await this.#viaRecipe(recipe);
    return via ? `${words(via.recipe)} && ${words(recipe)}` : words(recipe);
  }

  /** The package manager to run; `self` is the program itself, at `path`. */
  #manager(name: InstallRecipe['manager'], path?: string): Promise<string | undefined> {
    if (name === 'self') return Promise.resolve(path);
    // Conch itself does the fetching: always here.
    if (name === 'github') return Promise.resolve('github');
    if (this.deps.manager) return this.deps.manager(name);
    if (name === 'uv')
      return findExecutable('uv', {
        extraDirs: [
          join(homedir(), '.local', 'bin'),
          join(homedir(), '.cargo', 'bin'),
          ...fetchedBin('uv'),
        ],
      });
    return name === 'npm' ? ownNpm() : findExecutable(name);
  }

  /** How the copy here would be brought up to date, if Conch can do it on this computer. */
  async #updateRecipe(
    spec: NeedSpec,
  ): Promise<{ recipe: InstallRecipe; path?: string } | undefined> {
    const path = await this.path(spec);
    const recipes = path && spec.update ? spec.update(path, this.platform) : [];
    const recipe = (await this.#first(recipes, path)) ?? (await this.#recipe(spec));
    return recipe && { recipe, path };
  }

  /** Conch can update it here (Updates offers the button, or a link instead). */
  async canUpdate(spec: NeedSpec): Promise<boolean> {
    return Boolean(await this.#updateRecipe(spec));
  }

  /** An install or update of this need is running now. */
  busy(id: string): boolean {
    return this.#jobs.has(id);
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
    const found = await this.#updateRecipe(spec);
    if (!found) throw new Error(`Conch can’t update ${spec.short} on this computer.`);
    await this.#start(spec, found.recipe, 'update', found.path);
  }

  async #start(
    spec: NeedSpec,
    recipe: InstallRecipe,
    kind: Job['kind'],
    path?: string,
  ): Promise<void> {
    const manager = await this.#manager(recipe.manager, path);
    // The package manager itself comes first, when it isn't here yet (`via`).
    const via = manager ? undefined : await this.#viaRecipe(recipe);
    if (!manager && !via) throw new Error(`Conch can’t ${kind} ${spec.short} on this computer.`);
    // Checked after the awaits, so two presses can't both start one.
    if (this.#jobs.has(spec.id)) return;
    this.#failed.delete(spec.id);
    const job: Job = {
      kind,
      progress: {
        label: via
          ? `Getting ${via.spec.short} first…`
          : kind === 'update'
            ? `Updating ${spec.short}…`
            : `Getting ${spec.short} ready…`,
      },
      done: Promise.resolve(),
    };
    const steps = async () => {
      let program = manager;
      if (via) {
        const viaManager = await this.#manager(via.recipe.manager);
        if (!viaManager) throw new Error(`Conch can’t install ${via.spec.short} on this computer.`);
        await this.#step(via.spec, via.recipe, viaManager, job);
        program = await this.#manager(recipe.manager, path);
        if (!program)
          throw new Error(
            `${via.spec.short} was installed, but Conch can’t find it yet. Try again in a moment.`,
          );
        job.progress = { label: `Getting ${spec.short} ready…` };
      }
      await this.#step(spec, recipe, program ?? '', job);
    };
    job.done = steps()
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

  /** One install: Conch's own fetch for `github`, else the package manager as a program. */
  #step(spec: NeedSpec, recipe: InstallRecipe, manager: string, job: Job): Promise<void> {
    if (recipe.manager !== 'github') return this.#run(spec, launchOf(manager), recipe.args, job);
    const [repo = '', asset = '', program = ''] = recipe.args;
    const verb = job.kind === 'update' ? 'Updating' : 'Downloading';
    return (this.deps.github ?? fetchRelease)({
      repo,
      asset,
      program,
      need: spec.id,
      progress: (line) => {
        const percent = readProgress(line);
        job.progress =
          percent === undefined
            ? { label: `${verb} ${spec.short}…` }
            : { percent, label: `${verb} ${spec.short} · ${percent}%` };
      },
    }).then(
      () => undefined,
      (error: Error) => {
        throw new Error(
          /reach|ENOTFOUND|fetch failed|network/i.test(error.message)
            ? explainInstall('network', spec.short)
            : error.message,
        );
      },
    );
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
