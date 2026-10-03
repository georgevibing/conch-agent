import { describe, expect, it } from 'vitest';

import { mergeFeeds } from './feeds.mjs';

const feed = (arch, version = '0.3.0') => `version: ${version}
files:
  - url: Conch-${version}-mac-${arch}.zip
    sha512: zip${arch}==
    size: 100
  - url: Conch-${version}-mac-${arch}.dmg
    sha512: dmg${arch}==
    size: 120
path: Conch-${version}-mac-${arch}.zip
sha512: zip${arch}==
releaseDate: '2026-10-03T09:00:00.000Z'
`;

describe('joining the two Mac feeds', () => {
  it('names both chips’ files in one feed', () => {
    const merged = mergeFeeds([feed('arm64'), feed('x64')]);
    expect(merged).toBe(`version: 0.3.0
files:
  - url: Conch-0.3.0-mac-arm64.zip
    sha512: ziparm64==
    size: 100
  - url: Conch-0.3.0-mac-arm64.dmg
    sha512: dmgarm64==
    size: 120
  - url: Conch-0.3.0-mac-x64.zip
    sha512: zipx64==
    size: 100
  - url: Conch-0.3.0-mac-x64.dmg
    sha512: dmgx64==
    size: 120
path: Conch-0.3.0-mac-arm64.zip
sha512: ziparm64==
releaseDate: '2026-10-03T09:00:00.000Z'
`);
  });

  it('reads Windows line endings, and lists a file once', () => {
    const merged = mergeFeeds([feed('arm64').replaceAll('\n', '\r\n'), feed('arm64')]);
    expect(merged.match(/- url:/g)).toHaveLength(2);
    expect(merged).not.toContain('\r');
  });

  it('refuses feeds of different versions, or something that isn’t a feed', () => {
    expect(() => mergeFeeds([feed('arm64'), feed('x64', '0.2.9')])).toThrow(/different versions/);
    expect(() => mergeFeeds(['hello: world\n'])).toThrow(/lists no files/);
  });
});
