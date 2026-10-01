/**
 * A helper's own copy of the work folder (ADR 0033): a git worktree on its
 * own branch, so helpers changing code side by side never trip over each
 * other or over you. A helper that changed nothing leaves no trace; one that
 * did leaves its branch for you to look at and merge.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

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
): Promise<{ changed: boolean }> {
  const status = await git(['status', '--porcelain'], wt.path);
  const head = await git(['rev-parse', 'HEAD'], wt.path);
  const changed =
    status.code !== 0 || status.stdout.trim() !== '' || head.stdout.trim() !== wt.base;
  if (!changed) {
    await git(['worktree', 'remove', '--force', wt.path], wt.repo);
    await git(['branch', '-D', wt.branch], wt.repo);
  }
  return { changed };
}
