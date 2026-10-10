import { z } from 'zod';

import {
  channelOf,
  newestFirst,
  parseRelease,
  releaseOfTag,
  steadiest,
  type Release,
} from '../../server/src/release/semver';
import { GitHubRelease, type PublishedRelease, type SitePublication } from './schema';

/** Failure is not an empty release list. Every advertised release must check out. */
export async function publications(
  input: unknown,
  verify: (tag: string) => Promise<string>,
): Promise<PublishedRelease[]> {
  const releases = z.array(GitHubRelease).parse(input);
  const published: PublishedRelease[] = [];
  for (const item of releases) {
    if (item.draft) continue;
    const release = releaseOfTag(item.tag_name);
    if (!release || `v${release.version}` !== item.tag_name) continue;
    if (!item.published_at || item.prerelease !== Boolean(release.pre))
      throw new Error(`Release ${item.tag_name} has inconsistent publication metadata.`);
    const commit = await verify(item.tag_name);
    published.push({
      tag: item.tag_name,
      version: release.version,
      channel: channelOf(release),
      commit,
      name: item.name || `Conch ${release.version}`,
      notes: item.body?.trim() || 'No release notes were provided.',
      published: item.published_at,
      downloads: item.assets.some(
        (asset) =>
          asset.state === 'uploaded' &&
          asset.size > 0 &&
          /\.(dmg|exe|AppImage|deb|zip)$/.test(asset.name),
      ),
    });
  }
  return newestFirst(published);
}

/**
 * The public site describes the newest release of the steadiest channel that
 * has one: stable once there's a stable release, before that beta, then alpha
 * (ADR 0093). Before the first release, or when that release's own site can't
 * describe its channel (`describes`), it's validated main.
 */
export function selectPublication(
  releases: PublishedRelease[],
  main: string,
  describes: (release: PublishedRelease) => boolean = () => true,
): SitePublication {
  const channel = steadiest(
    releases.map((release) => parseRelease(release.version)).filter((r): r is Release => !!r),
  );
  const chosen = newestFirst(releases).find((release) => release.channel === channel);
  const release = chosen && describes(chosen) ? chosen : undefined;
  return {
    channel: release?.channel ?? 'development',
    commit: release?.commit ?? main,
    ...(release && { tag: release.tag }),
    next: false,
    releases,
  };
}

/**
 * Whether a release's own site (its `publishing/schema.ts`) can describe a
 * release on `channel`: sites from before v0.1.0-alpha.2 knew only stable
 * releases and development, and would refuse to build as an alpha.
 */
export function describesChannel(schema: string, channel: PublishedRelease['channel']): boolean {
  const known = /SitePublication = z\.object\(\{[^]*?channel: z\.enum\(\[([^\]]*)\]\)/.exec(
    schema,
  )?.[1];
  return known === undefined || known.includes(`'${channel}'`);
}
