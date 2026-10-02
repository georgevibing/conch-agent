/**
 * Conch following its releases (ADR 0051).
 *
 * Where updates come from:
 *
 * - **Releases** — signed `vX.Y.Z` tags, in the channel you chose (stable,
 *   beta or alpha). An install made from a release (a detached checkout at a
 *   tag, or a version folder) follows releases; so does a plain copy of
 *   `main` once the first release exists.
 * - **Its branch** — every change, as before (ADR 0019): a copy on another
 *   branch, with commits or edits of its own, installed with `CONCH_BRANCH`
 *   (`git config conch.follow branch`), from before the first release, or
 *   with "every change on main" turned on.
 *
 * Looking fetches upstream's tags quietly into `refs/conch/tags/*` (never
 * over your own tags, and a moved tag is simply read again), picks the
 * newest release in the channel above this version, and checks its
 * signature against the keys this copy pins (`signing.ts`). Only notes from a
 * release that checks out are shown.
 *
 * Updating never touches the folder that's running: the release is checked
 * out into its own folder (a git worktree), installed and built there, a
 * backup is made, and then the pointer moves (`layout.ts`). The restart is
 * the only time Conch is away.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { ReleaseChannel, type ConchUpdateStep, type ReleaseNotes } from '@conch/protocol';

import { findExecutable, type Launch } from '../lib/proc';
import { SERVER_VERSION } from '../version';
import { changelogFor, emptyNotes, parseNotes } from '../release/notes';
import { channelOf, offered, parseRelease, releaseOfTag, type Release } from '../release/semver';
import { SIGNERS_FILE, signerKeys, verifyTag, type Verdict } from '../release/signing';
import {
  BUILD,
  explainFetch,
  findPnpm,
  repositoryOf,
  gitIn,
  INSTALL,
  installProgress,
  stream as defaultStream,
  type Git,
  type Stream,
  type UpdateProgressReport,
} from './conch';
import { readState, runnable, swapIn, versionFolder, versionsDir } from './layout';
import { missingNativeBuildTools, requiresNativeBuild } from './prerequisites';
import { compareVersions } from './version';

const FETCH_TIMEOUT_MS = 60_000;
/** Releases listed at most, newest first, when several wait. */
const SHOWN = 6;
const NS = 'refs/conch/tags/';

