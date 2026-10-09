/**
 * Which releases come next: alphas, betas or stable ones (ADR 0127).
 * `release-please-config.json` says, and `pnpm release channel` and
 * `pnpm release as` change it, in a commit like any other:
 *
 * - `prerelease` and `prerelease-type` (`alpha.1`, `beta.1`): with them,
 *   release-please counts `0.4.0-beta.1`, `-beta.2`… and a stable release
 *   promotes the pre-releases of its version (`0.4.0-beta.3` → `0.4.0`);
 * - a one-off `release-as` for the step release-please can't take itself,
 *   from alphas to betas of the same version. The release pull request
 *   takes it out again (`pr.ts`), so it's used once.
 * - before the first release, `initial-version` is where it starts.
 */
import type { ReleaseChannel } from '@conch/protocol';

import { compareVersions } from '../updates/version';
import { Stop } from './history';
import { parseRelease, type Release } from './semver';

type Json = Record<string, unknown>;

export interface ChannelChange {
  /** The configuration's new text. */
  text: string;
  /** What the next release will be, in a sentence. */
  next: string;
}

const core = (r: Release) => `${r.major}.${r.minor}.${r.patch}`;

function read(text: string): Json {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Stop('release-please-config.json isn’t a JSON object.');
  return value as Json;
}

const write = (config: Json) => `${JSON.stringify(config, null, 2)}\n`;

/** The channel the configuration releases on now. */
export function channelIn(text: string): ReleaseChannel {
  const config = read(text);
  if (config.prerelease !== true) return 'stable';
  return String(config['prerelease-type'] ?? '').startsWith('beta') ? 'beta' : 'alpha';
}

/**
 * Release on `channel` from now on. `latest` is the newest release tagged,
 * if there is one.
 */
export function setChannel(text: string, channel: ReleaseChannel, latest?: string): ChannelChange {
  const config = read(text);
  const last = latest ? parseRelease(latest) : undefined;
  delete config['release-as'];
  config.versioning = 'prerelease';
  if (channel === 'stable') {
    config.prerelease = false;
    delete config['prerelease-type'];
  } else {
    config.prerelease = true;
    config['prerelease-type'] = `${channel}.1`;
  }
  if (!last) {
    // Before the first release: it starts at the version's first of this kind.
    const start =
      parseRelease(String(config['initial-version'] ?? '0.1.0')) ?? parseRelease('0.1.0');
    const base = start ? core(start) : '0.1.0';
    const first = channel === 'stable' ? base : `${base}-${channel}.1`;
    config['initial-version'] = first;
    return { text: write(config), next: `The first release will be ${first}.` };
  }
  if (last.pre?.kind === 'beta' && channel === 'alpha')
    throw new Stop(
      `${last.version} is a beta, and an alpha of the same version would come before it. Stay on beta, or release ${core(last)} first (pnpm release channel stable).`,
    );
  if (last.pre?.kind === 'alpha' && channel === 'beta') {
    // The one step release-please can't take by itself.
    const next = `${core(last)}-beta.1`;
    config['release-as'] = next;
    return { text: write(config), next: `The next release will be ${next}, then betas.` };
  }
  if (last.pre && channel === 'stable')
    return { text: write(config), next: `The next release will be ${core(last)}, the stable one.` };
  if (channel === 'stable')
    return { text: write(config), next: 'The next releases will be stable ones.' };
  return {
    text: write(config),
    next: last.pre
      ? `The next releases will be more ${channel}s of ${core(last)}.`
      : `The next release will be the first ${channel} of the version after ${last.version}.`,
  };
}

/** Make the next release exactly `version`, once. */
export function setReleaseAs(text: string, version: string, latest?: string): ChannelChange {
  const wanted = parseRelease(version);
  if (!wanted)
    throw new Stop(`${version} isn’t a version Conch releases (like 0.4.0 or 0.4.0-beta.1).`);
  if (latest && compareVersions(version, latest) <= 0)
    throw new Stop(`${version} isn’t newer than ${latest}, the newest release.`);
  const config = read(text);
  config['release-as'] = version;
  return { text: write(config), next: `The next release will be ${version}.` };
}
