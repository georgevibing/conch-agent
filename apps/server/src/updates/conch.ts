/**
 * Conch, keeping itself up to date (ADR 0019).
 *
 * Conch runs from a git checkout (`pnpm start`). Checking fetches the branch's
 * upstream — quietly: never a credential prompt, and a network or sign-in
 * failure is just "couldn't check". Updating moves the checkout forward only
 * (fast-forward, to exactly the commit that was checked), installs, rebuilds
 * the web app, and hands back so the gateway can start itself again. It
 * refuses, with the command to run by hand, whenever that could lose
 * anything: local changes, no upstream, a merge. When a step fails, it goes
 * back to the commit it started from, after checking again that nothing
 * local would be lost.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import type { ConchUpdateStep } from '@conch/protocol';

import { agentEnv, findExecutable, launch, run, type Launch, type RunResult } from '../lib/proc';
import { whatsNew } from './whatsnew';

/** How long one git or pnpm step may take. */
const FETCH_TIMEOUT_MS = 60_000;
const GIT_TIMEOUT_MS = 20_000;
const STEP_TIMEOUT_MS = 10 * 60_000;
/** Subjects read for "What's new" (the count stays right beyond it). */
const SUBJECTS = 400;

/**
 * The folder Conch runs from: the nearest one above the gateway's own code
 * with a pnpm workspace and git. `CONCH_CHECKOUT` points elsewhere, for
 * development and tests only.
 */
