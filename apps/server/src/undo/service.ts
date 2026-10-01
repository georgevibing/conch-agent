/**
 * Putting files back (ADR 0030): a preview of exactly what will change, then
 * the change — undone newest first, redone oldest first. A file is only put
 * back where it was: never through a link, never into a folder that now
 * points somewhere else, never where keys and passwords live. A file that
 * changed since (you edited it after the assistant) is a conflict: the
 * preview says so, and it's only replaced when the person says so.
 */
import { lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import type {
  ChangedFile,
  DoctorItem,
  LatestUndo,
  UndoPreview,
  UndoPreviewFile,
  UndoResult,
} from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import { writeFileAtomic } from '../lib/fs';
import { isBinary, unifiedDiff } from './diff';
import { sha256, type ChangeSet, type FileChange, type UndoStore } from './store';
import { TurnTracker, type TrackerDeps } from './tracker';

export class UndoError extends Error {
  constructor(
    readonly code: 'not-found' | 'expired',
    message: string,
  ) {
    super(message);
  }
}

const kindOf = (f: Pick<FileChange, 'before' | 'after'>): ChangedFile['kind'] =>
  !f.before ? 'created' : !f.after ? 'deleted' : 'changed';

export const changedFiles = (set: ChangeSet): ChangedFile[] =>
  set.files.map((f) => ({ path: f.shown, kind: kindOf(f) }));

/** Each path's whole journey across the sets: where it must be now, and where it goes. */
interface Plan {
  file: FileChange;
  /** What it should be now (hash, or null for absent). */
  expected: string | null;
  /** What it will be: the version to write, or undefined to remove it. */
  target?: { hash: string; mode: number };
}

export interface UndoDeps {
  store: UndoStore;
  forbidden: (path: string) => boolean;
  /** Tell the chat: a change set was undone or redone. */
  restored: (set: ChangeSet, direction: 'undo' | 'redo', files: ChangedFile[]) => void;
  /** Size limit for tests. */
  maxBytes?: number;
}

export class UndoService {
  constructor(private readonly deps: UndoDeps) {}

  /** A tracker for one turn. */
  tracker(deps: Omit<TrackerDeps, 'store' | 'forbidden'>): TurnTracker {
    return new TurnTracker({ ...deps, store: this.deps.store, forbidden: this.deps.forbidden });
  }

  async state(id: string) {
    return (await this.deps.store.set(id))?.state;
  }

  async #sets(ids: string[], direction: 'undo' | 'redo'): Promise<ChangeSet[]> {
    const sets: ChangeSet[] = [];
    for (const id of new Set(ids)) {
      const set = await this.deps.store.set(id);
      if (!set) throw new UndoError('not-found', 'That change isn’t there any more.');
      if (set.state === 'expired')
        throw new UndoError('expired', 'That change is too old to undo: Conch let its copies go.');
      // Already where it's going: nothing to do for this one.
      if (
        (direction === 'undo' && set.state === 'undone') ||
        (direction === 'redo' && set.state === 'applied')
      )
        continue;
      sets.push(set);
    }
    // Undo walks back from the newest; redo forward from the oldest.
    return sets.sort((a, b) => (direction === 'undo' ? b.at - a.at : a.at - b.at));
  }

  #plan(sets: ChangeSet[], direction: 'undo' | 'redo'): Plan[] {
    const plans = new Map<string, Plan>();
    for (const set of sets)
      for (const file of set.files) {
        const from = direction === 'undo' ? file.after : file.before;
        const to = direction === 'undo' ? file.before : file.after;
        const plan = plans.get(file.path);
        // The first set to touch a path says what it should be now; the last, where it ends.
        if (!plan)
          plans.set(file.path, { file, expected: from?.hash ?? null, ...(to && { target: to }) });
        else {
          plan.target = to;
          plan.file = file;
        }
      }
    return [...plans.values()];
  }

  /** Why a path can't be written to safely, if it can't. */
  async #blocked(file: FileChange): Promise<string | undefined> {
    if (this.deps.forbidden(file.path))
      return 'Conch never changes where your keys and passwords live.';
    const info = await lstat(file.path).catch(() => undefined);
    if (info?.isSymbolicLink()) return 'It’s a link now, so Conch won’t write through it.';
    if (info && !info.isFile()) return 'Something else is there now, not a file.';
    const parent = await realpath(dirname(file.path)).catch(() => undefined);
    if (parent && parent !== file.parent) return 'Its folder now points somewhere else.';
    return undefined;
  }

  async #current(path: string): Promise<{ hash: string | null; bytes?: Buffer }> {
    const info = await lstat(path).catch(() => undefined);
    if (!info?.isFile()) return { hash: null };
    const bytes = await readFile(path).catch(() => undefined);
    return bytes ? { hash: sha256(bytes), bytes } : { hash: null };
  }

  async preview(ids: string[], direction: 'undo' | 'redo'): Promise<UndoPreview> {
    const sets = await this.#sets(ids, direction);
    const files: UndoPreviewFile[] = [];
    for (const plan of this.#plan(sets, direction)) {
      const now = await this.#current(plan.file.path);
      const target = plan.target ? await this.deps.store.get(plan.target.hash) : undefined;
      const action: UndoPreviewFile['action'] = !plan.target
        ? 'remove'
        : now.hash === null
          ? 'recreate'
          : 'restore';
      const blocked =
        (await this.#blocked(plan.file)) ??
        (plan.target && !target
          ? 'Conch’s copy of it is gone or damaged, so it can’t be put back.'
          : undefined);
      const binary = Boolean((now.bytes && isBinary(now.bytes)) || (target && isBinary(target)));
      const diff = binary
        ? undefined
        : unifiedDiff(
            now.bytes?.toString('utf8') ?? '',
            target?.toString('utf8') ?? '',
            plan.file.shown,
          );
      files.push({
        path: plan.file.shown,
        kind: kindOf(plan.file),
        action,
        ...(diff && { diff }),
        ...(binary && { binary }),
        ...(now.hash !== plan.expected && {
          conflict:
            now.hash === null
              ? 'It was deleted since.'
              : plan.expected === null
                ? 'A file with this name was made since.'
                : 'It changed since. Undoing replaces those later changes too.',
        }),
        ...(blocked && { blocked }),
      });
    }
    return { direction, files };
  }

  async apply(ids: string[], direction: 'undo' | 'redo', force = false): Promise<UndoResult> {
    const sets = await this.#sets(ids, direction);
    const restored: ChangedFile[] = [];
    const skipped: UndoResult['skipped'] = [];
    for (const plan of this.#plan(sets, direction)) {
      const shown = plan.file.shown;
      const blocked = await this.#blocked(plan.file);
      if (blocked) {
        skipped.push({ path: shown, reason: blocked });
        continue;
      }
      const now = await this.#current(plan.file.path);
      if (now.hash !== plan.expected && !force) {
        skipped.push({ path: shown, reason: 'It changed since; it was left as it is.' });
        continue;
      }
      if (!plan.target) {
        await rm(plan.file.path, { force: true });
        restored.push({ path: shown, kind: 'deleted' });
        continue;
      }
      const bytes = await this.deps.store.get(plan.target.hash);
      if (!bytes) {
        skipped.push({ path: shown, reason: 'Conch’s copy of it is gone or damaged.' });
        continue;
      }
      await mkdir(dirname(plan.file.path), { recursive: true });
      // Made just now: still has to be where it was, not somewhere a link leads.
      if ((await realpath(dirname(plan.file.path)).catch(() => undefined)) !== plan.file.parent) {
        skipped.push({ path: shown, reason: 'Its folder now points somewhere else.' });
        continue;
      }
      await writeFileAtomic(plan.file.path, bytes, plan.target.mode || 0o644);
      restored.push({ path: shown, kind: now.hash === null ? 'created' : 'changed' });
    }
    // A set is done when nothing in it was skipped.
    const missed = new Set(skipped.map((s) => s.path));
    for (const set of sets) {
      if (set.files.some((f) => missed.has(f.shown))) continue;
      const next = {
        ...set,
        state: direction === 'undo' ? ('undone' as const) : ('applied' as const),
      };
      await this.deps.store.saveSet(next);
      this.deps.restored(next, direction, changedFiles(set));
    }
    return { restored, skipped };
  }

  /** The newest change that can still be undone. */
  async latest(): Promise<LatestUndo> {
    const set = (await this.deps.store.sets()).find((s) => s.state === 'applied');
    return set ? { changeSetId: set.id, conversationId: set.conversationId, label: set.label } : {};
  }

  /** Change sets by tool call, for a chat (Activity). */
  async byConversation(conversationId: string): Promise<ChangeSet[]> {
    return (await this.deps.store.sets()).filter((s) => s.conversationId === conversationId);
  }

  sweep(now?: number) {
    return this.deps.store.sweep({ now, maxBytes: this.deps.maxBytes });
  }

  doctorCheck(): DoctorCheck {
    return {
      id: 'undo',
      group: 'Your data',
      title: 'Undo',
      run: async ({ repair }) => {
        const swept = repair ? await this.sweep() : 0;
        const usage = await this.deps.store.usage();
        const mb = Math.round(usage.bytes / 1_000_000);
        const item = (state: DoctorItem['state'], message: string): DoctorItem[] => [
          { id: 'undo', group: 'Your data', title: 'Undo', state, message },
        ];
        if (swept)
          return item(
            'fixed',
            `Conch let ${swept === 1 ? 'one old change' : `${swept} old changes`} go to keep Undo small.`,
          );
        if (usage.bytes > (this.deps.maxBytes ?? 1024 * 1024 * 1024) * 0.9)
          return item('warning', `Undo keeps ${mb} MB; the oldest changes go first as it fills.`);
        return item(
          usage.undoable ? 'ok' : 'off',
          usage.undoable
            ? `${usage.undoable === 1 ? 'One change' : `${usage.undoable} changes`} can be undone (${mb} MB kept).`
            : 'Nothing to undo yet.',
        );
      },
    };
  }
}
