/**
 * The work folder, copied to a machine and back (ADR 0106). Before each
 * command, what changed here goes there; after it, what changed there comes
 * back. Both ways are worked out from a list of files (path, time, size), so
 * only what changed travels, and Conch's own file tools, which work here,
 * always see what the command made.
 *
 * What comes back is untrusted: the machine (or something running on it)
 * could send any path. So nothing is unpacked by a program: each file is
 * checked here, landed only inside the work folder, never through a link,
 * never over a protected place, and only if it was asked for.
 */
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, unlink, utimes } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { shq, type ExecResult } from './exec';
import { packTar, readTar } from './tar';

/** Folders that are rebuilt rather than copied: each machine installs its own. */
export const NOT_COPIED = [
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.gradle',
  '.tox',
  '.next',
  '.turbo',
  'target',
] as const;
const NOT_COPIED_SET: ReadonlySet<string> = new Set(NOT_COPIED);

/** How much is copied at most, each way. */
export const LIMITS = { files: 50_000, bytes: 1024 ** 3, back: 512 * 1024 ** 2 };

export interface FileStamp {
  mtime: number;
  size: number;
  exec: boolean;
}
export type Listing = Map<string, FileStamp>;

/** A machine Conch can run a shell script on. */
export interface Remote {
  /**
   * A POSIX shell script there. `stdin` goes to it; `binary` keeps stdout as
   * bytes (a tar), for machines whose answers are text otherwise.
   */
  sh(
    script: string,
    options: { stdin?: Buffer; binary?: boolean; timeoutMs: number; signal: AbortSignal },
  ): Promise<ExecResult>;
}

export class MirrorError extends Error {}

const same = (a: FileStamp | undefined, b: FileStamp | undefined) =>
  Boolean(a && b && a.mtime === b.mtime && a.size === b.size);

/** A path the machine sent that could only ever mean a file inside the work folder. */
export function safeRelative(path: string): boolean {
  if (!path || path.length > 4096 || path.includes('\0') || path.includes('\\')) return false;
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false;
  const parts = path.split('/');
  return parts.every(
    (part) =>
      part !== '' && part !== '.' && part !== '..' && part.length <= 255 && !/[<>:"|?*]/.test(part),
  );
}

const within = (root: string, path: string) => {
  const rel = relative(root, path);
  return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};

/** Protected places as given and as the file system names them (macOS's /var is /private/var). */
export async function canonicalAll(places: readonly string[]): Promise<string[]> {
  const real = await Promise.all(places.map((p) => realpath(p).catch(() => resolve(p))));
  return [...new Set([...places.map((p) => resolve(p)), ...real])];
}

/** Every file in the work folder worth copying, by its path inside it ('/'-separated). */
export async function listLocal(root: string, given: readonly string[]): Promise<Listing> {
  const base = await realpath(root);
  const forbidden = await canonicalAll(given);
  const out: Listing = new Map();
  let bytes = 0;
  const walk = async (dir: string, prefix: string) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (forbidden.some((p) => within(p, path))) continue;
      if (entry.isDirectory()) {
        if (NOT_COPIED_SET.has(entry.name)) continue;
        await walk(path, rel);
      } else if (entry.isFile()) {
        const stat = await lstat(path).catch(() => undefined);
        if (!stat?.isFile()) continue;
        out.set(rel, {
          mtime: Math.floor(stat.mtimeMs / 1000),
          size: stat.size,
          exec: (stat.mode & 0o111) !== 0,
        });
        bytes += stat.size;
        if (out.size > LIMITS.files || bytes > LIMITS.bytes)
          throw new MirrorError(
            'This work folder is too big to copy to another machine (more than 50,000 files or 1 GB). Run this chat on this computer or in a container instead.',
          );
      }
      // Links are not followed or copied: one could point anywhere on this computer.
    }
  };
  await walk(base, '');
  return out;
}

