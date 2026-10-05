import { z } from 'zod';

import { channelOf, newestFirst, releaseOfTag } from '../../server/src/release/semver';
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

export function selectPublication(releases: PublishedRelease[], main: string): SitePublication {
  const stable = newestFirst(releases).find((release) => release.channel === 'stable');
  return {
    channel: stable ? 'stable' : 'development',
    commit: stable?.commit ?? main,
    ...(stable && { tag: stable.tag }),
    next: false,
    releases,
  };
}
