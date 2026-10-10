/**
 * Conch's release numbers (ADR 0051): `v0.3.0` is a stable release,
 * `v0.4.0-beta.2` and `v0.4.0-alpha.1` are pre-releases. Nothing else is a
 * release, however it's spelt: a tag is read strictly, because what it says
 * decides what installs.
 *
 * Which number comes next is release-please's to work out, from the
 * conventional commits (ADR 0127); Conch reads the numbers it makes.
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

const CHANNELS: readonly ReleaseChannel[] = ['stable', 'beta', 'alpha'];

/**
 * The channels with a release to follow, steadiest first. A stable release is
 * on every channel, so once there's one, every channel is open.
 */
export function openChannels(releases: readonly Release[]): ReleaseChannel[] {
  return CHANNELS.filter((channel) => releases.some((release) => inChannel(release, channel)));
}

/**
 * What follows releases when nobody chose a channel: the steadiest one with a
 * release. Stable once there's a stable release; before that beta, then alpha,
 * so the first installs get the first releases. None before the first release.
 */
export function steadiest(releases: readonly Release[]): ReleaseChannel | undefined {
  return openChannels(releases)[0];
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

// ── Commits ───────────────────────────────────────────────────────────────

export interface Commit {
  sha: string;
  subject: string;
  body: string;
}

const TYPE = /^([a-z]+)(?:\([^)]*\))?(!)?:/i;

/** A commit that breaks something: `feat!:`, or a `BREAKING CHANGE:` footer. */
export function isBreaking(commit: Commit): boolean {
  return Boolean(TYPE.exec(commit.subject)?.[2]) || /^BREAKING[ -]CHANGE:/m.test(commit.body);
}
