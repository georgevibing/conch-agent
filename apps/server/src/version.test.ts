import { describe, expect, it } from 'vitest';

import { githubRepository, REPOSITORY, SERVER_VERSION } from './version';

describe('where Conch is published', () => {
  it('reads the root package.json', () => {
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(REPOSITORY).toEqual({ owner: 'giotiskl', repo: 'conch-agent' });
  });

  it('understands the ways npm lets a repository be written, and nothing else', () => {
    for (const written of [
      'github:owner/name',
      'https://github.com/owner/name',
      'https://github.com/owner/name.git',
      { type: 'git', url: 'git+https://github.com/owner/name.git' },
    ])
      expect(githubRepository(written)).toEqual({ owner: 'owner', repo: 'name' });
    for (const written of [
      undefined,
      'owner/name',
      'https://gitlab.com/owner/name',
      'https://github.com/owner/name/../../x',
      'https://github.com.evil.example/owner/name',
      { url: 42 },
    ])
      expect(githubRepository(written)).toBeUndefined();
  });
});
