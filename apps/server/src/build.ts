/** Build identity is display metadata, never authority to install or trust a release. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConchBuild } from '@conch/protocol';

const VERSION =
  /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:-(alpha|beta)\.([1-9]\d{0,4}))?$/;
const COMMIT = /^[a-f0-9]{40}$/;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
function json(path: string): Record<string, unknown> {
  try {
    return record(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return {};
  }
}

/**
 * No network. Source checkouts use Git; packaged copies carry the build-time
 * result. Git gets a second at start-up (display only); a build that stamps
 * the result waits longer (`gitTimeoutMs`): on a slow computer the first
 * `git status` of a fresh checkout takes longer than that.
 */
export function readBuild(
  root: string,
  { gitTimeoutMs = 1_000 }: { gitTimeoutMs?: number } = {},
): ConchBuild {
  const version = json(join(root, 'package.json')).version;
  const match = typeof version === 'string' ? VERSION.exec(version) : null;
  const channel = match?.[4] === 'alpha' ? 'alpha' : match?.[4] === 'beta' ? 'beta' : 'stable';
  if (!existsSync(join(root, '.git'))) {
    const build = json(join(root, 'conch-build.json'));
    const commit =
      typeof build.commit === 'string' && COMMIT.test(build.commit) ? build.commit : undefined;
    if (
      build.kind === 'release' &&
      match &&
      build.version === version &&
      build.channel === channel &&
      commit
    )
      return { kind: 'release', version: String(version), channel, commit };
    return { kind: 'dev', ...(commit && { commit }) };
  }
  const git = (args: string[]): string | undefined => {
    try {
      return execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        timeout: gitTimeoutMs,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return undefined;
    }
  };
  const head = git(['rev-parse', '--verify', 'HEAD']);
  const commit = head && COMMIT.test(head) ? head : undefined;
  const dev: ConchBuild = { kind: 'dev', ...(commit && { commit }) };
  // A branch remains Dev even at a release commit. Changed release checkouts do too.
  if (
    !commit ||
    !match ||
    git(['rev-parse', '--abbrev-ref', 'HEAD']) !== 'HEAD' ||
    git(['status', '--porcelain=v1', '--untracked-files=no']) !== ''
  )
    return dev;
  for (const prefix of ['refs/tags/', 'refs/conch/tags/']) {
    if (git(['rev-parse', '--verify', `${prefix}v${version}^{commit}`]) === commit)
      return { kind: 'release', version: String(version), channel, commit };
  }
  return dev;
}

/** Electron compares package numbers: Dev must sort below the first real release. */
export function desktopPackageVersion(build: ConchBuild): string {
  return build.kind === 'release' ? build.version : `0.0.0-dev.${build.commit ?? '0'}`;
}
