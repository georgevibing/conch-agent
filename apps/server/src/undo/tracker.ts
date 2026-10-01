/**
 * Noticing what a turn changed (ADR 0030), for every provider.
 *
 * - **File tools** (Write, Edit, MultiEdit, NotebookEdit): the file is kept
 *   just before the tool runs, and compared just after — inside the work
 *   folder or out of it.
 * - **Commands, and anything else**: the work folder is looked at before
 *   and after, by size and time first (cheap), reading only what changed.
 *   Files a command changed are put down to that command; what changed in a
 *   turn some other way (a provider without tool events) to the turn.
 *
 * Never kept: where keys and passwords live, links, files over 5 MB, and
 * folders that are rebuilt anyway (`node_modules`, `.git`, build output).
 * A work folder too big to keep a copy of (or the whole home folder) still
 * has its file-tool edits undoable, and says so.
 */
import type { Dirent } from 'node:fs';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { newId } from '../lib/ids';
import type { ChangeSet, FileChange, IndexEntry, UndoStore } from './store';

export const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
/** Tools that only look: nothing to compare after them. */
const LOOKING = new Set([
  'Read',
  'Glob',
  'Grep',
  'LS',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
  'BashOutput',
]);
export const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  'target',
  '.gradle',
  '.idea',
  'coverage',
]);
export const MAX_FILE = 5 * 1024 * 1024;
export const MAX_FILES = 10_000;
export const MAX_FOLDER = 200 * 1024 * 1024;

export interface TrackerDeps {
  store: UndoStore;
  conversationId: string;
  workspace: string;
  /** Places never kept or put back (Passwords, Conch's keys, SSH keys…). */
  forbidden: (path: string) => boolean;
  /** "Changed notes.md", "Ran `npm test`". */
  label: (toolName: string, input: Record<string, unknown>) => string;
  /** A change set was saved: the chat says so. */
  onChange: (set: ChangeSet, toolUseId?: string) => void;
}

/** As a person reads it: relative to the work folder, else with `~`. */
export function shownPath(path: string, workspace: string): string {
  const rel = relative(workspace, path);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/');
  const home = homedir();
  return path.startsWith(`${home}${sep}`)
    ? `~/${path
        .slice(home.length + 1)
        .split(sep)
        .join('/')}`
    : path;
}

const toolPath = (toolName: string, input: Record<string, unknown>, workspace: string) => {
  const raw = input.file_path ?? input.notebook_path ?? input.path;
  if (!FILE_TOOLS.has(toolName) || typeof raw !== 'string' || !raw) return undefined;
  return resolve(workspace, raw);
};

type Snapshot = Map<string, IndexEntry>;

export class TurnTracker {
  /** The work folder as it was last looked at; undefined when it can't be kept (`reason`). */
  #folder?: Snapshot;
  #reason?: string;
  readonly #pending = new Map<
    string,
    {
      name: string;
      input: Record<string, unknown>;
      file?: { path: string; parent: string; before?: IndexEntry };
    }
  >();
  #ready?: Promise<void>;

  constructor(private readonly deps: TrackerDeps) {}

  /** Why the work folder's other changes can't be undone, when they can't. */
  get unavailable(): string | undefined {
    return this.#reason;
  }

