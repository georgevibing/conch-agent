/**
 * What a release is about (ADR 0127): the releases tagged so far, and the
 * commits since the last one its channel saw. A stable release tells what's
 * new since the last stable release; a pre-release, since the last release
 * on its channel (a beta counts every beta and stable release before it).
 *
 * release-please works out the version; this works out the notes Conch
 * writes for it, the same way wherever they're written: the release pull
 * request, the tag, and the GitHub Release.
 */
import { compareVersions } from '../updates/version';
import type { Git } from '../updates/conch';
import { notesFrom, type Notes } from './notes';
import { polish, type PolishDeps } from './polish';
import {
  channelOf,
  inChannel,
  parseRelease,
  releaseOfTag,
  tagOf,
  type Commit,
  type Release,
} from './semver';

/** One line, to stop on: what's wrong and what to do. */
export class Stop extends Error {}

export async function must(git: Git, args: string[], what: string): Promise<string> {
  const result = await git(args, { timeout: 120_000 });
  if (result.code !== 0)
    throw new Stop(
      `${what} didn’t work: ${(result.stderr || result.stdout).trim().split('\n')[0] ?? ''}`,
    );
  return result.stdout;
}

/** The commits in a range, newest first, merges left out (their commits are in it). */
export async function commitsIn(git: Git, range: string): Promise<Commit[]> {
  const out = await must(
    git,
    ['log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', range],
    'Reading the commits',
  );
  return out
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha = '', subject = '', body = ''] = record.split('\x1f');
      return { sha, subject, body };
    });
}

/** Every release tagged here (`v0.3.0`, `v0.4.0-beta.1`), newest first. */
export async function taggedReleases(git: Git): Promise<Release[]> {
  const out = await must(git, ['tag', '-l', 'v*'], 'Reading the tags');
  return out
    .split('\n')
    .flatMap((tag) => releaseOfTag(tag.trim()) ?? [])
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** The release `version`'s notes start after: the newest older one its channel saw. */
export function previousFor(version: Release, releases: Release[]): Release | undefined {
  const channel = channelOf(version);
  return releases.find(
    (r) => inChannel(r, channel) && compareVersions(r.version, version.version) < 0,
  );
}

export interface ReleaseNotes {
  version: string;
  notes: Notes;
  /** Who polished them, when a model did. */
  polishedBy?: string;
  /** Why they're as written from the commits, when a model was asked and didn't. */
  plainWhy?: string;
  commits: Commit[];
  /** The release they're since; none for the first. */
  since?: Release;
}

/**
 * The notes for `version`, from the commits up to `head` since the release
 * before it. With `ai`, a model polishes them (`polish.ts`); the notes as
 * written from the commits stand whenever it can't.
 */
export async function notesFor(
  git: Git,
  version: string,
  {
    head = 'HEAD',
    ai = false,
    polishDeps,
  }: { head?: string; ai?: boolean; polishDeps?: PolishDeps } = {},
): Promise<ReleaseNotes> {
  const release = parseRelease(version);
  if (!release)
    throw new Stop(`${version} isn’t a version Conch releases (like 0.4.0 or 0.4.0-beta.1).`);
  return notesSince(git, version, previousFor(release, await taggedReleases(git)), {
    head,
    ai,
    polishDeps,
  });
}

/** The notes for the commits up to `head` since the release `since` (all of them without one). */
export async function notesSince(
  git: Git,
  version: string,
  since: Release | undefined,
  {
    head = 'HEAD',
    ai = false,
    polishDeps,
  }: { head?: string; ai?: boolean; polishDeps?: PolishDeps } = {},
): Promise<ReleaseNotes> {
  const commits = await commitsIn(git, since ? `${tagOf(since.version)}..${head}` : head);
  const written = notesFrom(commits);
  const result: ReleaseNotes = { version, notes: written.notes, commits, ...(since && { since }) };
  if (!ai) return result;
  const polished = await polish(version, written.groups, written.notes, polishDeps);
  return polished.kind === 'polished'
    ? { ...result, notes: polished.notes, polishedBy: polished.by }
    : { ...result, plainWhy: polished.why };
}

/** Where a release's changes can be seen on GitHub: since the one before, or all of it. */
export function compareLink(repository: string, version: string, since?: Release): string {
  return since
    ? `https://github.com/${repository}/compare/${tagOf(since.version)}...${tagOf(version)}`
    : `https://github.com/${repository}/commits/${tagOf(version)}`;
}
