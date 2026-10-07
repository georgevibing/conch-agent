/**
 * A helper's own copy of the work folder (ADR 0033): a git worktree on its
 * own branch, so helpers changing code side by side never trip over each
 * other or over you. A helper that changed nothing leaves no trace; one that
 * did leaves its branch for you to look at and merge.
 */
import { mkdir, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { findExecutable, run, type RunResult } from '../lib/proc';

export type Git = (args: string[], cwd: string) => Promise<RunResult>;

const defaultGit: Git = async (args, cwd) => {
  const git = (await findExecutable('git')) ?? 'git';
  return run(git, args, { cwd, timeout: 30_000 });
};

export interface Worktree {
  path: string;
  branch: string;
  /** Where it came from: the repository and the commit it started at. */
  repo: string;
  base: string;
}

/** Make one for `taskId`, when the work folder is a git repository. Undefined when it isn't. */
export async function createWorktree(
  workspace: string,
  home: string,
  taskId: string,
  git: Git = defaultGit,
): Promise<Worktree | undefined> {
  const top = await git(['rev-parse', '--show-toplevel'], workspace);
  if (top.code !== 0) return undefined;
  const repo = top.stdout.trim();
  const head = await git(['rev-parse', 'HEAD'], repo);
  if (head.code !== 0) return undefined;
  const dir = join(home, 'worktrees');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, taskId);
  const branch = `conch/${taskId}`;
  const added = await git(['worktree', 'add', '-b', branch, path, 'HEAD'], repo);
  if (added.code !== 0) return undefined;
  return { path, branch, repo, base: head.stdout.trim() };
}

/**
 * When the helper is done: nothing changed (no edits, no commits) means the
 * worktree and its branch go; otherwise they stay, and say so.
 */
export async function finishWorktree(
  wt: Worktree,
  git: Git = defaultGit,
  beforeRemoval?: () => Promise<void>,
): Promise<{ changed: boolean; retained: boolean }> {
  const status = await git(['status', '--porcelain'], wt.path);
  const head = await git(['rev-parse', 'HEAD'], wt.path);
  const changed =
    status.code !== 0 || status.stdout.trim() !== '' || head.stdout.trim() !== wt.base;
  if (!changed) {
    // A restart between removal and task completion must know this folder was clean
    // and may be recreated. Do not remove it if the durable checkpoint fails.
    await beforeRemoval?.();
    // Git checks again for edits: a file written after status must not be deleted.
    const removed = await git(['worktree', 'remove', wt.path], wt.repo);
    if (removed.code !== 0) return { changed: true, retained: true };
    // Delete only the unchanged branch; a concurrent commit must retain its reference.
    await git(['update-ref', '-d', `refs/heads/${wt.branch}`, wt.base], wt.repo);
    return { changed: false, retained: false };
  }
  return { changed, retained: true };
}

/** Reopen only a worktree Conch deliberately cleaned up; never guess after missing work. */
export async function resumeWorktree(
  saved: { path: string; branch: string; repo?: string; base?: string; retained?: boolean },
  git: Git = defaultGit,
): Promise<void> {
  const exists = await stat(saved.path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );
  if (!exists) {
    if (saved.retained !== false || !saved.repo || !saved.base)
      throw new Error(
        'This task’s work folder is missing. Restore that folder before resuming; Conch will not switch to another folder.',
      );
    const branch = await git(['rev-parse', '--verify', `refs/heads/${saved.branch}`], saved.repo);
    const args =
      branch.code === 0
        ? ['worktree', 'add', saved.path, saved.branch]
        : ['worktree', 'add', '-b', saved.branch, saved.path, saved.base];
    const added = await git(args, saved.repo);
    if (added.code !== 0)
      throw new Error(
        'Conch could not reopen this task’s work folder. Check its branch and folder in the repository, then resume.',
      );
  }
  const top = await git(['rev-parse', '--show-toplevel'], saved.path);
  const branch = await git(['symbolic-ref', '--short', 'HEAD'], saved.path);
  if (
    top.code !== 0 ||
    resolve(top.stdout.trim()) !== (await realpath(saved.path)) ||
    branch.code !== 0 ||
    branch.stdout.trim() !== saved.branch
  )
    throw new Error(
      'This task’s work folder or branch changed. Restore its original branch before resuming.',
    );
  if (saved.repo) {
    const common = ['rev-parse', '--path-format=absolute', '--git-common-dir'];
    const expected = await git(common, saved.repo);
    const actual = await git(common, saved.path);
    if (
      expected.code !== 0 ||
      actual.code !== 0 ||
      resolve(expected.stdout.trim()) !== resolve(actual.stdout.trim())
    )
      throw new Error(
        'This task’s work folder belongs to a different repository. Restore its original worktree before resuming.',
      );
  }
}
