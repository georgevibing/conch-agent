/**
 * A Conch app's package (ADR 0061 §1): a small folder of text files (and
 * perhaps one picture as its icon, ADR 0090), read
 * from disk, from a `.conchapp` (a tar.gz) or from a GitHub tarball.
 *
 * Whatever it came from, it's held to the same rules before anything looks
 * inside: regular files only (never links, devices or folders that point
 * elsewhere), paths that stay inside it, known kinds of text, and the
 * limits in `APP_LIMITS`, counted while reading so a bomb stops at the cap.
 * Then the manifest is read, and every file it names must be there.
 */
import { createHash } from 'node:crypto';
import { lstat, open, readdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

import {
  APP_LIMITS,
  APP_PICTURES,
  AppFilePath,
  ConchAppManifest,
  isAppPicture,
  SkillName,
} from '@conch/protocol';
import type { z } from 'zod';

import { BackupError, readTar, TarWriter } from '../backup/archive';
import { validRelPath } from '../backup/paths';
import { safeJoin } from '../lib/fs';
import type { AppCheckItem } from '@conch/protocol';

import { pictureProblem, picturesIn } from './picture';
import type { AppFiles, AppPackage, PackageRead } from './types';

export const MANIFEST_FILE = 'conch-app.json';
export const SIGNATURE_FILE = 'conch-app.sig';

/** Files a repository carries that aren't part of the app, but are text: allowed as they are. */
const PLAIN_NAMES = new Set(['LICENSE', 'LICENCE', 'COPYING', 'NOTICE']);

/** A package that can't be read at all: hostile, damaged, or not one. One sentence. */
export class PackageError extends Error {}

/** SHA-256 over every path (sorted) and its bytes, `conch-app.sig` left out. */
export function appHash(files: AppFiles): string {
  const hash = createHash('sha256');
  for (const path of [...files.keys()].sort()) {
    if (path === SIGNATURE_FILE) continue;
    hash.update(path);
    hash.update('\0');
    hash.update(files.get(path) as Buffer);
    hash.update('\0');
  }
  return hash.digest('hex');
}

const extensionOf = (path: string) => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

/** Text Conch can read: UTF-8, no NULs. */
function isText(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

const quote = (text: string) => `“${text.slice(0, 80)}”`;

const PICTURE_NAMES = Object.keys(APP_PICTURES).join(', ');

/** Why a path can't be in a package, or nothing when it can. */
function pathProblem(path: string): string | undefined {
  if (!AppFilePath.safeParse(path).success || !validRelPath(path))
    return `${quote(path)} can’t be in an app: use plain names inside the app’s folder, with no hidden files.`;
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (path === SIGNATURE_FILE || PLAIN_NAMES.has(name) || isAppPicture(path)) return undefined;
  if (!(APP_LIMITS.extensions as readonly string[]).includes(extensionOf(path)))
    return `${quote(path)} isn’t a kind of file an app can carry. Apps carry only ${APP_LIMITS.extensions.join(', ')} files, and one picture as their icon at the top: ${PICTURE_NAMES}.`;
  return undefined;
}

/** A Zod issue with the manifest, in words that name the field. */
function manifestIssue(issue: z.core.$ZodIssue): string {
  const field = issue.path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : `${i ? '.' : ''}${String(p)}`))
    .join('');
  const named = field ? `“${field}”` : 'It';
  switch (issue.code) {
    case 'unrecognized_keys':
      return `${MANIFEST_FILE} has ${issue.keys.length > 1 ? 'fields' : 'a field'} Conch doesn’t know${field ? ` in “${field}”` : ''}: ${issue.keys.map(quote).join(', ')}. Take ${issue.keys.length > 1 ? 'them' : 'it'} out.`;
    case 'invalid_type':
      return issue.input === undefined
        ? `${MANIFEST_FILE} needs ${named}.`
        : `${named} in ${MANIFEST_FILE} must be ${issue.expected === 'string' ? 'text' : issue.expected}.`;
    case 'too_big':
      return `${named} in ${MANIFEST_FILE} is too long: at most ${String(issue.maximum)} ${issue.origin === 'array' ? 'items' : 'characters'}.`;
    case 'too_small':
      return issue.origin === 'string' && Number(issue.minimum) <= 1
        ? `${named} in ${MANIFEST_FILE} can’t be empty.`
        : `${named} in ${MANIFEST_FILE} is too short: at least ${String(issue.minimum)} ${issue.origin === 'array' ? 'items' : 'characters'}.`;
    case 'invalid_value': {
      const values = issue.values.map((v) => JSON.stringify(v));
      return values.length === 1
        ? `${named} in ${MANIFEST_FILE} must be ${values[0]}.`
        : `${named} in ${MANIFEST_FILE} must be one of: ${values.slice(0, 12).join(', ')}${values.length > 12 ? ' …' : ''}.`;
    }
    default:
      return `${named} in ${MANIFEST_FILE}: ${issue.message}`;
  }
}

