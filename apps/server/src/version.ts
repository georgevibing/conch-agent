/**
 * Conch's version, reported to the web app and to MCP servers Conch connects
 * to. It's written in one place only, the root `package.json` (ADR 0051):
 * `pnpm release` moves it on, and everything else reads it. The same file
 * names Conch's repository, where the desktop app finds its releases
 * (ADR 0054).
 */
import { conchBuildLabel } from '@conch/protocol';
import { readBuild } from './build';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function root(): { version?: unknown; repository?: unknown } {
  try {
    return JSON.parse(
      readFileSync(join(import.meta.dirname, '..', '..', '..', 'package.json'), 'utf8'),
    ) as { version?: unknown; repository?: unknown };
  } catch {
    return {};
  }
}

const written = root();

/** The running build, frozen at startup even if its checkout moves on. */
export const SERVER_BUILD = readBuild(join(import.meta.dirname, '..', '..', '..'));
export const SERVER_LABEL = conchBuildLabel(SERVER_BUILD);

export const SERVER_VERSION = typeof written.version === 'string' ? written.version : '0.0.0';

/** `{ type, url }` or a plain string, as npm allows: the owner and name on GitHub. */
export function githubRepository(repository: unknown): { owner: string; repo: string } | undefined {
  const url =
    typeof repository === 'string'
      ? repository
      : typeof (repository as { url?: unknown } | undefined)?.url === 'string'
        ? (repository as { url: string }).url
        : undefined;
  const match =
    url &&
    /^(?:github:|(?:git\+)?https:\/\/github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    );
  return match?.[1] && match[2] ? { owner: match[1], repo: match[2] } : undefined;
}

/** Where Conch's releases are published. */
export const REPOSITORY = githubRepository(written.repository);
