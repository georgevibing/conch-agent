import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { HealNote } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { Healed } from './healed';

describe('Healed', () => {
  it('keeps what was fixed, newest first, across restarts', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-healed-'));
    const told: HealNote[] = [];
    const healed = new Healed(home, (note) => told.push(note));
    await healed.note('settings', 'Settings couldn’t be read, so Conch started fresh.');
    await healed.note('search', 'Search was rebuilt.');
    expect(told.map((n) => n.area)).toEqual(['settings', 'search']);

    const later = new Healed(home);
    expect((await later.list()).map((n) => n.message)).toEqual([
      'Search was rebuilt.',
      'Settings couldn’t be read, so Conch started fresh.',
    ]);
  });

  it('makes a repeat of the same repair one note, not many', async () => {
    const healed = new Healed(await mkdtemp(join(tmpdir(), 'conch-healed-')));
    await healed.note('integrations', 'Notion is answering again.');
    await healed.note('integrations', 'Notion is answering again.');
    expect(await healed.list()).toHaveLength(1);
  });

  it('starts a fresh list when its own file won’t read, and never throws', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-healed-'));
    await writeFile(join(home, 'healed.json'), '{ not json');
    const emit = vi.fn(() => {
      throw new Error('socket gone');
    });
    const healed = new Healed(home, emit);
    expect(await healed.list()).toEqual([]);
    await expect(healed.note('gateway', 'Fixed.')).resolves.toMatchObject({ message: 'Fixed.' });
    expect(JSON.parse(await readFile(join(home, 'healed.json'), 'utf8')).notes).toHaveLength(1);
  });
});
