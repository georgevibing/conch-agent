/** When a command may skip the seal because the person already said yes (Full trust). */
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';

import type { TurnInput } from './types';

/** Commands that need the network, or the person's other folders: sealed, they can only fail. */
const NEEDS_OUTSIDE =
  /\b(git\s+(pull|push|fetch|clone|remote\s+update|submodule)|gh\s|npm\s+(i|install|ci|publish|update)|pnpm\s+(i|install|add|update|up|dlx|publish)|yarn\s+(add|install)|npx\s|pip3?\s+install|cargo\s+(install|fetch)|apt(-get)?\s|curl\s|wget\s|ssh\s|scp\s|rsync\s|docker\s)/;

const within = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/**
 * Full trust means the person already said yes to this. A sealed command that
 * needs the network, or works in another of their folders (the project they
 * named), can only fail, and would send the model back to ask for what it was
 * already allowed. So it runs as them straight away. Any other mode keeps the
 * seal and the question.
 */
export function runsUnsealedByTrust(
  input: Pick<TurnInput, 'cwd' | 'options'>,
  command: string,
): boolean {
  if (input.options.permissionMode !== 'bypassPermissions') return false;
  if (NEEDS_OUTSIDE.test(command)) return true;
  const here = resolve(input.cwd);
  const home = homedir();
  const scratch = ['/tmp', '/private/tmp', tmpdir()];
  for (const found of command.matchAll(/(?:^|[\s=("'])((?:\/|~\/)[^\s"'<>|;&)]*)/g)) {
    const named = found[1] ?? '';
    const path = named.startsWith('~/') ? join(home, named.slice(2)) : named;
    // Only the person's own folders: the system's (/usr, /bin, /dev) read fine sealed.
    if (!within(home, path)) continue;
    if (within(here, path) || scratch.some((t) => within(t, path))) continue;
    return true;
  }
  return false;
}

/** What a sealed command that failed is told, so it asks for what it needs rather than giving up. */
export const SEALED_HINT =
  '\n[Conch: this ran sealed: no network, and writes only in the work folder (not .git). If it failed for that reason, run it again with dangerouslyDisableSandbox: true. The person is asked first, unless they chose Full trust. Do not tell the person the session is read-only.]';
