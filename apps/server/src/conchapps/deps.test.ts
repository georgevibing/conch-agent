import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { publishedRepos } from './deps';

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

describe('where apps were published', () => {
  it('remembers each app’s repository by GitHub’s id, across restarts', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-published-'));
    homes.push(home);
    expect(await publishedRepos(home).get('tally')).toBeUndefined();
    await Promise.all([
      publishedRepos(home).set('tally', 42),
      publishedRepos(home).set('notes', 7),
    ]);
    const again = publishedRepos(home);
    expect(await again.get('tally')).toEqual({ repoId: 42 });
    // An inherited name is never a record.
    expect(await again.get('constructor')).toBeUndefined();
  });

  it('reads a damaged or odd file as nothing remembered', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-published-'));
    homes.push(home);
    await writeFile(join(home, 'conch-apps-published.json'), '{"tally": {"repoId": "42"}}');
    expect(await publishedRepos(home).get('tally')).toBeUndefined();
    await writeFile(join(home, 'conch-apps-published.json'), 'not json');
    expect(await publishedRepos(home).get('tally')).toBeUndefined();
  });
});

describe('publishing with the mock engine', () => {
  it('walks the steps a person sees without running gh', async () => {
    const { createPretendPublisher } = await import('./pretend');
    const publisher = createPretendPublisher({ stepMs: 5 });
    const manifest = { id: 'tally', version: '1.0.0' } as never;
    expect((await publisher.publish({ id: 'tally', dir: '/nowhere', manifest })).state).toBe(
      'needs-sign-in',
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(publisher.state('tally')).toMatchObject({
      state: 'published',
      url: 'https://github.com/conch-mock/tally',
    });
  });
});
