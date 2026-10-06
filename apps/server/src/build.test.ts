import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readBuild } from './build';

const homes: string[] = [];
const home = () => {
  const root = mkdtempSync(join(tmpdir(), 'conch-build-'));
  homes.push(root);
  return root;
};
const put = (root: string, name: string, value: unknown) =>
  writeFileSync(join(root, name), JSON.stringify(value));
const git = (root: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
function repo(version = '0.1.0') {
  const root = home();
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Build test');
  git(root, 'config', 'user.email', 'build@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  put(root, 'package.json', { version });
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'start');
  return { root, commit: git(root, 'rev-parse', 'HEAD') };
}
afterEach(() => {
  for (const root of homes.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('the identity of the running build', () => {
  it('keeps a branch Dev, even when its base version has a tag or stale packaged metadata', () => {
    const { root, commit } = repo();
    git(root, '-c', 'tag.gpgsign=false', 'tag', 'v0.1.0');
    put(root, 'conch-build.json', { kind: 'release', version: '0.1.0', channel: 'stable', commit });
    expect(readBuild(root)).toEqual({ kind: 'dev', commit });
  });
  it.each([
    ['0.1.0', 'stable'],
    ['0.1.0-alpha.1', 'alpha'],
    ['0.1.0-beta.2', 'beta'],
  ])('identifies a clean detached %s release', (version, channel) => {
    const { root, commit } = repo(version);
    git(root, '-c', 'tag.gpgsign=false', 'tag', `v${version}`);
    git(root, 'checkout', '--detach');
    expect(readBuild(root)).toEqual({ kind: 'release', version, channel, commit });
    put(root, 'package.json', { version, description: 'edited' });
    expect(readBuild(root)).toEqual({ kind: 'dev', commit });
  });
  it('recognizes the private tag namespace fetched by the release installer', () => {
    const { root, commit } = repo('0.1.0-beta.1');
    git(root, 'update-ref', 'refs/conch/tags/v0.1.0-beta.1', commit);
    git(root, 'checkout', '--detach');
    expect(readBuild(root)).toMatchObject({ kind: 'release', channel: 'beta' });
  });
  it('does not infer a release from a detached commit or a different version’s tag', () => {
    const { root, commit } = repo();
    git(root, '-c', 'tag.gpgsign=false', 'tag', 'v0.2.0');
    git(root, 'checkout', '--detach');
    expect(readBuild(root)).toEqual({ kind: 'dev', commit });
  });
  it('reads packaged identity without Git, preserves Dev, and rejects inconsistent metadata', () => {
    const root = home();
    const commit = 'a'.repeat(40);
    put(root, 'package.json', { version: '0.1.0-beta.2' });
    expect(readBuild(root)).toEqual({ kind: 'dev' });
    const build = { kind: 'release', version: '0.1.0-beta.2', channel: 'beta', commit };
    put(root, 'conch-build.json', build);
    expect(readBuild(root)).toEqual(build);
    put(root, 'conch-build.json', { ...build, channel: 'stable' });
    expect(readBuild(root)).toEqual({ kind: 'dev', commit });
    put(root, 'conch-build.json', { kind: 'dev', commit });
    expect(readBuild(root)).toEqual({ kind: 'dev', commit });
  });
});
