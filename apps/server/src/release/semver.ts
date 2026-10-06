/**
 * Conch's release numbers (ADR 0051): `v0.3.0` is a stable release,
 * `v0.4.0-beta.2` and `v0.4.0-alpha.1` are pre-releases. Nothing else is a
 * release, however it's spelt: a tag is read strictly, because what it says
 * decides what installs.
 *
 * The next number comes from the conventional commits since the last stable
 * release: a breaking change is a new major version (a new minor before
 * 1.0), a `feat` a new minor, anything else a patch.
 */
import type { ReleaseChannel } from '@conch/protocol';

import { compareVersions } from '../updates/version';

export interface Release {
  /** "0.4.0-beta.2" */
  version: string;
  major: number;
  minor: number;
  patch: number;
  /** Absent for a stable release. */
  pre?: { kind: 'alpha' | 'beta'; n: number };
}

/** `0.3.0`, `0.4.0-beta.2`, `1.0.0-alpha.1`: no leading zeros, nothing more. */
const VERSION =
  /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:-(alpha|beta)\.([1-9]\d{0,4}))?$/;

/** A version as Conch writes them, or `undefined` for anything else. */
export function parseRelease(version: string): Release | undefined {
  const match = VERSION.exec(version.trim());
  if (!match) return undefined;
  const [, major = '0', minor = '0', patch = '0', kind, n] = match;
  return {
    version: version.trim(),
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    ...(kind && n && { pre: { kind: kind as 'alpha' | 'beta', n: Number(n) } }),
  };
}

/** A tag's release: `v0.3.0` only (a `v`, then a version). */
export function releaseOfTag(tag: string): Release | undefined {
  return tag.startsWith('v') ? parseRelease(tag.slice(1)) : undefined;
}

export const tagOf = (version: string) => `v${version}`;

/** The channel a release belongs to. */
export function channelOf(release: Release): ReleaseChannel {
  return release.pre?.kind ?? 'stable';
}

/** How settled each channel is: stable takes only stable, alpha takes everything. */
const RANK: Record<ReleaseChannel, number> = { stable: 0, beta: 1, alpha: 2 };

/** A release someone on `channel` gets: stable on every channel, betas on beta and alpha. */
export function inChannel(release: Release, channel: ReleaseChannel): boolean {
  return RANK[channelOf(release)] <= RANK[channel];
}

/** Newest first. */
export function newestFirst<T extends { version: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * The releases worth offering on `channel` to a Conch at `current`: newer
 * than it, in the channel, not one that failed here. Newest first.
 */
export function offered<T extends { release: Release }>(
  all: T[],
  {
    channel,
    current,
    failed = [],
  }: { channel: ReleaseChannel; current: string; failed?: string[] },
): T[] {
  return all
    .filter(
      ({ release }) =>
        inChannel(release, channel) &&
        compareVersions(release.version, current) > 0 &&
        !failed.includes(release.version),
    )
    .sort((a, b) => compareVersions(b.release.version, a.release.version));
}

// ── The next number ───────────────────────────────────────────────────────

export interface Commit {
  sha: string;
  subject: string;
  body: string;
}

export type Bump = 'major' | 'minor' | 'patch';

const TYPE = /^([a-z]+)(?:\([^)]*\))?(!)?:/i;

/** A commit that breaks something: `feat!:`, or a `BREAKING CHANGE:` footer. */
export function isBreaking(commit: Commit): boolean {
  return Boolean(TYPE.exec(commit.subject)?.[2]) || /^BREAKING[ -]CHANGE:/m.test(commit.body);
}

/** How big a step these commits are. */
export function bumpFor(commits: Commit[]): Bump {
  if (commits.some(isBreaking)) return 'major';
  if (commits.some((c) => TYPE.exec(c.subject)?.[1]?.toLowerCase() === 'feat')) return 'minor';
  return 'patch';
}

/** The stable version after `last`: before 1.0, a breaking change is a new minor. */
export function nextStable(last: string, bump: Bump): string {
  const r = parseRelease(last) ?? parseRelease('0.0.0');
  if (!r) throw new Error(`Not a version: ${last}`);
  // A pre-release of the next version came first: that version is still next.
  if (r.pre) return `${r.major}.${r.minor}.${r.patch}`;
  if (bump === 'major' && r.major > 0) return `${r.major + 1}.0.0`;
  if (bump === 'major' || bump === 'minor') return `${r.major}.${r.minor + 1}.0`;
  return `${r.major}.${r.minor}.${r.patch + 1}`;
}

/**
 * The version to release now.
 *
 * - `stable`: the next stable version from the commits since the last stable
 *   release (which a beta of it doesn't change: promoting `0.4.0-beta.3` is
 *   just `0.4.0`).
 * - `beta`, `alpha`: that same version, with the next number of its kind
 *   (`0.4.0-beta.1`, then `-beta.2`).
 */
export function nextVersion({
  lastStable,
  commits,
  kind,
  existing,
  first = false,
}: {
  /** The newest stable release, or the version written down before the first. */
  lastStable: string;
  /** Before the first stable release, the written version is the target, not a released baseline. */
  first?: boolean;
  commits: Commit[];
  kind: ReleaseChannel;
  /** Every release tagged so far, as versions. */
  existing: string[];
}): string {
  const base = first
    ? lastStable.replace(/-(?:alpha|beta)\.\d+$/, '')
    : nextStable(lastStable, bumpFor(commits));
  if (kind === 'stable') return base;
  const taken = existing
    .map(parseRelease)
    .filter(
      (r): r is Release =>
        Boolean(r?.pre) && r?.pre?.kind === kind && `${r.major}.${r.minor}.${r.patch}` === base,
    )
    .map((r) => r.pre?.n ?? 0);
  return `${base}-${kind}.${Math.max(0, ...taken) + 1}`;
}