/** What `find` says there, as a listing. Lines: path, time, size, mode. */
export function parseListing(text: string): Listing {
  const out: Listing = new Map();
  for (const line of text.split(/[\n\0]/)) {
    if (!line) continue;
    const [raw, mtime, size, mode] = line.split('\t');
    const path = raw?.replace(/^\.\//, '');
    if (!path || !safeRelative(path) || path.split('/').some((p) => NOT_COPIED_SET.has(p)))
      continue;
    // A line that isn't a listing (a warning on the way) is left out, never guessed at.
    if (!Number.isFinite(Number(mtime)) || !Number.isFinite(Number(size))) continue;
    out.set(path, {
      mtime: Math.floor(Number(mtime)),
      size: Number(size),
      exec: (parseInt(mode ?? '0', 8) & 0o111) !== 0,
    });
  }
  return out;
}

const prune = NOT_COPIED.map((name) => `-name ${shq(name)}`).join(' -o ');

/** The script that lists files there: GNU find where it is, BSD's stat otherwise. */
export function listScript(root: string): string {
  return [
    `cd ${root} 2>/dev/null || exit 0`,
    `if find . -maxdepth 0 -printf '' >/dev/null 2>&1; then`,
    `  find . \\( ${prune} \\) -prune -o -type f -printf '%P\\t%T@\\t%s\\t%m\\0'`,
    `else`,
    `  find . \\( ${prune} \\) -prune -o -type f -exec stat -f '%N\t%m\t%z\t%Lp' {} +`,
    `fi`,
  ].join('\n');
}

/**
 * One chat's copy of its work folder on one machine. Commands for it run one
 * at a time, so the two lists never cross.
 */
export class Mirror {
  /** What the machine holds, as last seen. Unset until the first look. */
  #there?: Listing;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly remote: Remote,
    /** The copy's folder there, as a shell word ("$HOME"/.conch-work/c_123). */
    readonly root: string,
  ) {}

  /** Run `work` with the copy brought up to date before and brought back after. */
  serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.catch(() => undefined).then(work);
    this.#queue = next;
    return next;
  }

  async #list(signal: AbortSignal): Promise<Listing> {
    const result = await this.remote.sh(listScript(this.root), { timeoutMs: 120_000, signal });
    if (result.code !== 0)
      throw new MirrorError(
        `Couldn’t look at the copy there: ${result.stderr.trim() || 'no answer'}.`,
      );
    return parseListing(result.output);
  }

  /** Send what changed here. */
  async push(cwd: string, forbidden: readonly string[], signal: AbortSignal): Promise<void> {
    const there = this.#there ?? (await this.#list(signal));
    const here = await listLocal(cwd, forbidden);
    const send = [...here].filter(([path, stamp]) => !same(stamp, there.get(path)));
    const gone = [...there.keys()].filter((path) => !here.has(path));
    if (send.length || gone.length || !this.#there) {
      const base = await realpath(cwd);
      const files = [];
      for (const [path, stamp] of send) {
        const handle = await open(
          join(base, ...path.split('/')),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          files.push({
            path,
            data: await handle.readFile(),
            mode: stamp.exec ? 0o755 : 0o644,
            mtime: stamp.mtime,
          });
        } finally {
          await handle.close();
        }
      }
      const script = [
        'set -e',
        `mkdir -p ${this.root}`,
        `cd ${this.root}`,
        ...(gone.length ? [`for f in ${gone.map(shq).join(' ')}; do rm -f -- "$f"; done`] : []),
        // `tar` keeps each file's time as it was here, so the two lists agree.
        files.length ? 'tar -xzf -' : ':',
      ].join('\n');
      const result = await this.remote.sh(script, {
        ...(files.length && { stdin: packTar(files) }),
        timeoutMs: 600_000,
        signal,
      });
      if (result.code !== 0)
        throw new MirrorError(
          `Couldn’t copy the work folder there: ${result.stderr.trim().slice(-300) || 'no answer'}.`,
        );
    }
    // What's there now, as the machine itself says (its clock and its file system have the last word).
    this.#there = send.length ? await this.#list(signal) : new Map(here);
  }

  /** Bring back what the command changed there. Says how many files came back. */
  async pull(
    cwd: string,
    forbidden: readonly string[],
    signal: AbortSignal,
  ): Promise<{ changed: number; removed: number; skipped: number }> {
    const before = this.#there ?? new Map<string, FileStamp>();
    const now = await this.#list(signal);
    const changed = [...now].filter(([path, stamp]) => !same(stamp, before.get(path)));
    const removed = [...before.keys()].filter((path) => !now.has(path));
    const total = changed.reduce((sum, [, s]) => sum + s.size, 0);
    if (total > LIMITS.back)
      throw new MirrorError(
        'The command made more than 512 MB of files there, too much to bring back. Delete what isn’t needed (build output, downloads) and run it again.',
      );
    const base = await realpath(cwd);
    forbidden = await canonicalAll(forbidden);
    let skipped = 0;
    if (changed.length) {
      const wanted = new Set(changed.map(([path]) => path));
      // A Mac's tar adds `._` files for extended attributes unless told not to.
      const result = await this.remote.sh(
        `cd ${this.root} && COPYFILE_DISABLE=1 tar -czf - --null -T -`,
        {
          stdin: Buffer.from(changed.map(([path]) => path).join('\0') + '\0'),
          binary: true,
          timeoutMs: 600_000,
          signal,
        },
      );
      if (result.code !== 0 && !result.stdout.length)
        throw new MirrorError(
          `Couldn’t bring the changes back: ${result.stderr.trim().slice(-300) || 'no answer'}.`,
        );
      for (const entry of readTar(result.stdout, LIMITS.back + 64 * 1024 ** 2)) {
        const path = entry.path.replace(/^\.\//, '');
        if (entry.type === 'dir') continue;
        // Only what was asked for, only plain files, only inside the work folder.
        if (entry.type !== 'file' || !wanted.has(path) || !safeRelative(path)) {
          skipped++;
          continue;
        }
        wanted.delete(path);
        if (!(await land(base, path, entry.data, entry.mode, entry.mtime, forbidden))) skipped++;
      }
    }
    for (const path of removed) if (safeRelative(path)) await remove(base, path, forbidden);
    this.#there = now;
    return { changed: changed.length, removed: removed.length, skipped };
  }

  /** Forget what's there (a new machine, a wiped copy): the next push looks first. */
  forget(): void {
    this.#there = undefined;
  }
}

