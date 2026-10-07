import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { finishWorktree, resumeWorktree } from './worktree';

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function folder() {
  const home = await mkdtemp(join(tmpdir(), 'conch-worktree-recovery-'));
  homes.push(home);
  return { path: join(home, 'task'), repo: home, base: 'initial', branch: 'conch/task' };
}
const result = (stdout = '', code = 0) => ({ stdout, stderr: '', code });

describe('task worktree recovery', () => {
  it('never substitutes or recreates a missing retained folder', async () => {
    const wt = await folder();
    const git = vi.fn(async () => result());
    await expect(resumeWorktree({ ...wt, retained: true }, git)).rejects.toThrow(
      /work folder is missing/,
    );
    expect(git).not.toHaveBeenCalled();
  });

  it('refuses another branch before a resumed provider starts', async () => {
    const wt = await folder();
    await mkdir(wt.path);
    const git = vi.fn(async (args: string[]) =>
      result(args[0] === 'rev-parse' ? wt.path : 'another-branch'),
    );
    await expect(resumeWorktree(wt, git)).rejects.toThrow(/branch changed/);
  });

  it('keeps both folder and branch if Git detects a late edit during cleanup', async () => {
    const wt = await folder();
    const git = vi.fn(async (args: string[]) =>
      args[0] === 'worktree' ? result('', 1) : result(args[0] === 'rev-parse' ? wt.base : ''),
    );
    expect(await finishWorktree(wt, git)).toEqual({ changed: true, retained: true });
    expect(git.mock.calls.some(([args]) => args.includes('--force') || args[0] === 'branch')).toBe(
      false,
    );
  });
  it('records cleanup before removal, and leaves the folder alone if that save fails', async () => {
    const wt = await folder();
    const saved: string[] = [];
    const git = vi.fn(async (args: string[]) => {
      if (args[0] === 'worktree') expect(saved).toEqual(['clean-checkpoint']);
      return result(args[0] === 'rev-parse' ? wt.base : '');
    });
    await finishWorktree(wt, git, async () => {
      saved.push('clean-checkpoint');
    });
    expect(git).toHaveBeenCalledWith(
      ['update-ref', '-d', `refs/heads/${wt.branch}`, wt.base],
      wt.repo,
    );
    git.mockClear();
    await expect(
      finishWorktree(wt, git, async () => {
        throw new Error('disk unavailable');
      }),
    ).rejects.toThrow('disk unavailable');
    expect(git.mock.calls.every(([args]) => args[0] === 'status' || args[0] === 'rev-parse')).toBe(
      true,
    );
  });
});