/** Read a package from its files: its manifest, and everything held to the rules. */
export function readFiles(files: AppFiles): PackageRead {
  const problems: AppCheckItem[] = [];
  const say = (message: string, file?: string) =>
    problems.push({ message: message.slice(0, 500), ...(file && { file: file.slice(0, 200) }) });

  if (files.size > APP_LIMITS.files)
    say(`An app can hold at most ${APP_LIMITS.files} files, and this one has ${files.size}.`);
  let total = 0;
  for (const bytes of files.values()) total += bytes.length;
  if (total > APP_LIMITS.bytes)
    say(
      `An app can be at most ${APP_LIMITS.bytes / 1024 / 1024} MB, and this one is ${(total / 1024 / 1024).toFixed(1)} MB.`,
    );
  const seen = new Map<string, string>();
  for (const [path, bytes] of files) {
    const wrong = pathProblem(path);
    if (wrong) {
      say(wrong, path);
      continue;
    }
    // Two names one file on Windows and macOS: never both.
    const folded = path.toLowerCase();
    const other = seen.get(folded);
    if (other !== undefined) say(`${quote(path)} and ${quote(other)} differ only in case.`, path);
    seen.set(folded, path);
    // The one picture (ADR 0090) is read byte by byte; everything else is text.
    if (isAppPicture(path)) {
      const wrong = pictureProblem(path, bytes);
      if (wrong) say(wrong, path);
    } else if (!isText(bytes))
      say(
        `${quote(path)} isn’t text: apps carry only text files, and one picture as their icon (${PICTURE_NAMES}).`,
        path,
      );
  }
  const pictures = picturesIn(files);
  if (pictures.length > 1)
    say(
      `An app has one picture as its icon, and this one has ${pictures.join(' and ')}. Keep one.`,
      pictures[1],
    );

  const raw = files.get(MANIFEST_FILE);
  if (!raw) {
    say(`An app needs a ${MANIFEST_FILE} at the top of its folder.`);
    return { ok: false, problems };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    say(
      `${MANIFEST_FILE} isn’t valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      MANIFEST_FILE,
    );
    return { ok: false, problems };
  }
  const parsed = ConchAppManifest.safeParse(json);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 10)) say(manifestIssue(issue), MANIFEST_FILE);
    return { ok: false, problems };
  }
  const manifest = parsed.data;

  if (manifest.tools && !files.has(manifest.tools))
    say(
      `${MANIFEST_FILE} names ${quote(manifest.tools)} as its tools, but there’s no such file.`,
      MANIFEST_FILE,
    );
  const pageIds = new Set<string>();
  for (const page of manifest.pages) {
    if (!files.has(page.file))
      say(
        `The page ${quote(page.title)} is ${quote(page.file)}, but there’s no such file.`,
        MANIFEST_FILE,
      );
    if (pageIds.has(page.id)) say(`Two pages have the id ${quote(page.id)}.`, MANIFEST_FILE);
    pageIds.add(page.id);
  }
  const settingKeys = new Set<string>();
  for (const setting of manifest.settings) {
    if (settingKeys.has(setting.key))
      say(`Two settings have the key ${quote(setting.key)}.`, MANIFEST_FILE);
    settingKeys.add(setting.key);
  }

  // Skills: skills/<name>/SKILL.md, and whatever that skill carries beside it.
  const skills = new Set<string>();
  for (const path of files.keys()) {
    if (!path.startsWith('skills/')) continue;
    const [, name, ...rest] = path.split('/');
    if (!name || !rest.length) {
      say(`${quote(path)} should be in a skill’s own folder, like skills/<name>/SKILL.md.`, path);
      continue;
    }
    if (!SkillName.safeParse(name).success) {
      say(
        `${quote(name)} can’t be a skill’s name: use lowercase letters and numbers, with single dashes.`,
        path,
      );
      continue;
    }
    skills.add(name);
  }
  for (const name of skills)
    if (!files.has(`skills/${name}/SKILL.md`))
      say(`The skill ${quote(name)} has no SKILL.md.`, `skills/${name}`);

  if (problems.length) return { ok: false, problems };
  return { ok: true, app: { manifest, files, hash: appHash(files) } };
}

/**
 * Read a package from a folder on disk: regular files only, counted against
 * the limits while reading (a folder that's too big stops at the cap).
 */
export async function readFolder(dir: string): Promise<PackageRead> {
  const files = new Map<string, Buffer>();
  let total = 0;
  const fail = (message: string, file?: string): PackageRead => ({
    ok: false,
    problems: [{ message, ...(file && { file }) }],
  });
  const walk = async (
    folder: string,
    prefix: string,
    depth: number,
  ): Promise<PackageRead | undefined> => {
    if (depth > 8) return fail(`${quote(prefix)} is folders too deep for an app.`, prefix);
    const names = (await readdir(folder)).sort();
    for (const name of names) {
      // A Mac's folder notes: never part of an app, and never worth refusing one for.
      if (name === '.DS_Store') continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      let path: string;
      try {
        path = safeJoin(folder, name);
      } catch {
        return fail(`${quote(rel)} can’t be in an app.`, rel);
      }
      const info = await lstat(path);
      if (info.isSymbolicLink())
        return fail(`${quote(rel)} is a link, which Conch never follows in an app.`, rel);
      if (info.isDirectory()) {
        const read = await walk(path, rel, depth + 1);
        if (read) return read;
        continue;
      }
      if (!info.isFile()) return fail(`${quote(rel)} isn’t a plain file.`, rel);
      if (info.nlink > 1)
        return fail(
          `${quote(rel)} is linked to another file, which Conch never reads in an app.`,
          rel,
        );
      if (files.size + 1 > APP_LIMITS.files)
        return fail(`An app can hold at most ${APP_LIMITS.files} files, and this folder has more.`);
      if (total + info.size > APP_LIMITS.bytes)
        return fail(
          `An app can be at most ${APP_LIMITS.bytes / 1024 / 1024} MB, and this folder is bigger.`,
        );
      const handle = await open(path, 'r');
      try {
        const now = await handle.stat();
        // Swapped between looking and opening: not the file that was checked.
        if (!now.isFile() || now.ino !== info.ino || now.dev !== info.dev || now.nlink > 1)
          return fail(`${quote(rel)} changed while Conch was reading it. Try again.`, rel);
        const bytes = Buffer.alloc(Math.min(now.size, APP_LIMITS.bytes - total + 1));
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (bytesRead > APP_LIMITS.bytes - total)
          return fail(
            `An app can be at most ${APP_LIMITS.bytes / 1024 / 1024} MB, and this folder is bigger.`,
          );
        total += bytesRead;
        files.set(rel, bytes.subarray(0, bytesRead));
      } finally {
        await handle.close();
      }
    }
    return undefined;
  };
  try {
    const failed = await walk(dir, '', 0);
    if (failed) return failed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return fail(
      code === 'ENOENT'
        ? 'The app’s folder isn’t there any more.'
        : `Conch couldn’t read the app’s folder${code ? ` (${code})` : ''}.`,
    );
  }
  return readFiles(files);
}

/** The `.conchapp` for an app: a tar.gz with its files at the top. Always the same bytes for the same files. */
export async function packApp(app: AppPackage): Promise<Buffer> {
  const writer = new TarWriter();
  const chunks: Buffer[] = [];
  writer.gzip.on('data', (chunk: Buffer) => chunks.push(chunk));
  const ended = new Promise<void>((resolve, reject) => {
    writer.gzip.on('end', resolve);
    writer.gzip.on('error', reject);
  });
  for (const path of [...app.files.keys()].sort())
    await writer.add(path, app.files.get(path) as Buffer, 0);
  await writer.end();
  await ended;
  return Buffer.concat(chunks);
}

/** What `readTar` may unpack from a download: a little more than an app, never a backup's worth. */
const ARCHIVE_LIMITS = {
  maxUnpackedBytes: 64 * 1024 * 1024,
  maxFileBytes: 64 * 1024 * 1024,
  maxFiles: 10_000,
};

function unsafeArchive(error: unknown): PackageError {
  if (error instanceof PackageError) return error;
  if (error instanceof BackupError) {
    if (error.code === 'unsafe')
      return new PackageError(
        'This package holds a link or something other than files, which Conch never opens.',
      );
    if (error.code === 'too-big')
      return new PackageError('This package is bigger than Conch reads.');
  }
  return new PackageError('That isn’t a Conch app package, or it’s damaged.');
}

/**
 * Every app in a `.conchapp` or a GitHub tarball: a `conch-app.json` at the
 * top or up to three folders down (a collection), each read as an app rooted
 * at its folder. `path` looks only there. Anything hostile in the archive —
 * a path out of it, a link, a device, a name twice, a bomb — refuses the lot.
 */
export async function findApps(
  archive: Buffer,
  options: { path?: string } = {},
): Promise<{ path: string; read: PackageRead }[]> {
  if (archive.length > APP_LIMITS.download)
    throw new PackageError(
      `This package is bigger than ${APP_LIMITS.download / 1024 / 1024} MB, which is more than Conch reads.`,
    );
  const entries = new Map<string, Buffer>();
  const folded = new Set<string>();
  /** Files passed over for being bigger than a whole app may be. */
  const tooBig = new Set<string>();
  const gunzip = createGunzip();
  const source = Readable.from([archive]).pipe(gunzip);
  try {
    await readTar(
      source,
      ({ name, size }) => {
        if (name.includes('�'))
          throw new PackageError('This package has a file whose name isn’t readable text.');
        if (!validRelPath(name))
          throw new PackageError(`This package has a file Conch won’t open: ${quote(name)}.`);
        const key = name.toLowerCase();
        if (folded.has(key)) throw new PackageError(`This package has ${quote(name)} twice.`);
        folded.add(key);
        // Hidden files (.git, .github, .env) are never read; nothing too big for an app is kept.
        if (name.split('/').some((part) => part.startsWith('.'))) return 'skip';
        if (size > APP_LIMITS.bytes) {
          tooBig.add(name);
          return 'skip';
        }
        const chunks: Buffer[] = [];
        return {
          write: (chunk) => void chunks.push(Buffer.from(chunk)),
          end: () => void entries.set(name, Buffer.concat(chunks)),
        };
      },
      ARCHIVE_LIMITS,
      { skipFolders: true, skipGlobalHeaders: true },
    );
  } catch (error) {
    throw unsafeArchive(error);
  } finally {
    source.destroy();
    gunzip.destroy();
  }

  // GitHub's tarball has one top folder (owner-repo-sha/): the repository is inside it.
  const all = [...entries.keys(), ...tooBig];
  const tops = new Set(all.map((n) => (n.includes('/') ? n.split('/')[0] : '')));
  let files = entries;
  let big = [...tooBig];
  if (tops.size === 1 && !tops.has('') && !entries.has(MANIFEST_FILE)) {
    const top = `${[...tops][0]}/`;
    files = new Map([...entries].map(([n, b]) => [n.slice(top.length), b]));
    big = big.map((n) => n.slice(top.length));
  }

  let within = '';
  if (options.path !== undefined) {
    within = options.path.replace(/^\/+|\/+$/g, '');
    if (within && !validRelPath(within))
      throw new PackageError(`${quote(options.path)} isn’t a folder Conch can look in.`);
  }
  const roots = [...files.keys()]
    .filter((n) => n === MANIFEST_FILE || n.endsWith(`/${MANIFEST_FILE}`))
    .map((n) => n.slice(0, -MANIFEST_FILE.length).replace(/\/$/, ''))
    .filter((root) => {
      if (within && root !== within && !root.startsWith(`${within}/`)) return false;
      const below = within ? root.slice(within.length).replace(/^\//, '') : root;
      return (below ? below.split('/').length : 0) <= 3;
    })
    .sort();

  return roots.map((root) => {
    const prefix = root ? `${root}/` : '';
    // Another app's folder inside this one belongs to that app.
    const nested = roots.filter((r) => r !== root && (root === '' || r.startsWith(prefix)));
    const mine = (name: string) =>
      name.startsWith(prefix) && !nested.some((r) => name.startsWith(`${r}/`));
    const own = new Map<string, Buffer>();
    for (const [name, bytes] of files) if (mine(name)) own.set(name.slice(prefix.length), bytes);
    const huge = big.filter(mine).map((name) => name.slice(prefix.length));
    if (huge.length)
      return {
        path: root,
        read: {
          ok: false as const,
          problems: huge.slice(0, 5).map((file) => ({
            message: `${quote(file)} is bigger than a whole app may be (${APP_LIMITS.bytes / 1024 / 1024} MB).`,
            file,
          })),
        },
      };
    return { path: root, read: readFiles(own) };
  });
}