  /** Before the turn: the work folder as it is now. */
  begin(): Promise<void> {
    this.#ready ??= this.#scan().then(
      (snapshot) => {
        this.#folder = snapshot;
      },
      () => {
        this.#folder = undefined;
      },
    );
    return this.#ready;
  }

  /** Just before a tool runs. Idempotent: the earliest look wins. */
  async before(toolUseId: string, toolName: string, input: Record<string, unknown>): Promise<void> {
    if (
      this.#pending.has(toolUseId) ||
      LOOKING.has(toolName) ||
      toolName.startsWith('mcp__conch__')
    )
      return;
    await this.begin();
    const path = toolPath(toolName, input, this.deps.workspace);
    if (path) {
      if (this.deps.forbidden(path)) return;
      const parent = await realpath(dirname(path)).catch(() => dirname(path));
      this.#pending.set(toolUseId, {
        name: toolName,
        input,
        file: { path, parent, before: await this.#keep(path) },
      });
      return;
    }
    // Anything else could change the work folder: look again first, so only its own changes count.
    if (this.#folder) this.#folder = await this.#scan(this.#folder);
    this.#pending.set(toolUseId, { name: toolName, input });
  }

  /** Just after it: what it changed, saved as one change set. */
  async after(toolUseId: string): Promise<ChangeSet | undefined> {
    const call = this.#pending.get(toolUseId);
    if (!call) return undefined;
    this.#pending.delete(toolUseId);
    let files: FileChange[] = [];
    if (call.file) {
      const now = await this.#keep(call.file.path);
      if (now?.hash !== call.file.before?.hash)
        files = [
          {
            path: call.file.path,
            shown: shownPath(call.file.path, this.deps.workspace),
            parent: call.file.parent,
            ...(call.file.before && {
              before: { hash: call.file.before.hash, mode: call.file.before.mode },
            }),
            ...(now && { after: { hash: now.hash, mode: now.mode } }),
          },
        ];
      // The folder's own picture moves on with it, so the turn doesn't count it twice.
      const rel = relative(this.deps.workspace, call.file.path);
      if (this.#folder && !rel.startsWith('..') && !isAbsolute(rel)) {
        if (now) this.#folder.set(rel, now);
        else this.#folder.delete(rel);
      }
    } else if (this.#folder) {
      files = await this.#compare();
    }
    return this.#save(files, this.deps.label(call.name, call.input), toolUseId);
  }

  /** After the turn: whatever else changed in the work folder. */
  async end(): Promise<ChangeSet | undefined> {
    for (const id of [...this.#pending.keys()]) await this.after(id);
    if (!this.#folder) return undefined;
    return this.#save(await this.#compare(), 'Changed during this turn');
  }

  async #save(files: FileChange[], label: string, toolUseId?: string) {
    if (!files.length) return undefined;
    const set: ChangeSet = {
      id: newId('cs'),
      conversationId: this.deps.conversationId,
      ...(toolUseId && { toolUseId }),
      label,
      at: Date.now(),
      state: 'applied',
      files,
    };
    await this.deps.store.saveSet(set);
    this.deps.onChange(set, toolUseId);
    return set;
  }

  /** The work folder now against how it was: what was created, changed or deleted. */
  async #compare(): Promise<FileChange[]> {
    const before = this.#folder;
    if (!before) return [];
    const now = await this.#scan(before);
    if (!now) return [];
    const files: FileChange[] = [];
    const workspace = this.deps.workspace;
    const paths = new Set([...before.keys(), ...now.keys()]);
    for (const rel of [...paths].sort()) {
      const a = before.get(rel);
      const b = now.get(rel);
      if (a?.hash === b?.hash) continue;
      const path = join(workspace, rel);
      files.push({
        path,
        shown: shownPath(path, workspace),
        parent: await realpath(dirname(path)).catch(() => dirname(path)),
        ...(a && { before: { hash: a.hash, mode: a.mode } }),
        ...(b && { after: { hash: b.hash, mode: b.mode } }),
      });
    }
    this.#folder = now;
    return files;
  }

  /** One file, kept: its entry, or undefined when it isn't there (or can't be kept). */
  async #keep(path: string): Promise<IndexEntry | undefined> {
    const info = await lstat(path).catch(() => undefined);
    if (!info?.isFile() || info.size > MAX_FILE) return undefined;
    const bytes = await readFile(path).catch(() => undefined);
    if (!bytes) return undefined;
    const hash = await this.deps.store.put(bytes);
    return { size: info.size, mtimeMs: info.mtimeMs, mode: info.mode & 0o777, hash };
  }

  /**
   * Look at the work folder: every file's size and time, read only when
   * they moved since `previous` (or the last turn's look, kept on disk).
   */
  async #scan(previous?: Snapshot): Promise<Snapshot | undefined> {
    const workspace = this.deps.workspace;
    const home = homedir();
    if (resolve(workspace) === home || home.startsWith(`${resolve(workspace)}${sep}`)) {
      this.#reason =
        'Your work folder is your whole home folder, so Conch can’t keep a copy of it. Edits by the assistant’s file tools can still be undone.';
      return undefined;
    }
    const known = previous ?? new Map(Object.entries(await this.deps.store.index(workspace)));
    const out: Snapshot = new Map();
    let total = 0;
    const visit = async (dir: string): Promise<boolean> => {
      let entries: Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return true;
      }
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isSymbolicLink() || this.deps.forbidden(path)) continue;
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          if (!(await visit(path))) return false;
          continue;
        }
        if (!entry.isFile()) continue;
        const info = await lstat(path).catch(() => undefined);
        if (!info || info.size > MAX_FILE) continue;
        total += info.size;
        if (out.size >= MAX_FILES || total > MAX_FOLDER) return false;
        const rel = relative(workspace, path);
        const seen = known.get(rel);
        if (
          seen &&
          seen.size === info.size &&
          seen.mtimeMs === info.mtimeMs &&
          (await this.deps.store.has(seen.hash))
        ) {
          out.set(rel, seen);
          continue;
        }
        const kept = await this.#keep(path);
        if (kept) out.set(rel, kept);
      }
      return true;
    };
    const fits = await visit(workspace);
    if (!fits) {
      this.#reason =
        'Your work folder is too big for Conch to keep a copy of, so only edits by the assistant’s file tools can be undone.';
      return undefined;
    }
    this.#reason = undefined;
    await this.deps.store.saveIndex(workspace, Object.fromEntries(out));
    return out;
  }
}
