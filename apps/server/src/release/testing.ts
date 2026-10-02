/**
 * Real git repositories and real SSH keys for the release tests (ADR 0048):
 * a bare "origin", a maintainer's clone that signs tags with `git tag -s`,
 * and keys made by `ssh-keygen`. Nothing here touches this repository or the
 * network. Used by the unit tests and by the `releases` e2e journey.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Ada',
  GIT_AUTHOR_EMAIL: 'ada@example.com',
  GIT_COMMITTER_NAME: 'Ada',
  GIT_COMMITTER_EMAIL: 'ada@example.com',
  GIT_TERMINAL_PROMPT: '0',
  // The tests' git never reads the configuration of whoever runs them.
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
    cwd,
    env: GIT_ENV,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
}

export interface Key {
  /** The private key's file: `user.signingkey` takes it. */
  file: string;
  /** `ssh-ed25519 AAAA… name` */
  pub: string;
}

/** A new ed25519 key without a passphrase. */
export function makeKey(dir: string, name: string): Key {
  const file = join(dir, name);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', name, '-f', file], {
    stdio: 'pipe',
  });
  return { file, pub: readFileSync(`${file}.pub`, 'utf8').trim() };
}

/** A line of `allowed_signers` for a key. */
export const signer = (who: string, key: Key) =>
  `${who} namespaces="git" ${key.pub.split(' ').slice(0, 2).join(' ')}`;

/** An annotated tag, signed by `key` (or not signed at all). */
export function tag(repo: string, name: string, message: string, key?: Key): void {
  if (key)
    git(
      repo,
      '-c',
      'gpg.format=ssh',
      '-c',
      `user.signingkey=${key.file}`,
      'tag',
      '-s',
      '--cleanup=verbatim',
      '-m',
      message,
      name,
    );
  else git(repo, 'tag', '-a', '--cleanup=verbatim', '-m', message, name);
}

/** A file written and committed. */
export function commit(repo: string, files: Record<string, string>, subject: string): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '--allow-empty', '-m', subject);
  return git(repo, 'rev-parse', 'HEAD');
}

/** The few files a pretend Conch needs to look like one. */
export function conchFiles(version: string, signers: string): Record<string, string> {
  return {
    'package.json': `${JSON.stringify({ name: 'conch', version, private: true }, null, 2)}\n`,
    'pnpm-workspace.yaml': 'packages: []\n',
    'apps/server/package.json': '{}\n',
    'apps/server/src/start.ts': '// A pretend Conch.\n',
    'release/allowed_signers': signers,
  };
}
