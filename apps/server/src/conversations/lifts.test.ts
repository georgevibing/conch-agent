import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AutoLifts } from './lifts';

describe('which chats lifted a kind of step (ADR 0128)', () => {
  it('remembers the chats per class, newest last, a few at most, and reads them back', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-lifts-'));
    const lifts = new AutoLifts(home);
    expect(await lifts.seen('risk:install:moderate')).toEqual([]);
    await lifts.note('risk:install:moderate', 'c1');
    await lifts.note('risk:install:moderate', 'c2');
    await lifts.note('risk:install:moderate', 'c1');
    expect(await lifts.seen('risk:install:moderate')).toEqual(['c2', 'c1']);
    for (let i = 0; i < 12; i++) await lifts.note('risk:egress:push code to a remote', `p${i}`);
    expect(await lifts.seen('risk:egress:push code to a remote')).toHaveLength(8);
    // On disk, readable by the next Conch, and nothing else.
    const file = JSON.parse(await readFile(join(home, 'auto-lifts.json'), 'utf8')) as {
      version: number;
    };
    expect(file.version).toBe(1);
    expect(await new AutoLifts(home).seen('risk:install:moderate')).toEqual(['c2', 'c1']);
  });
});
