import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findDatabases, recentFromIni } from './keepass';

describe('finding KeePassXC databases', () => {
  it('reads KeePassXC’s own recent list', () => {
    expect(
      recentFromIni(
        '[General]\nLastActiveDatabase=/Users/ada/Work.kdbx\nLastOpenedDatabases=/Users/ada/Work.kdbx, "/Users/ada/My Passwords.kdbx", /Users/ada/notes.txt\n',
      ),
    ).toEqual(['/Users/ada/Work.kdbx', '/Users/ada/My Passwords.kdbx']);
  });

  it('puts the ones KeePassXC opened first, then what’s in the usual folders, and only real files', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-kp-'));
    await mkdir(join(home, 'Documents', 'Vaults'), { recursive: true });
    await mkdir(join(home, 'Dropbox'), { recursive: true });
    await mkdir(join(home, 'Library', 'Caches', 'KeePassXC'), { recursive: true });
    await mkdir(join(home, 'Documents', 'node_modules'), { recursive: true });
    await writeFile(join(home, 'Documents', 'Vaults', 'Family.kdbx'), 'x');
    await writeFile(join(home, 'Dropbox', 'Work.kdbx'), 'x');
    await writeFile(join(home, 'Documents', 'node_modules', 'ignored.kdbx'), 'x');
    await writeFile(
      join(home, 'Library', 'Caches', 'KeePassXC', 'keepassxc.ini'),
      `[General]\nLastOpenedDatabases=${join(home, 'Dropbox', 'Work.kdbx')}, ${join(home, 'gone.kdbx')}\n`,
    );
    const found = await findDatabases({ home, platform: 'darwin' });
    expect(found.map((d) => [d.name, d.where, d.recent])).toEqual([
      ['Work', 'Dropbox', true],
      ['Family', 'Documents', false],
    ]);
  });
});