/** The version written in a Conch folder: its root `package.json`'s `version`. */
export function versionOf(root: string): string | undefined {
  try {
    const value = (
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown }
    ).version;
    return typeof value === 'string' && parseRelease(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export interface FoundRelease {
  release: Release;
  tag: string;
  /** The tag object, read once: what's checked is what installs. */
  object: string;
}

export interface Offer {
  version: string;
  channel: ReleaseChannel;
  tag: string;
  object: string;
  commit: string;
  notes: ReleaseNotes;
}

export interface ReleaseCheck {
  source: 'releases' | 'branch';
  sourceWhy?: string;
  /** This copy's version. */
  current: string;
  /** Releases waiting, checked and newest first. */
  offers: Offer[];
  /** A newer release whose signature didn't check out. */
  refused?: string;
  /** The fetch didn't work: one quiet sentence. */
  problem?: string;
  fetched: boolean;
  /** Releases exist upstream at all (for "Conch now follows its releases"). */
  anyReleases: boolean;
  /** Who this copy trusts was learnt from the release itself (an install from before the first one). */
  firstTrust?: string;
  /** The channel the installer chose (`CONCH_CHANNEL`, kept as `git config conch.channel`). */
  installedChannel?: ReleaseChannel;
}

export type StagedResult =
  | { kind: 'staged'; version: string; folder: string; notes: ReleaseNotes[] }
  | { kind: 'refused'; reason: string }
  | { kind: 'failed'; message: string };

export interface ReleasesDeps {
  home: string;
  git?: () => Promise<string | undefined>;
  sshKeygen?: () => Promise<string | undefined>;
  pnpm?: () => Promise<Launch | undefined>;
  stream?: Stream;
  nativeBuildTools?: () => Promise<string[]>;
  /** A backup of your things before the swap (ADR 0020); throws when it can't. */
  backup?: () => Promise<void>;
  now?: () => number;
}

/** A release that came in ahead of this copy's channel: going back to stable waits for it. */
function waitingFor(current: string, channel: ReleaseChannel): string | undefined {
  const here = parseRelease(current);
  if (!here?.pre) return undefined;
  const settled = { stable: 0, beta: 1, alpha: 2 } as const;
  if (settled[channelOf(here)] <= settled[channel]) return undefined;
  const next = `${here.major}.${here.minor}.${here.patch}`;
  return channel === 'stable'
    ? `You’re on ${current}. Conch moves to stable releases with the next one after it (${next} or later): it never goes back a version by itself.`
    : `You’re on ${current}. Conch moves to beta releases with the next one after it: it never goes back a version by itself.`;
}

export class ReleaseFollower {
  #git?: Promise<Git | undefined>;

  constructor(
    /** The folder running now. */
    readonly root: string,
    private readonly deps: ReleasesDeps,
  ) {}

  /** Conch's own checkout, where version folders are made from. */
  get repository(): string {
    return repositoryOf(this.root);
  }

  #runner(): Promise<Git | undefined> {
    this.#git ??= (async () => {
      const git = await (this.deps.git ?? (() => findExecutable('git')))();
      if (!git) return undefined;
      const bare = gitIn(this.root, git);
      const own = process.env.GIT_SSH_COMMAND ?? (await bare(['config', 'core.sshCommand'])).stdout;
      return own.trim() ? bare : gitIn(this.root, git, 'ssh -o BatchMode=yes');
    })();
    return this.#git;
  }

  /** This copy's version. */
  version(): string {
    return versionOf(this.root) ?? SERVER_VERSION;
  }

  /** The channel the installer chose (`CONCH_CHANNEL`, kept as `git config conch.channel`). */
  async installedChannel(): Promise<ReleaseChannel | undefined> {
    const git = await this.#runner();
    const said = git ? (await git(['config', 'conch.channel'])).stdout.trim() : '';
    return ReleaseChannel.safeParse(said).data;
  }

  /** Where upstream is: the branch's remote, else `origin`, else the only one. */
  async #remote(git: Git): Promise<string | undefined> {
    const branch = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim();
    if (branch) {
      const remote = (await git(['config', `branch.${branch}.remote`])).stdout.trim();
      if (remote && remote !== '.') return remote;
    }
    const remotes = (await git(['remote'])).stdout
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);
    return remotes.includes('origin') ? 'origin' : remotes[0];
  }

  /**
   * Releases or every change on the branch, and why, in a sentence.
   * `everyChange` is the developer's own choice in Settings.
   */
  async source(
    git: Git,
    { everyChange, anyReleases }: { everyChange: boolean; anyReleases: boolean },
  ): Promise<{ source: 'releases' | 'branch'; why?: string }> {
    if (everyChange)
      return { source: 'branch', why: 'Every change on main is on, for developers.' };
    const follow = (await git(['config', 'conch.follow'])).stdout.trim();
    const branch = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim();
    if (follow === 'branch')
      return {
        source: 'branch',
        why: `This copy was installed to follow the branch “${branch || 'it was on'}”.`,
      };
    if (!branch) return { source: 'releases' };
    if (branch !== 'main')
      return {
        source: 'branch',
        why: `This copy is on the branch “${branch}”, so it follows that branch.`,
      };
    const [ahead, changes] = await Promise.all([
      git(['rev-list', '--count', '@{upstream}..HEAD']),
      git(['status', '--porcelain=v1', '--untracked-files=no']),
    ]);
    if (ahead.code === 0 && Number(ahead.stdout.trim()) > 0)
      return {
        source: 'branch',
        why: 'This copy has commits of its own, so it follows main as a developer’s copy.',
      };
    if (changes.code === 0 && changes.stdout.trim())
      return {
        source: 'branch',
        why: 'This copy has changes of its own, so it follows main as a developer’s copy.',
      };
    if (!anyReleases)
      return { source: 'branch', why: 'Conch has no releases yet, so it follows every change.' };
    return { source: 'releases' };
  }

  /** Every release tag upstream has (as last fetched), read strictly. */
  async #found(git: Git): Promise<FoundRelease[]> {
    const listed = await git([
      'for-each-ref',
      '--format=%(objectname) %(refname)',
      NS,
      // A copy with no remote (a test, a developer) reads its own tags.
      'refs/tags/',
    ]);
    const byTag = new Map<string, FoundRelease>();
    for (const line of listed.stdout.split('\n')) {
      const [object = '', ref = ''] = line.trim().split(' ');
      const tag = ref.startsWith(NS) ? ref.slice(NS.length) : ref.replace(/^refs\/tags\//, '');
      const release = releaseOfTag(tag);
      if (!release || !/^[0-9a-f]{40,64}$/.test(object)) continue;
      // What upstream says wins over a local tag of the same name.
      if (ref.startsWith(NS) || !byTag.has(tag)) byTag.set(tag, { release, tag, object });
    }
    return [...byTag.values()];
  }

  /** The keys this copy trusts, from its own commit. */
  async #trusted(git: Git): Promise<string> {
    const pinned = await git(['show', `HEAD:${SIGNERS_FILE}`]);
    return pinned.code === 0 ? pinned.stdout : '';
  }

  async #sshKeygen(): Promise<string | undefined> {
    return (this.deps.sshKeygen ?? (() => findExecutable('ssh-keygen')))();
  }

  /**
   * Check one release. An install from before the first release pins
   * nobody yet: then (and only then) the release's own list is taken, and
   * that's said once.
   */
  async #verify(git: Git, found: FoundRelease): Promise<{ verdict: Verdict; firstTrust?: string }> {
    const sshKeygen = await this.#sshKeygen();
    let signers = await this.#trusted(git);
    let firstTrust: string | undefined;
    if (!signerKeys(signers).length) {
      const own = await git(['show', `${found.object}^{commit}:${SIGNERS_FILE}`]);
      if (own.code === 0 && signerKeys(own.stdout).length) {
        signers = own.stdout;
        firstTrust = found.release.version;
      }
    }
    const verdict = await verifyTag(git, {
      object: found.object,
      name: found.tag,
      signers,
      sshKeygen,
    });
    return { verdict, ...(firstTrust && verdict.ok && { firstTrust }) };
  }

  async #notes(
    git: Git,
    found: FoundRelease,
    verdict: Verdict & { ok: true },
  ): Promise<ReleaseNotes> {
    let notes = parseNotes(verdict.message);
    if (emptyNotes(notes)) {
      const log = await git(['show', `${verdict.commit}:CHANGELOG.md`]);
      const section = log.code === 0 ? changelogFor(log.stdout, found.release.version) : undefined;
      if (section) notes = parseNotes(section);
    }
    return {
      version: found.release.version,
      channel: channelOf(found.release),
      ...(verdict.date && { date: verdict.date }),
      ...notes,
    };
  }

  /** Look for releases. With `fetch`, ask upstream first. */
  async check({
    fetch,
    channel,
    everyChange,
    failed,
  }: {
    fetch: boolean;
    channel: ReleaseChannel;
    everyChange: boolean;
    failed: string[];
  }): Promise<ReleaseCheck> {
    const current = this.version();
    const none: ReleaseCheck = {
      source: 'branch',
      current,
      offers: [],
      fetched: false,
      anyReleases: false,
    };
    const git = await this.#runner();
    if (!git)
      return { ...none, problem: 'Conch can’t find git, so it can’t check for its own updates.' };
    let problem: string | undefined;
    let fetched = false;
    const remote = await this.#remote(git);
    if (fetch && remote) {
      const result = await git(
        ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', remote, `+refs/tags/v*:${NS}v*`],
        { timeout: FETCH_TIMEOUT_MS },
      );
      if (result.code === 0) fetched = true;
      else problem = explainFetch(result, (await git(['remote', 'get-url', remote])).stdout.trim());
    } else if (fetch) fetched = true;

    const all = await this.#found(git);
    const installedChannel = await this.installedChannel();
    const anyReleases = all.some(({ release }) => !release.pre);
    // A copy of main switches with the first stable release, not with a beta.
    const { source, why } = await this.source(git, { everyChange, anyReleases });
    const base = {
      ...none,
      ...(installedChannel && { installedChannel }),
      source,
      ...(why && { sourceWhy: why }),
      fetched,
      anyReleases,
      ...(problem && { problem }),
    };
    if (source === 'branch') return base;

    const waiting = offered(all, { channel, current, failed });
    const offers: Offer[] = [];
    let refused: string | undefined;
    let firstTrust: string | undefined;
    for (const found of waiting.slice(0, SHOWN)) {
      const { verdict, firstTrust: learnt } = await this.#verify(git, found);
      if (!verdict.ok) {
        // The newest one that didn't check out is worth one sentence; older good ones are still offered.
        if (!offers.length) refused ??= verdict.message;
        continue;
      }
      firstTrust ??= learnt;
      offers.push({
        version: found.release.version,
        channel: channelOf(found.release),
        tag: found.tag,
        object: found.object,
        commit: verdict.commit,
        notes: await this.#notes(git, found, verdict),
      });
    }
    return { ...base, offers, ...(refused && { refused }), ...(firstTrust && { firstTrust }) };
  }

  /** Back to a steadier channel waits for a release newer than this one. */
  waiting(channel: ReleaseChannel): string | undefined {
    return waitingFor(this.version(), channel);
  }

  /**
   * Make `offer` ready beside the running version, then swap it in. Doesn't
   * restart anything: the caller does. The running folder is never touched,
   * so a failure here leaves everything as it was.
   */
  async stage(
    offer: Offer,
    all: Offer[],
    onProgress: (progress: UpdateProgressReport) => void,
  ): Promise<StagedResult> {
    const steps = 4;
    const say = (phase: ConchUpdateStep, label: string, step: number, percent?: number) =>
      onProgress({ phase, label, step, steps, percent });
    say('verify', 'Checking it’s really from Conch', 1);
    const git = await this.#runner();
    if (!git)
      return { kind: 'failed', message: 'Conch can’t find git, so it can’t update itself.' };
    const pnpm = await (this.deps.pnpm ?? findPnpm)();
    if (!pnpm)
      return { kind: 'refused', reason: 'Conch can’t find pnpm, which it needs to update itself.' };

    // The exact tag object that was checked, checked again: nothing can swap it meanwhile.
    const release = parseRelease(offer.version);
    if (!release) return { kind: 'refused', reason: 'That isn’t a release Conch knows.' };
    const { verdict } = await this.#verify(git, { release, tag: offer.tag, object: offer.object });
    if (!verdict.ok) return { kind: 'refused', reason: verdict.message };

    const manifest = await git(['show', `${verdict.commit}:apps/server/package.json`]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifest.stdout);
    } catch {
      return {
        kind: 'refused',
        reason:
          'The update has an unreadable package list. Conch left the version you have untouched.',
      };
    }
    if (requiresNativeBuild(parsed)) {
      const missing = await (this.deps.nativeBuildTools ?? missingNativeBuildTools)();
      if (missing.length)
        return {
          kind: 'refused',
          reason: `This update requires ${missing.join(', ')} for its terminal. Run Conch’s installer from a terminal on this computer to set them up, then update again. Conch left the version you have untouched.`,
        };
    }

    const { home } = this.deps;
    const folder = versionFolder(home, release.version);
    const repo = gitIn(
      this.repository,
      (await (this.deps.git ?? (() => findExecutable('git')))()) ?? 'git',
    );
    const clear = async () => {
      await repo(['worktree', 'remove', '--force', folder]);
      // Only ever inside Conch's own versions folder.
      if (resolve(folder).startsWith(`${resolve(versionsDir(home))}${sep}`))
        await rm(folder, { recursive: true, force: true });
      await repo(['worktree', 'prune']);
    };
    const failed = async (why: string): Promise<StagedResult> => {
      await clear();
      return {
        kind: 'failed',
        message: `The update didn’t install (${why}), so Conch kept the version you have. Nothing of yours changed.`,
      };
    };

    say('fetch', `Getting Conch ${release.version}`, 1);
    // What a failed try left behind goes first.
    if (resolve(folder) === resolve(this.root))
      return { kind: 'refused', reason: 'That version is already running.' };
    await clear();
    const added = await repo(['worktree', 'add', '--detach', '--quiet', folder, verdict.commit]);
    if (added.code !== 0) return failed('its files couldn’t be put in place');

    say('install', 'Installing', 2, 0);
    const run = this.deps.stream ?? defaultStream;
    const installed = await run(pnpm, INSTALL, {
      cwd: folder,
      onLine: (line) => {
        const percent = installProgress(line);
        if (percent !== undefined) say('install', 'Installing', 2, percent);
      },
    });
    if (installed.code !== 0)
      return failed(
        /ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|network|fetch failed/i.test(installed.tail)
          ? 'a part couldn’t be downloaded'
          : 'installing its parts didn’t work',
      );

    say('build', 'Getting the new look ready', 3);
    const built = await run(pnpm, BUILD, { cwd: folder });
    if (built.code !== 0) return failed('the new version wouldn’t build');
    if (!runnable(folder) || versionOf(folder) !== release.version)
      return failed('it isn’t the version it says it is');

    say('backup', 'Backing up your things', 4);
    try {
      await this.deps.backup?.();
    } catch (error) {
      await clear();
      return {
        kind: 'refused',
        reason: `Conch couldn’t make a backup first (${(error as Error).message.replace(/\.$/, '')}), so it left the version you have.`,
      };
    }

    swapIn(
      home,
      { folder, version: release.version },
      { folder: this.root, version: this.version() },
      (this.deps.now ?? Date.now)(),
    );
    return {
      kind: 'staged',
      version: release.version,
      folder,
      notes: all
        .filter((o) => compareVersions(o.version, release.version) <= 0)
        .map((o) => o.notes),
    };
  }

  /**
   * Version folders nobody needs: not running, not the one to go back to,
   * not the supervisor's, not Conch's checkout. Quiet; never fails.
   */
  async prune(keep: (string | undefined)[]): Promise<string[]> {
    const { home } = this.deps;
    const state = readState(home);
    // Git lists folders by their real path (macOS's /private/var for /var).
    const real = (path: string) => {
      try {
        return realpathSync(path);
      } catch {
        return resolve(path);
      }
    };
    const kept = new Set(
      [
        this.root,
        this.repository,
        state.current?.folder,
        state.previous?.folder,
        state.pending?.folder,
        ...keep,
      ]
        .filter((f): f is string => Boolean(f))
        .map(real),
    );
    const git = await (this.deps.git ?? (() => findExecutable('git')))();
    if (!git) return [];
    const repo = gitIn(this.repository, git);
    const listed = await repo(['worktree', 'list', '--porcelain']);
    const removed: string[] = [];
    const dir = `${real(versionsDir(home))}${sep}`;
    for (const line of listed.stdout.split('\n')) {
      const folder = /^worktree (.+)$/.exec(line.trim())?.[1];
      if (!folder || !real(folder).startsWith(dir) || kept.has(real(folder))) continue;
      const out = await repo(['worktree', 'remove', '--force', folder]);
      if (out.code !== 0 && existsSync(folder)) await rm(folder, { recursive: true, force: true });
      removed.push(folder);
    }
    await repo(['worktree', 'prune']);
    return removed;
  }
}
