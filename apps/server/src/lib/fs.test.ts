import type * as crypto from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeFileAtomic } from './fs';

// Make a collision reproducible; the writer must refuse it, never follow it.
vi.mock('node:crypto', async (original) => ({
  ...(await original<typeof crypto>()),
  randomBytes: () => Buffer.from('01020304', 'hex'),
}));

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function folder() {
  const path = await mkdtemp(join(tmpdir(), 'conch-atomic-'));
  folders.push(path);
  return path;
}

describe('atomic file writes', () => {
  it('preserves the requested permissions and keeps default writes private', async () => {
    const root = await folder();
    const path = join(root, 'document');
    await writeFileAtomic(path, 'restored', 0o640);
    expect(await readFile(path, 'utf8')).toBe('restored');
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o640);
    await writeFileAtomic(path, 'private');
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(root)).toEqual(['document']);
  });

  it.skipIf(process.platform === 'win32')(
    'refuses a temporary-path symlink without changing its target',
    async () => {
      const root = await folder();
      const path = join(root, 'document');
      const victim = join(root, 'keep');
      await writeFile(victim, 'untouched');
      await symlink(victim, `${path}.01020304.tmp`);
      await expect(writeFileAtomic(path, 'overwrite')).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readFile(victim, 'utf8')).toBe('untouched');
    },
  );
});
