/**
 * Walking through this computer's folders from any device (`/api/pick/…`).
 *
 * A browser can't hand a page a real path, and a phone can't see an Open
 * dialog on the computer across the room, so the gateway reads folders for
 * the person to choose from. What it gives away is kept small on purpose:
 *
 * - **Names only.** A folder's name, whether it's a shortcut, whether it's
 *   hidden. Never a file's contents, sizes or dates; files only when the
 *   purpose is choosing one, and then only the kinds it asks for.
 * - **Never Conch's own, never where keys are kept.** Conch's folder (but for
 *   the workspace inside it), the places `protectedPaths` and `secretPlaces`
 *   name: neither listed, nor shown in another folder's listing. A shortcut
 *   is followed before that's decided, so a link can't lead around it.
 * - **Bounded.** A listing reads at most `SCAN_LIMIT` entries and returns at
 *   most `LIST_LIMIT` folders, so a folder of a million files costs the same
 *   as a small one.
 * - **One write.** Making a new, empty folder where you're looking, by a
 *   name that can't step out of it.
 */
import type { Dirent } from 'node:fs';
import { access, constants, mkdir, opendir, readdir, realpath, stat } from 'node:fs/promises';
import { homedir, platform as osPlatform, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';

import type {
  FolderCrumb,
  FolderEntry,
  FolderGuess,
  FolderListing,
  FolderPlace,
  FolderPlaces,
} from '@conch/protocol';

/** Entries read from one folder at most, whatever is in it. */
export const SCAN_LIMIT = 5_000;
/** Folders in one listing at most (the first, by name). */
export const LIST_LIMIT = 500;
/** Names suggested while a path is typed. */
const GUESS_LIMIT = 12;

export interface FolderRules {
  home: string;
  /** `CONCH_HOME`: never listed, but for the workspace inside it. */
  conchHome: string;
  /** Conch's own workspace (inside `CONCH_HOME`), which is the person's to use. */
  workspace: string;
  /** Places never listed: where passwords, keys and sign-ins are kept. */
  denied: readonly string[];
  platform?: NodeJS.Platform;
}

export type FolderProblem = 'missing' | 'not-folder' | 'denied' | 'unreadable' | 'exists' | 'name';

export class FolderError extends Error {
  constructor(
    readonly code: FolderProblem,
    message: string,
  ) {
    super(message);
  }
}

/** What to say when the computer itself says no (macOS asks about Desktop, Documents…). */
function unreadable(platform: NodeJS.Platform): FolderError {
  return new FolderError(
    'unreadable',
    platform === 'darwin'
      ? 'macOS hasn’t let Conch look in there. Allow it in System Settings → Privacy & Security → Files & Folders.'
      : 'This computer doesn’t let Conch look in there.',
  );
}

const DENIED = 'Conch keeps this folder to itself: sign-ins and keys live there.';

const windows = (rules: FolderRules) => (rules.platform ?? osPlatform()) === 'win32';

/** Compare paths the way this computer does (Windows ignores case). */
function key(path: string, rules: FolderRules): string {
  const clean = path.length > 1 ? path.replace(/[\\/]+$/, '') || path : path;
  return windows(rules) ? clean.toLowerCase() : clean;
}

function under(path: string, place: string, rules: FolderRules): boolean {
  const a = key(path, rules);
  const b = key(place, rules);
  return a === b || a.startsWith(b.endsWith(sep) ? b : `${b}${sep}`);
}

/** Whether a folder (already resolved) is one Conch never shows. */
export function isDenied(path: string, rules: FolderRules): boolean {
  if (rules.denied.some((place) => under(path, place, rules))) return true;
  // Conch's own folder, but for its workspace (and the way down to it).
  return under(path, rules.conchHome, rules) && !under(path, rules.workspace, rules);
}

/**
 * A path as a page sent it, as a full path on this computer: `~` is the home
 * folder, and a bare name is in it. Never relative to wherever Conch started.
 */
export function expand(asked: string, rules: FolderRules): string {
  const text = asked.trim();
  if (text === '~') return rules.home;
  if (text.startsWith('~/') || text.startsWith('~\\')) return resolve(rules.home, text.slice(2));
  if (isAbsolute(text)) return resolve(text);
  return resolve(rules.home, text);
}

/** The way people read a path: `~/Projects`. */
export function shown(path: string, rules: FolderRules): string {
  if (under(path, rules.home, rules)) {
    const rest = path.slice(rules.home.length).replace(/^[\\/]+/, '');
    return rest ? `~${sep}${rest}` : '~';
  }
  return path;
}

/** The steps from the home folder (or the top of the disk) down to `path`. */
export function crumbsOf(path: string, rules: FolderRules): FolderCrumb[] {
  const crumbs: FolderCrumb[] = [];
  const atHome = under(path, rules.home, rules);
  const start = atHome ? rules.home : parse(path).root;
  crumbs.push({
    name: atHome ? 'Home' : windows(rules) ? start.replace(/[\\/]+$/, '') : 'Computer',
    path: start,
    top: atHome ? 'home' : 'disk',
  });
  const rest = path
    .slice(start.length)
    .split(/[\\/]+/)
    .filter(Boolean);
  let at = start;
  for (const name of rest) {
    at = join(at, name);
    crumbs.push({ name, path: at });
  }
  return crumbs;
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** A folder, as the person asked for it and as it really is (shortcuts followed). */
async function open(asked: string, rules: FolderRules): Promise<{ path: string; real: string }> {
  const path = expand(asked, rules);
  const platform = rules.platform ?? osPlatform();
  if (isDenied(path, rules)) throw new FolderError('denied', DENIED);
  let real: string;
  try {
    real = await realpath(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') throw unreadable(platform);
    throw new FolderError('missing', 'There’s no folder there.');
  }
  if (isDenied(real, rules)) throw new FolderError('denied', DENIED);
  const info = await stat(real).catch(() => undefined);
  if (!info) throw new FolderError('missing', 'There’s no folder there.');
  if (!info.isDirectory()) throw new FolderError('not-folder', 'That’s a file, not a folder.');
  return { path, real };
}

interface Read {
  folders: FolderEntry[];
  files: FolderEntry[];
  hidden: number;
  more: boolean;
}

/** What's in a folder, by name: bounded however much is in it. */
async function read(
  dir: { path: string; real: string },
  rules: FolderRules,
  options: { hidden?: boolean; files?: readonly string[] | 'all'; prefix?: string },
): Promise<Read> {
  const platform = rules.platform ?? osPlatform();
  const folders: FolderEntry[] = [];
  const files: FolderEntry[] = [];
  let hidden = 0;
  let scanned = 0;
  let more = false;
  const prefix = options.prefix?.toLowerCase();
  const exts =
    options.files === 'all' || !options.files
      ? undefined
      : options.files.map((e) => `.${e.toLowerCase()}`);

  let handle;
  try {
    handle = await opendir(dir.real, { bufferSize: 128 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') throw unreadable(platform);
    throw new FolderError('missing', 'There’s no folder there.');
  }
  try {
    for await (const entry of handle as AsyncIterable<Dirent>) {
      if (++scanned > SCAN_LIMIT) {
        more = true;
        break;
      }
      const name = entry.name;
      if (prefix !== undefined && !name.toLowerCase().startsWith(prefix)) continue;
      const path = join(dir.path, name);
      if (isDenied(path, rules) || isDenied(join(dir.real, name), rules)) continue;
      let folder = entry.isDirectory();
      let file = entry.isFile();
      let link = false;
      if (entry.isSymbolicLink()) {
        // A shortcut: where it really goes decides, so it can't lead somewhere kept private.
        const target = await realpath(join(dir.real, name)).catch(() => undefined);
        if (!target || isDenied(target, rules)) continue;
        const info = await stat(target).catch(() => undefined);
        if (!info) continue;
        folder = info.isDirectory();
        file = info.isFile();
        link = true;
      }
      const dot = name.startsWith('.');
      if (folder) {
        if (dot && !options.hidden) {
          hidden++;
          continue;
        }
        folders.push({ name, path, ...(link && { link }), ...(dot && { hidden: true }) });
      } else if (file && options.files) {
        if (dot && !options.hidden) continue;
        if (exts && !exts.some((ext) => name.toLowerCase().endsWith(ext))) continue;
        files.push({ name, path, ...(link && { link }), ...(dot && { hidden: true }) });
      }
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  folders.sort((a, b) => byName.compare(a.name, b.name));
  files.sort((a, b) => byName.compare(a.name, b.name));
  if (folders.length > LIST_LIMIT) more = true;
  return {
    folders: folders.slice(0, LIST_LIMIT),
    files: files.slice(0, LIST_LIMIT),
    hidden,
    more,
  };
}

/** The folders in a folder (and the files that can be chosen, when it's a file). */
export async function listFolder(
  asked: string,
  rules: FolderRules,
  options: { hidden?: boolean; files?: readonly string[] | 'all' } = {},
): Promise<FolderListing> {
  const dir = await open(asked, rules);
  const found = await read(dir, rules, options);
  const parent = dirname(dir.path);
  const writable = await access(dir.real, constants.W_OK).then(
    () => true,
    () => false,
  );
  return {
    path: dir.path,
    name: crumbsOf(dir.path, rules).at(-1)?.name ?? basename(dir.path),
    shown: shown(dir.path, rules),
    ...(parent !== dir.path && { parent }),
    crumbs: crumbsOf(dir.path, rules),
    folders: found.folders,
    ...(options.files && { files: found.files }),
    hiddenCount: found.hidden,
    more: found.more,
    writable,
  };
}

/**
 * A path being typed, read: what's there now, and the folders whose names go
 * on from it (`~/Pro` → `Projects`, `~/Projects/` → what's in it).
 */
export async function guessFolder(asked: string, rules: FolderRules): Promise<FolderGuess> {
  const path = expand(asked, rules);
  const typedDir = /[\\/]$/.test(asked.trim()) || asked.trim() === '~';
  let state: FolderGuess['state'] = 'missing';
  let message: string | undefined;
  try {
    await open(path, rules);
    state = 'folder';
  } catch (error) {
    if (error instanceof FolderError) {
      state =
        error.code === 'not-folder'
          ? 'file'
          : error.code === 'denied' || error.code === 'unreadable'
            ? 'denied'
            : 'missing';
      message = error.message;
    } else throw error;
  }
  const parent = typedDir ? path : dirname(path);
  const prefix = typedDir ? '' : basename(path);
  let matches: FolderEntry[] = [];
  try {
    const dir = await open(parent, rules);
    const found = await read(dir, rules, { prefix, hidden: prefix.startsWith('.') });
    matches = found.folders.slice(0, GUESS_LIMIT);
  } catch {
    // Nowhere to go on from: no suggestions, and the state says why.
  }
  return { path, state, ...(message && { message }), matches };
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** A new, empty folder called `name` in `parent`. Resolves its path. */
export async function makeFolder(
  parentAsked: string,
  nameAsked: string,
  rules: FolderRules,
): Promise<string> {
  const name = nameAsked.trim();
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    /[\\/\0]/.test(name) ||
    (windows(rules) &&
      (/[<>:"|?*]/.test(name) || WINDOWS_RESERVED.test(name) || /[. ]$/.test(name)))
  )
    throw new FolderError('name', 'A folder’s name can’t have / or \\ in it.');
  if (name.length > 255) throw new FolderError('name', 'That name is too long for a folder.');
  const parent = await open(parentAsked, rules);
  const path = join(parent.path, name);
  if (isDenied(path, rules) || isDenied(join(parent.real, name), rules))
    throw new FolderError('denied', DENIED);
  try {
    await mkdir(join(parent.real, name));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST')
      throw new FolderError('exists', `There’s already something called “${name}” here.`);
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS')
      throw new FolderError('unreadable', 'This folder can’t have new folders made in it.');
    throw error;
  }
  return path;
}

async function isFolder(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );
}

/** At most `ms` for `promise`, so a sleeping network drive can't hold the list up. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((done) => setTimeout(() => done(fallback), ms).unref?.()),
  ]);
}

/** The folders people keep their projects in, by the names they use. */
const PROJECT_NAMES = [
  'Projects',
  'projects',
  'Developer',
  'Code',
  'code',
  'dev',
  'src',
  'repos',
  'git',
  'GitHub',
  'workspace',
];

/** The places to start from, each only if it's there. */
export async function folderPlaces(rules: FolderRules): Promise<FolderPlaces> {
  const platform = rules.platform ?? osPlatform();
  const { home } = rules;
  const places: FolderPlace[] = [];
  const add = async (kind: FolderPlace['kind'], title: string, path: string) => {
    if (places.some((p) => key(p.path, rules) === key(path, rules))) return;
    if (isDenied(path, rules) && kind !== 'workspace') return;
    if (await within(isFolder(path), 800, false))
      places.push({ kind, title, path, shown: shown(path, rules) });
  };

  await add('home', 'Home', home);
  await add('desktop', 'Desktop', join(home, 'Desktop'));
  await add('documents', 'Documents', join(home, 'Documents'));
  await add('downloads', 'Downloads', join(home, 'Downloads'));
  let projects = 0;
  for (const name of PROJECT_NAMES) {
    if (projects >= 3) break;
    const before = places.length;
    await add('projects', name, join(home, name));
    if (places.length > before) projects++;
  }

  // Cloud folders, as this computer's own app put them there.
  if (platform === 'darwin') {
    await add(
      'cloud',
      'iCloud Drive',
      join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'),
    );
    const cloud = join(home, 'Library', 'CloudStorage');
    const names = await within(
      readdir(cloud).catch(() => [] as string[]),
      800,
      [] as string[],
    );
    for (const name of names.slice(0, 6))
      await add(
        'cloud',
        name.replace(/-.*$/, '').replace(/([a-z])([A-Z])/g, '$1 $2'),
        join(cloud, name),
      );
  }
  for (const name of ['Dropbox', 'OneDrive', 'Google Drive', 'iCloudDrive'])
    await add('cloud', name === 'iCloudDrive' ? 'iCloud Drive' : name, join(home, name));

  await add('workspace', 'Conch’s workspace', rules.workspace);

  // Disks: what's plugged in, and on Windows each drive.
  if (platform === 'darwin') {
    const volumes = await within(
      readdir('/Volumes').catch(() => [] as string[]),
      800,
      [],
    );
    for (const name of volumes.slice(0, 8)) {
      const path = join('/Volumes', name);
      // The startup disk appears here as a shortcut to `/`.
      const real = await within(
        realpath(path).catch(() => path),
        800,
        path,
      );
      await add('drive', name, real === '/' ? '/' : path);
    }
  } else if (platform === 'win32') {
    for (const letter of 'CDEFGHIJ') await add('drive', `${letter}:`, `${letter}:\\`);
  } else {
    await add('drive', 'Computer', '/');
    const user = (() => {
      try {
        return userInfo().username;
      } catch {
        return '';
      }
    })();
    for (const base of [join('/media', user), join('/run/media', user), '/mnt']) {
      const names = await within(
        readdir(base).catch(() => [] as string[]),
        800,
        [],
      );
      for (const name of names.slice(0, 6)) await add('drive', name, join(base, name));
    }
  }
  return { home, separator: platform === 'win32' ? '\\' : '/', places };
}

/** The rules for this gateway. */
export function folderRules(input: {
  conchHome: string;
  workspace: string;
  denied: readonly string[];
}): FolderRules {
  return { home: homedir(), ...input };
}