/** The folder a file goes in, made as needed, refusing any link on the way. */
async function folderFor(base: string, parts: readonly string[]): Promise<string | undefined> {
  let dir = base;
  for (const part of parts) {
    dir = join(dir, part);
    const stat = await lstat(dir).catch(() => undefined);
    if (!stat) await mkdir(dir);
    else if (stat.isSymbolicLink() || !stat.isDirectory()) return undefined;
  }
  return within(base, await realpath(dir)) ? dir : undefined;
}

/** One file from there, landed here; false when it isn't allowed. */
export async function land(
  base: string,
  path: string,
  data: Buffer,
  mode: number,
  mtime: number,
  forbidden: readonly string[],
): Promise<boolean> {
  const parts = path.split('/');
  if (parts.some((p) => NOT_COPIED_SET.has(p))) return false;
  const target = resolve(base, ...parts);
  if (!within(base, target) || forbidden.some((p) => within(p, target))) return false;
  const dir = await folderFor(base, parts.slice(0, -1));
  if (!dir) return false;
  const file = join(dir, parts[parts.length - 1] ?? '');
  const existing = await lstat(file).catch(() => undefined);
  if (existing && (!existing.isFile() || existing.nlink > 1)) return false;
  const handle = await open(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    mode & 0o111 ? 0o755 : 0o644,
  );
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
  if (mtime > 0) await utimes(file, mtime, mtime).catch(() => undefined);
  return true;
}

/** A file deleted there, deleted here: only a plain file inside the work folder. */
async function remove(base: string, path: string, forbidden: readonly string[]): Promise<void> {
  const parts = path.split('/');
  const target = resolve(base, ...parts);
  if (!within(base, target) || forbidden.some((p) => within(p, target))) return;
  const parent = await realpath(resolve(target, '..')).catch(() => undefined);
  if (!parent || !within(base, parent)) return;
  const stat = await lstat(target).catch(() => undefined);
  if (stat?.isFile() && stat.nlink === 1) await unlink(target).catch(() => undefined);
}
