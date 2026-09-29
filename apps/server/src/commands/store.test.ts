import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CommandStore } from './store';

describe('CommandStore', () => {
  it('seeds starter commands, saves and removes', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'conch-cmd-')), 'commands');
    const store = new CommandStore(dir);
    expect((await store.list()).map((c) => c.name)).toEqual(['explain', 'tldr']);

    const saved = await store.save({
      name: 'standup',
      description: 'Draft my standup',
      prompt: 'Write my standup from {{input}}',
    });
    expect(await readFile(join(dir, 'standup.md'), 'utf8')).toContain(
      'description: Draft my standup',
    );
    expect((await store.list()).find((c) => c.name === 'standup')).toMatchObject({
      prompt: saved.prompt,
    });

    // Updating keeps createdAt.
    const again = await store.save({ name: 'standup', description: 'x', prompt: 'y' });
    expect(again.createdAt).toBe(saved.createdAt);

    expect(await store.remove('standup')).toBe(true);
    expect(await store.remove('standup')).toBe(false);
    // Deleting a starter doesn't bring it back.
    await store.remove('tldr');
    expect((await store.list()).map((c) => c.name)).toEqual(['explain']);
  });
});
