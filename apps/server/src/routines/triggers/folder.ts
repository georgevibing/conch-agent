/**
 * When something in a folder changes (ADR 0056). The system's own file
 * events, settled for a moment; never where keys live or Conch's own folder;
 * Conch's own writes don't count. Only the names of what changed reach the
 * run: it reads the files with its own guarded tools.
 */
import { createHash } from 'node:crypto';
import { watch as fsWatch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

import { SourceError, TriggerError, type Happening, type TriggerSource } from './types';

/** Quiet for this long and the changes so far go as one. */
export const SETTLE_MS = 10_000;
/** A folder that never settles still reports this often. */
const MOST_MS = 60_000;
/** A folder that went away is looked for again this often. */
export const RETRY_MS = 5 * 60_000;
const MAX_NAMES = 50;

/** Editors' and browsers' scratch files: never a change worth a run. */
const SCRATCH =
  /(?:^|[\\/])(?:~\$[^\\/]*|\.~lock\.[^\\/]*|[^\\/]*\.(?:tmp|temp|swp|swx|part|crdownload|download|partial)|[^\\/]*~|Thumbs\.db|desktop\.ini|\.DS_Store)$/i;
/** Hidden files and folders, and folders tools fill by themselves. */
const QUIET_PARTS = new Set(['node_modules', '__pycache__', '$recycle.bin']);

export interface FolderDeps {
  /** Places that hold keys or are Conch's own: never watched, never reported. */
  forbidden: () => readonly string[];
  /** Conch's own folder. */
  home: string;
  /** A file an assistant tool just wrote (Conch's own write). */
  ownWrite: (path: string) => boolean;
  /** This routine's own run is going (or just ended): its writes aren't news. */
  running: (routineId: string) => boolean;
  watch?: (path: string, listener: (filename: string | null) => void) => FSWatcher;
  timers?: {
    set: (fn: () => void, ms: number) => NodeJS.Timeout;
    clear: (t: NodeJS.Timeout | undefined) => void;
  };
}

const inside = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const same = (a: string, b: string) =>
  process.platform === 'win32' || process.platform === 'darwin'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
const insideAny = (parent: string, child: string) =>
  inside(parent, child) ||
  ((process.platform === 'win32' || process.platform === 'darwin') &&
    inside(parent.toLowerCase(), child.toLowerCase()));

export function describeFolder(path: string): string {
  return `When something changes in ${basename(path) || path}`;
}

/** Why this folder can't be watched, in words; undefined when it can. */
export function folderProblem(path: string, deps: Pick<FolderDeps, 'forbidden' | 'home'>) {
  if (!isAbsolute(path)) return 'Choose the folder with the Open dialog.';
  const full = resolve(path);
  if (parse(full).root === full) return 'That’s a whole drive. Choose a folder inside it.';
  if (same(full, resolve(homedir())))
    return 'That’s your whole home folder. Choose a folder inside it, like Downloads.';
  const home = resolve(deps.home);
  if (insideAny(home, full) || insideAny(full, home))
    return 'That’s where Conch keeps its own things. Choose another folder.';
  for (const place of deps.forbidden().map((p) => resolve(p))) {
    if (insideAny(place, full))
      return 'That’s where keys and sign-ins are kept. Conch won’t watch it.';
    if (insideAny(full, place))
      return 'That folder holds where keys and sign-ins are kept. Choose a folder inside it.';
  }
  return undefined;
}

export function folderSource(deps: FolderDeps): TriggerSource<'folder'> {
  const timers = deps.timers ?? {
    set: (fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      t.unref?.();
      return t;
    },
    clear: (t: NodeJS.Timeout | undefined) => clearTimeout(t),
  };
  const watchFn =
    deps.watch ??
    ((path: string, listener: (filename: string | null) => void) =>
      fsWatch(path, { recursive: true, persistent: false }, (_event, filename) =>
        listener(filename ? String(filename) : null),
      ));

  return {
    kind: 'folder',
    async validate(trigger) {
      const problem = folderProblem(trigger.path, deps);
      if (problem) throw new TriggerError(problem);
      const full = resolve(trigger.path);
      const found = await stat(full).catch(() => undefined);
      if (!found) throw new TriggerError('That folder isn’t there. Choose it again.');
      if (!found.isDirectory()) throw new TriggerError('That’s a file. Choose the folder it’s in.');
      return { ...trigger, path: full };
    },
    describe: (t) => describeFolder(t.path),
    note: () =>
      'Conch notices changes while it’s running, waits until they settle, and ignores its own.',
    taint: (t) => ({ kind: 'app', label: `files in ${basename(t.path) || t.path}` }),
    watch(ctx, arrive, problem) {
      const root = resolve(ctx.trigger.path);
      const forbidden = deps.forbidden().map((p) => resolve(p));
      let watcher: FSWatcher | undefined;
      let settle: NodeJS.Timeout | undefined;
      let retry: NodeJS.Timeout | undefined;
      let first: number | undefined;
      let stopped = false;
      const changed = new Set<string>();
      /** One timer for looking again, whatever it's for. */
      const later = (fn: () => Promise<void>, ms: number) => {
        timers.clear(retry);
        retry = timers.set(() => void fn(), ms);
      };

      const flush = async () => {
        settle = undefined;
        first = undefined;
        const names = [...changed].sort();
        changed.clear();
        if (!names.length || stopped) return;
        const lines: string[] = [];
        for (const name of names.slice(0, MAX_NAMES)) {
          const there = await stat(join(root, name)).catch(() => undefined);
          lines.push(`${there ? 'changed or added' : 'removed'}: ${name}`);
        }
        if (names.length > MAX_NAMES) lines.push(`…and ${names.length - MAX_NAMES} more`);
        const at = Date.now();
        const happening: Happening = {
          id: `folder:${createHash('sha256')
            .update(`${at}\n${names.join('\n')}`)
            .digest('base64url')
            .slice(0, 22)}`,
          at,
          label:
            names.length === 1
              ? `${basename(names[0] ?? '')} in ${basename(root)}`
              : `${names.length} changes in ${basename(root)}`,
          detail: [`Folder: ${root}`, '', ...lines].join('\n'),
        };
        arrive([happening]);
      };

      const noticed = (filename: string | null) => {
        if (stopped || !filename) return;
        const full = resolve(root, filename);
        if (!inside(root, full)) return;
        const rel = relative(root, full);
        const parts = rel.split(sep);
        if (parts.some((p) => p.startsWith('.') || QUIET_PARTS.has(p.toLowerCase()))) return;
        if (SCRATCH.test(rel)) return;
        if (forbidden.some((place) => insideAny(place, full))) return;
        if (deps.running(ctx.routineId) || deps.ownWrite(full)) return;
        changed.add(rel);
        first ??= Date.now();
        timers.clear(settle);
        const wait = Math.max(0, Math.min(SETTLE_MS, first + MOST_MS - Date.now()));
        settle = timers.set(() => void flush(), wait);
      };

      const start = async () => {
        retry = undefined;
        if (stopped) return;
        const found = await stat(root).catch(() => undefined);
        if (!found?.isDirectory()) {
          problem(
            new SourceError(
              'needs-you',
              `The folder “${basename(root)}” isn’t there any more. Conch watches it again when it’s back.`,
            ),
          );
          later(start, RETRY_MS);
          return;
        }
        try {
          watcher = watchFn(root, noticed);
          watcher.on('error', () => {
            watcher?.close();
            watcher = undefined;
            if (!stopped) later(start, 1_000);
          });
          problem(undefined);
          // Some systems stop telling without an error when a folder is moved away.
          later(check, RETRY_MS);
        } catch {
          problem(
            new SourceError('retry', `Conch couldn’t watch “${basename(root)}”. It tries again.`),
          );
          later(start, RETRY_MS);
        }
      };

      const check = async () => {
        retry = undefined;
        if (stopped) return;
        const found = await stat(root).catch(() => undefined);
        if (found?.isDirectory()) {
          later(check, RETRY_MS);
          return;
        }
        watcher?.close();
        watcher = undefined;
        void start();
      };

      void start();
      return {
        stop() {
          stopped = true;
          watcher?.close();
          timers.clear(settle);
          timers.clear(retry);
        },
      };
    },
  };
}