export function findCheckout(
  from: string = import.meta.dirname,
  override?: string,
): string | undefined {
  if (override?.trim()) return resolve(override.trim());
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml')) && existsSync(join(dir, '.git'))) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/**
 * pnpm as `pnpm start` ran it (`npm_execpath`), else from PATH, else through
 * the corepack that comes with Node (the installer's way: ADR 0026), which
 * runs the pnpm `packageManager` pins.
 */
export async function findPnpm(
  env: NodeJS.ProcessEnv = process.env,
  node: string = process.execPath,
): Promise<Launch | undefined> {
  const exec = env.npm_execpath;
  if (exec && /pnpm/i.test(basename(exec)) && existsSync(exec))
    return /\.[cm]?js$/i.test(exec) ? { command: node, prefix: [exec] } : launch(exec);
  const found = await findExecutable('pnpm');
  if (found) return launch(found);
  const corepack = join(dirname(node), process.platform === 'win32' ? 'corepack.cmd' : 'corepack');
  if (existsSync(corepack)) {
    const runner = launch(corepack);
    return { ...runner, prefix: [...runner.prefix, 'pnpm'] };
  }
  return undefined;
}

export type Git = (args: string[], options?: { timeout?: number }) => Promise<RunResult>;

/**
 * Git in `root`, never asking anything: no terminal prompt, no credential
 * window, no SSH password, messages in English so they can be read.
 */
export function gitIn(root: string, git: string, sshCommand?: string): Git {
  const env = agentEnv({
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    LC_ALL: 'C',
    LANG: 'C',
    ...(sshCommand && { GIT_SSH_COMMAND: sshCommand }),
  });
  return (args, options) =>
    run(git, ['-C', root, '-c', 'credential.interactive=false', '-c', 'core.askPass=', ...args], {
      env,
      cwd: root,
      timeout: options?.timeout ?? GIT_TIMEOUT_MS,
    });
}

/** A program's output, a line at a time, with a time limit (pnpm install, the web build). */
export type Stream = (
  program: Launch,
  args: string[],
  options: { cwd: string; onLine?: (line: string) => void; timeout?: number },
) => Promise<{ code?: number; tail: string }>;

export const stream: Stream = (program, args, { cwd, onLine, timeout = STEP_TIMEOUT_MS }) =>
  new Promise((resolvePromise) => {
    // Installing for production would leave out the tools the build needs.
    const env = agentEnv();
    delete env.NODE_ENV;
    // corepack (the installer's pnpm) never stops to ask before fetching the pinned pnpm.
    env.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0';
    const child = nodeSpawn(program.command, [...program.prefix, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let tail = '';
    const read = (chunk: Buffer) => {
      const text = String(chunk);
      tail = (tail + text).slice(-6_000);
      for (const line of text.split(/[\r\n]+/)) if (line.trim()) onLine?.(line);
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    const timer = setTimeout(() => child.kill(), timeout);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolvePromise({ tail: `${tail}\n${error.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? undefined, tail });
    });
  });

/** pnpm's `Progress: resolved 838, reused 830, downloaded 8, added 412`, as a percentage. */
export function installProgress(line: string): number | undefined {
  const match = /resolved (\d+).*?added (\d+)/i.exec(line);
  if (!match) return undefined;
  const resolved = Number(match[1]);
  const added = Number(match[2]);
  return resolved > 0 ? Math.min(100, Math.round((added / resolved) * 100)) : undefined;
}

export interface ConchCheck {
  head?: string;
  branch?: string;
  behind: number;
  ahead: number;
  improvements: number;
  whatsNew: string[];
  /** One press can't update it: why, and what to run instead. */
  blocked?: { reason: string; command?: string };
  /** The fetch didn't work; the counts are from the last one that did. */
  problem?: string;
  /** The upstream was reached just now. */
  fetched: boolean;
  /**
   * The upstream commit this check read, once: the counts and "What's new"
   * are about exactly it, and an update moves to exactly it.
   */
  target?: string;
}

export interface UpdateProgressReport {
  phase: ConchUpdateStep;
  label: string;
  step: number;
  steps: number;
  percent?: number;
}

export type ConchResult =
  | { kind: 'current' }
  | { kind: 'refused'; reason: string; command?: string }
  | {
      kind: 'updated';
      from: string;
      to: string;
      improvements: number;
      whatsNew: string[];
    }
  | { kind: 'rolled-back'; message: string }
  | { kind: 'failed'; message: string; command?: string };

export interface CheckoutDeps {
  /** Finds git; tests may point at a particular one. */
  git?: () => Promise<string | undefined>;
  pnpm?: () => Promise<Launch | undefined>;
  stream?: Stream;
}

/** What the upstream's host is called, for "GitHub asked for a sign-in". */
function hostName(url: string): string {
  const host =
    /^[\w+.-]+:\/\/(?:[^@/]+@)?([^/:]+)/.exec(url)?.[1] ?? /^[^@]+@([^:]+):/.exec(url)?.[1];
  if (!host) return 'where Conch comes from';
  return host.toLowerCase() === 'github.com' ? 'GitHub' : host;
}

/** A fetch that didn't work, as one quiet sentence. */
export function explainFetch(result: RunResult, remoteUrl = ''): string {
  const out = `${result.stderr}\n${result.stdout}`;
  if (result.code === undefined && !/not found|ENOENT/i.test(out))
    return 'Checking for updates took too long, so Conch will try again later.';
  if (
    /authentication failed|could not read (username|password)|terminal prompts disabled|permission denied \(publickey|host key verification failed|returned error: 40[13]|access denied/i.test(
      out,
    )
  )
    return `Conch couldn’t check for updates: ${hostName(remoteUrl)} asked for a sign-in.`;
  if (
    /could not resolve host|unable to access|failed to connect|network is unreachable|connection (refused|reset|timed out)|timed out|could not read from remote/i.test(
      out,
    )
  )
    return 'Conch couldn’t reach the internet to check for updates.';
  return 'Conch couldn’t check for updates just now.';
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The files git won't write over, from a merge it refused ("The following
 * untracked working tree files would be overwritten by merge:", one per
 * line, indented). Empty when that isn't why.
 */
export function overwritten(output: string): string[] {
  const at = output.search(/would be overwritten by (merge|checkout)/i);
  if (at === -1) return [];
  const files: string[] = [];
  for (const line of output.slice(at).split(/\r?\n/).slice(1)) {
    if (!/^\s+\S/.test(line)) break;
    files.push(line.trim());
  }
  return files;
}

/** Conch's own folder: checking it for updates, and moving it forward. */
export class ConchCheckout {
  #git?: Promise<Git | undefined>;

  constructor(
    readonly root: string,
    private readonly deps: CheckoutDeps = {},
  ) {}

  /** Lines to run by hand, starting in Conch's folder. */
  byHand(...lines: string[]): string {
    return [`cd "${this.root}"`, ...lines].join('\n');
  }

  #gitRunner(): Promise<Git | undefined> {
    this.#git ??= (async () => {
      const git = await (this.deps.git ?? (() => findExecutable('git')))();
      if (!git) return undefined;
      const bare = gitIn(this.root, git);
      // SSH asks no questions either, unless you chose your own SSH command.
      const own = process.env.GIT_SSH_COMMAND ?? (await bare(['config', 'core.sshCommand'])).stdout;
      return own.trim() ? bare : gitIn(this.root, git, 'ssh -o BatchMode=yes');
    })();
    return this.#git;
  }

  /** The commit Conch's folder is on now. */
  async head(): Promise<string | undefined> {
    const git = await this.#gitRunner();
    if (!git) return undefined;
    const result = await git(['rev-parse', 'HEAD']);
    return result.code === 0 ? result.stdout.trim() : undefined;
  }

  async #state(git: Git) {
    const [head, branch, changes] = await Promise.all([
      git(['rev-parse', 'HEAD']),
      git(['symbolic-ref', '--quiet', '--short', 'HEAD']),
      git(['status', '--porcelain=v1', '--untracked-files=no']),
    ]);
    const name = branch.code === 0 ? branch.stdout.trim() : undefined;
    let upstream: { remote: string; ref: string } | undefined;
    if (name) {
      const [ref, remote] = await Promise.all([
        git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
        git(['config', `branch.${name}.remote`]),
      ]);
      if (ref.code === 0 && ref.stdout.trim())
        upstream = { ref: ref.stdout.trim(), remote: remote.stdout.trim() || '.' };
    }
    return {
      head: head.code === 0 ? head.stdout.trim() : undefined,
      branch: name,
      upstream,
      changed:
        changes.code === 0 ? changes.stdout.split('\n').filter((l) => l.trim()).length : undefined,
    };
  }

  /**
   * Where Conch's folder stands against its upstream. With `fetch`, it asks
   * the upstream first; otherwise it reads what the last fetch brought.
   */
  async check({ fetch }: { fetch: boolean }): Promise<ConchCheck> {
    const none: ConchCheck = { behind: 0, ahead: 0, improvements: 0, whatsNew: [], fetched: false };
    const git = await this.#gitRunner();
    if (!git)
      return { ...none, problem: 'Conch can’t find git, so it can’t check for its own updates.' };
    const state = await this.#state(git);
    if (!state.head)
      return { ...none, problem: 'Conch’s folder isn’t a git checkout it can read.' };
    const base = { ...none, head: state.head, branch: state.branch };
    if (!state.branch)
      return {
        ...base,
        blocked: {
          reason: 'Conch’s folder isn’t on a branch, so it doesn’t know where updates come from.',
          command: this.byHand('git switch main', 'git pull --ff-only'),
        },
      };
    if (!state.upstream)
      return {
        ...base,
        blocked: {
          reason: `The branch “${state.branch}” doesn’t follow one anywhere else, so there’s nowhere to get updates from.`,
          command: this.byHand(`git branch --set-upstream-to=origin/${state.branch}`),
        },
      };

    let problem: string | undefined;
    let fetched = false;
    if (fetch && state.upstream.remote !== '.') {
      const result = await git(['fetch', '--quiet', '--no-tags', state.upstream.remote], {
        timeout: FETCH_TIMEOUT_MS,
      });
      if (result.code === 0) fetched = true;
      else {
        const url = await git(['remote', 'get-url', state.upstream.remote]);
        problem = explainFetch(result, url.stdout.trim());
      }
    } else if (fetch) fetched = true;

    // The upstream as one commit, read once: a fetch landing meanwhile (the
    // daily check, a terminal) can't make the counts, "What's new" and the
    // update disagree about what arrives.
    const resolved = await git(['rev-parse', '--verify', '--quiet', '@{upstream}^{commit}']);
    const target = resolved.stdout.trim();
    if (resolved.code !== 0 || !/^[0-9a-f]{40,64}$/.test(target))
      return {
        ...base,
        fetched,
        problem: problem ?? 'Conch couldn’t read the newest version it got.',
      };
    const head = state.head;
    const counts = await git(['rev-list', '--left-right', '--count', `${head}...${target}`]);
    const [ahead = 0, behind = 0] = counts.stdout.trim().split(/\s+/).map(Number);
    const subjects =
      behind > 0
        ? (
            await git(['log', '--no-merges', '--format=%s', `-n${SUBJECTS}`, `${head}..${target}`])
          ).stdout
            .split('\n')
            .filter(Boolean)
        : [];
    const lines = whatsNew(subjects);
    const check: ConchCheck = {
      ...base,
      ahead,
      behind,
      improvements: lines.length,
      whatsNew: lines.slice(0, 8),
      fetched,
      target,
      ...(problem && { problem }),
    };
    if (behind > 0 && ahead > 0)
      check.blocked = {
        reason: `Conch’s folder has ${plural(ahead, 'commit')} of its own that aren’t upstream, so it can’t simply move forward.`,
        command: this.byHand('git pull --rebase', 'pnpm install'),
      };
    else if (behind > 0 && state.changed !== 0)
      check.blocked = {
        reason:
          state.changed === undefined
            ? 'Conch couldn’t tell whether its folder has changes of yours, so it won’t update by itself.'
            : `Conch’s folder has changes that aren’t saved in git (${plural(state.changed, 'file')}), so updating by itself could lose them.`,
        command: this.byHand('git stash', 'git pull --ff-only', 'git stash pop', 'pnpm install'),
      };
    return check;
  }

  /**
   * Update Conch's folder: fetch, fast-forward to the upstream commit it
   * found, install, and rebuild the web app. Any failure goes back to where
   * it started. Doesn't restart anything: the caller does.
   */
  async update(onProgress: (progress: UpdateProgressReport) => void): Promise<ConchResult> {
    const steps = 3;
    const say = (phase: ConchUpdateStep, label: string, step: number, percent?: number) =>
      onProgress({ phase, label, step, steps, percent });
    say('fetch', 'Getting the update', 1);

    const git = await this.#gitRunner();
    const pnpm = await (this.deps.pnpm ?? findPnpm)();
    if (!git)
      return { kind: 'failed', message: 'Conch can’t find git, so it can’t update itself.' };
    if (!pnpm)
      return {
        kind: 'refused',
        reason: 'Conch can’t find pnpm, which it needs to update itself.',
        command: this.byHand('git pull --ff-only', 'pnpm install'),
      };
    const check = await this.check({ fetch: true });
    if (check.problem) return { kind: 'failed', message: check.problem };
    if (check.blocked) return { kind: 'refused', ...check.blocked };
    if (check.behind === 0 || !check.head) return { kind: 'current' };
    const from = check.head;
    // Exactly the commit that was checked: what "What's new" listed is what arrives.
    const to = check.target;
    if (!to) return { kind: 'failed', message: 'Conch couldn’t read the update it just got.' };

    // `--no-overwrite-ignore`: a file git ignores (a `.env`, your own notes)
    // that the new version adds is never replaced; the update stops instead.
    const moved = await git(['merge', '--ff-only', '--no-overwrite-ignore', '--quiet', to]);
    if (moved.code !== 0) {
      const inTheWay = overwritten(`${moved.stderr}\n${moved.stdout}`);
      if (inTheWay.length) {
        const one = inTheWay.length === 1;
        const names = `${inTheWay.slice(0, 3).join(', ')}${inTheWay.length > 3 ? ', …' : ''}`;
        return {
          kind: 'refused',
          reason: `The update would replace ${one ? 'a file' : `${inTheWay.length} files`} of yours in Conch’s folder (${names}), so Conch left everything as it is. Move ${one ? 'it' : 'them'} somewhere else, then update.`,
          command: this.byHand('git pull --ff-only', 'pnpm install'),
        };
      }
      return this.#rollback(git, pnpm, from, { install: false, build: false }, onProgress, {
        why: 'the new version couldn’t be put in Conch’s folder',
      });
    }

    say('install', 'Installing', 2, 0);
    const run = this.deps.stream ?? stream;
    const installed = await run(pnpm, INSTALL, {
      cwd: this.root,
      onLine: (line) => {
        const percent = installProgress(line);
        if (percent !== undefined) say('install', 'Installing', 2, percent);
      },
    });
    if (installed.code !== 0)
      return this.#rollback(git, pnpm, from, { install: true, build: false }, onProgress, {
        why: /ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|network|fetch failed/i.test(installed.tail)
          ? 'a part couldn’t be downloaded'
          : 'installing its parts didn’t work',
      });

    say('build', 'Getting the new look ready', 3);
    const built = await run(pnpm, BUILD, { cwd: this.root });
    if (built.code !== 0)
      return this.#rollback(git, pnpm, from, { install: true, build: true }, onProgress, {
        why: 'the new version wouldn’t build',
      });

    return {
      kind: 'updated',
      from,
      to,
      improvements: check.improvements,
      whatsNew: check.whatsNew,
    };
  }

  /**
   * Back to `head` after a step failed. `git reset` is only safe because the
   * update refused to start with local changes; that's checked again here,
   * and `--keep` refuses by itself rather than lose anything.
   */
  async #rollback(
    git: Git,
    pnpm: Launch,
    head: string,
    did: { install: boolean; build: boolean },
    onProgress: (progress: UpdateProgressReport) => void,
    { why }: { why: string },
  ): Promise<ConchResult> {
    onProgress({
      phase: 'rollback',
      label: 'Going back to the version you had',
      step: 3,
      steps: 3,
    });
    const stuck = (detail: string): ConchResult => ({
      kind: 'failed',
      message: `The update didn’t install (${why}), and ${detail}`,
      command: this.byHand(`git reset --keep ${head.slice(0, 12)}`, 'pnpm install'),
    });
    const state = await this.#state(git);
    if (state.changed !== 0)
      return stuck('Conch’s folder changed meanwhile, so Conch left it as it is.');
    if (state.head !== head) {
      const ours = await git(['merge-base', '--is-ancestor', head, 'HEAD']);
      if (ours.code !== 0) return stuck('Conch’s folder moved somewhere unexpected.');
      const reset = await git(['reset', '--keep', '--quiet', head]);
      if (reset.code !== 0) return stuck('Conch couldn’t go back by itself.');
    }
    const run = this.deps.stream ?? stream;
    if (did.install && (await run(pnpm, INSTALL, { cwd: this.root })).code !== 0)
      return stuck('putting the old parts back didn’t work.');
    if (did.build && (await run(pnpm, BUILD, { cwd: this.root })).code !== 0)
      return stuck('rebuilding the version you had didn’t work.');
    return {
      kind: 'rolled-back',
      message: `The update didn’t install (${why}), so Conch went back to the version you had.`,
    };
  }
}

/** Fixed arguments, never from input. `confirmModulesPurge` would otherwise ask a question. */
const INSTALL = ['install', '--frozen-lockfile', '--config.confirmModulesPurge=false'];
const BUILD = ['--filter', '@conch/web', 'build'];
