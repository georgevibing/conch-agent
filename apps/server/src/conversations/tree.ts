/**
 * Whether a repository has anything to lose (ADR 0128): staged, changed or
 * untracked files. Asked before a command that would throw them away, so
 * `git reset --hard` on a clean tree is nothing to ask about. Unknown (not a
 * repository, git missing, too slow) is unknown, never clean.
 */
import { execFile } from 'node:child_process';

export function treeClean(dir: string, timeoutMs = 3_000): Promise<boolean | undefined> {
  return new Promise((resolve) => {
    try {
      execFile(
        'git',
        ['-C', dir, 'status', '--porcelain', '--untracked-files=normal'],
        { timeout: timeoutMs, maxBuffer: 1 << 20, windowsHide: true },
        (error, stdout) => resolve(error ? undefined : stdout.trim() === ''),
      );
    } catch {
      resolve(undefined);
    }
  });
}
