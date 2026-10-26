/**
 * Fresh evidence for a same-destination remote update. No network, no model judgement.
 * Unknown or complicated shell/Git forms keep the normal permission decision.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve, join } from 'node:path';

import { commandParts, wordsOf, type RiskContext } from './risk';

async function remoteUrls(dir: string, name: string): Promise<string[] | undefined> {
  if (!existsSync(join(dir, '.git'))) return undefined;
  const read = (push: boolean) =>
    new Promise<string[] | undefined>((done) => {
      execFile(
        'git',
        ['-C', dir, 'remote', 'get-url', ...(push ? ['--push'] : []), '--all', name],
        { timeout: 1500, maxBuffer: 8192, windowsHide: true },
        (error, stdout) => done(error ? undefined : stdout.trim().split('\n')),
      );
    });
  const fetch = await read(false);
  const push = await read(true);
  return fetch && push ? [...fetch, ...push] : undefined;
}

/** Exact HTTPS destination only: no credentials, helpers, query strings or protocol changes. */
function httpsRemote(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      return undefined;
    return url.href.replace(/\.git\/?$/, '').replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

/**
 * The hosts a work folder's own HTTPS remotes name, as `host:port` (ADR 0148), read from its
 * Git settings on this computer: no network. A remote with a password in its address, a
 * plain-HTTP or SSH one, or a host that is only an address (no name) adds nothing.
 */
export async function remoteHosts(dir: string): Promise<string[]> {
  if (!existsSync(join(dir, '.git'))) return [];
  const names = await new Promise<string[]>((done) => {
    execFile(
      'git',
      ['-C', dir, 'remote'],
      { timeout: 1500, maxBuffer: 8192, windowsHide: true },
      (error, stdout) => done(error ? [] : stdout.split('\n').filter(Boolean)),
    );
  });
  const urls = await Promise.all(
    names
      .filter((name) => /^[\w.-]+$/.test(name))
      .slice(0, 8)
      .map((name) => remoteUrls(dir, name)),
  );
  const hosts = urls.flatMap((list) =>
    (list ?? []).flatMap((raw) => {
      const target = httpsRemote(raw);
      if (!target) return [];
      const url = new URL(target);
      // A name with letters at its end: never an address, and never `localhost`.
      if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z][a-z0-9-]*[a-z0-9]$/.test(url.hostname)) return [];
      return [`${url.hostname}:${url.port || '443'}`];
    }),
  );
  return [...new Set(hosts)];
}

export async function knownRemotes(
  command: string,
  workspace: string,
): Promise<RiskContext['sameRemote']> {
  if (!/\bremote\s+set-url\b/.test(command)) return undefined;
  // We only reason across successful plain commands, never substitutions or alternate branches.
  if (/[;|\n`$<>]/.test(command)) return undefined;
  const known = new Map<string, string>();
  const clones = new Map<string, string>();
  let looks = 0;
  for (const part of commandParts(command)) {
    const words = wordsOf(part);
    if (words[0] !== 'git') return undefined;
    let at = 1;
    let dir = workspace;
    if (words[at] === '-C' && isAbsolute(words[at + 1] ?? '')) {
      dir = words[at + 1] as string;
      at += 2;
    }
    const args = words.slice(at);
    if (!['clone', 'remote', 'fetch', 'merge', 'status', 'log'].includes(args[0] ?? ''))
      return undefined;
    // A new local clone can preserve its source's origin. Existing destinations aren't inferred.
    if (
      args[0] === 'clone' &&
      args[1] === '--shared' &&
      args.length === 4 &&
      isAbsolute(args[2] ?? '') &&
      isAbsolute(args[3] ?? '') &&
      !existsSync(args[3] as string)
    ) {
      clones.set(args[3] as string, args[2] as string);
      continue;
    }
    if (
      args[0] !== 'remote' ||
      args[1] !== 'set-url' ||
      args.length !== 4 ||
      !/^[a-zA-Z0-9_-]+$/.test(args[2] ?? '') ||
      ++looks > 8
    )
      continue;
    const target = httpsRemote(args[3] ?? '');
    if (!target) continue;
    const source = clones.get(dir) ?? dir;
    const urls = await remoteUrls(source, args[2] as string);
    if (urls?.length && urls.every((url) => httpsRemote(url) === target))
      known.set(`${resolve(dir)}\n${args[2]}`, target);
  }
  return (dir, remote, target) =>
    known.get(`${resolve(workspace, dir ?? '.')}\n${remote}`) === httpsRemote(target) &&
    httpsRemote(target) !== undefined;
}
