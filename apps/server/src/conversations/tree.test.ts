import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { treeClean } from './tree';

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });

describe('whether a repository has anything to lose (ADR 0128)', () => {
  it('is clean with everything committed, not with a change or a new file, unknown elsewhere', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conch-tree-'));
    expect(await treeClean(dir)).toBeUndefined();
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'ada@example.com');
    git(dir, 'config', 'user.name', 'Ada');
    await writeFile(join(dir, 'a.txt'), 'one');
    git(dir, 'add', 'a.txt');
    git(dir, 'commit', '-q', '-m', 'one');
    expect(await treeClean(dir)).toBe(true);
    await writeFile(join(dir, 'a.txt'), 'two');
    expect(await treeClean(dir)).toBe(false);
    git(dir, 'checkout', '-q', '--', 'a.txt');
    await writeFile(join(dir, 'b.txt'), 'new');
    expect(await treeClean(dir)).toBe(false);
    expect(await treeClean(join(dir, 'nowhere'))).toBeUndefined();
  });
});
