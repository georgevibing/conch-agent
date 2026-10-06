import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { commit, conchFiles, git, makeKey, signer, tag, type Key } from '../release/testing';
import { currentFolder, prove, readState } from './layout';
import { ReleaseFollower, versionOf } from './releases';

/**
 * A stand-in pnpm: records each run (and where) in `pnpm.log` beside it,
 * and fails a step when the version has a `fail-<step>` file.
 */
const PNPM = `
const fs = require('fs');
const path = require('path');
const step = process.argv.includes('build') ? 'build' : 'install';
fs.appendFileSync(path.join(__dirname, 'pnpm.log'), step + ' ' + process.cwd() + '\\n');
if (step === 'install') console.log('Progress: resolved 10, reused 5, downloaded 0, added 5');
if (fs.existsSync('fail-' + step)) { console.error('ERR_PNPM something broke'); process.exitCode = 1; }
`;

/** The first offer, which a test expects to be there. */
function first<T>(list: T[]): T {
  const [one] = list;
  if (!one) throw new Error('Nothing was offered.');
  return one;
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const notes = (version: string, line: string) => `Conch ${version}\n\nNew\n- ${line}\n`;

/**
 * A bare origin, the maker's clone that tags releases, and Conch installed
 * from it at v0.1.0 (detached at the tag, as the installer leaves it).
 */
async function world() {
  const base = await mkdtemp(join(tmpdir(), 'conch-releases-'));
  dirs.push(base);
  const origin = join(base, 'origin.git');
  const maker = join(base, 'maker');
  const conch = join(base, 'conch');
  const home = join(base, 'home');
  const key = makeKey(base, 'maker-key');
  const signers = `${signer('ada@example.com', key)}\n`;
  git(base, 'init', '--quiet', '--bare', '-b', 'main', origin);
  git(base, 'clone', '--quiet', origin, maker);
  git(maker, 'checkout', '--quiet', '-b', 'main');
  commit(maker, conchFiles('0.1.0', signers), 'release: v0.1.0');
  tag(maker, 'v0.1.0', notes('0.1.0', 'The first version'), key);
  git(maker, 'push', '--quiet', '-u', 'origin', 'main', '--tags');
  git(base, 'clone', '--quiet', origin, conch);
  git(conch, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', 'v0.1.0');

  const release = (version: string, line: string, by: Key | null = key, extra = {}) => {
    commit(
      maker,
      {
        ...conchFiles(version, readFileSync(join(maker, 'release/allowed_signers'), 'utf8')),
        ...extra,
      },
      `release: v${version}`,
    );
    tag(maker, `v${version}`, notes(version, line), by ?? undefined);
    git(maker, 'push', '--quiet', 'origin', 'main', `v${version}`);
  };

  const pnpmScript = join(base, 'pnpm.js');
  await writeFile(pnpmScript, PNPM);
  const backup = vi.fn(async () => undefined);
  const follower = (root = conch) =>
    new ReleaseFollower(root, {
      home,
      backup,
      pnpm: () => Promise.resolve({ command: process.execPath, prefix: [pnpmScript] }),
      now: () => 1_000,
    });
  const ran = () =>
    existsSync(join(base, 'pnpm.log')) ? readFileSync(join(base, 'pnpm.log'), 'utf8') : '';
  const look = (
    f: ReleaseFollower,
    channel: 'stable' | 'beta' | 'alpha' = 'stable',
    failed: string[] = [],
  ) => f.check({ fetch: true, channel, everyChange: false, failed });
  return { base, origin, maker, conch, home, key, release, follower, backup, ran, look };
}

describe('finding releases', () => {
  it('offers the newest release in the channel above this one, with its notes', async () => {
    const w = await world();
    w.release('0.2.0', 'Edit pages by hand');
    w.release('0.3.0-beta.1', 'Talk to it');
    const f = w.follower();
    expect(f.version()).toBe('0.1.0');
    const stable = await w.look(f);
    expect(stable).toMatchObject({ source: 'releases', fetched: true, anyReleases: true });
    expect(stable.offers.map((o) => o.version)).toEqual(['0.2.0']);
    expect(stable.offers[0]?.notes).toMatchObject({
      version: '0.2.0',
      channel: 'stable',
      new: ['Edit pages by hand'],
    });
    const beta = await w.look(f, 'beta');
    expect(beta.offers.map((o) => o.version)).toEqual(['0.3.0-beta.1', '0.2.0']);
    // A release that didn't start here isn't offered again.
    expect((await w.look(f, 'beta', ['0.3.0-beta.1'])).offers.map((o) => o.version)).toEqual([
      '0.2.0',
    ]);
  });

  it('refuses a forged or unsigned release in plain words, and still offers the good one', async () => {
    const w = await world();
    w.release('0.2.0', 'Edit pages by hand');
    const stranger = makeKey(w.base, 'stranger');
    w.release('0.2.1', 'Something nobody made', stranger);
    w.release('0.2.2', 'Something unsigned', null);
    const found = await w.look(w.follower());
    expect(found.refused).toBe('Conch 0.2.2 isn’t signed, so Conch won’t install it.');
    expect(found.offers.map((o) => o.version)).toEqual(['0.2.0']);
  });

  it('never moves a tag of yours, and reads one moved upstream again', async () => {
    const w = await world();
    w.release('0.2.0', 'Edit pages by hand');
    await w.look(w.follower());
    // Upstream moves v0.2.0 to an unsigned tag: it's read again and refused.
    git(w.maker, 'tag', '-f', '-a', '-m', 'Conch 0.2.0', 'v0.2.0');
    git(w.maker, 'push', '--quiet', '--force', 'origin', 'v0.2.0');
    const again = await w.look(w.follower());
    expect(again.offers).toEqual([]);
    expect(again.refused).toMatch(/isn’t signed/);
    expect(git(w.conch, 'tag', '-l')).toBe('v0.1.0');
  });

  it('carries trust across a new key: the release adding it is signed with the old one', async () => {
    const w = await world();
    const next = makeKey(w.base, 'next-key');
    const both = `${signer('ada@example.com', w.key)}\n${signer('ada@example.com', next)}\n`;
    await writeFile(join(w.maker, 'release/allowed_signers'), both);
    w.release('0.2.0', 'A new key', w.key);
    w.release('0.3.0', 'Signed with the new key', next);
    const old = await w.look(w.follower());
    // This copy only knows the old key: 0.3.0 is refused, 0.2.0 (which brings the new key) is offered.
    expect(old.offers.map((o) => o.version)).toEqual(['0.2.0']);
    expect(old.refused).toMatch(/0\.3\.0 isn’t signed by a key this Conch trusts/);
    const staged = await w.follower().stage(first(old.offers), old.offers, () => undefined);
    expect(staged.kind).toBe('staged');
    // Running 0.2.0, Conch trusts the key 0.2.0 named.
    const there = await w.look(w.follower(join(w.home, 'versions', '0.2.0')));
    expect(there.offers.map((o) => o.version)).toEqual(['0.3.0']);
  });
});

describe('where updates come from', () => {
  it('follows every change on main until the first release, then releases — never going back', async () => {
    const w = await world();
    // A copy of main, as installs were before releases: pretend there are no tags yet.
    const main = join(w.base, 'main');
    git(w.base, 'clone', '--quiet', '--no-tags', w.origin, main);
    git(w.maker, 'push', '--quiet', 'origin', ':refs/tags/v0.1.0');
    git(w.maker, 'tag', '-d', 'v0.1.0');
    const before = await w.look(w.follower(main));
    expect(before).toMatchObject({
      source: 'branch',
      sourceWhy: 'Conch has no releases yet, so it follows every change.',
    });
    // The first release: main now follows releases. It's already at 0.1.0, so nothing's offered.
    tag(w.maker, 'v0.1.0', notes('0.1.0', 'The first version'), w.key);
    git(w.maker, 'push', '--quiet', 'origin', 'v0.1.0');
    const after = await w.look(w.follower(main));
    expect(after).toMatchObject({ source: 'releases', offers: [] });
  });

  it('a copy ahead of the newest stable release waits for a newer one', async () => {
    const w = await world();
    w.release('0.3.0-beta.1', 'Talk to it');
    const f = w.follower();
    const staged = await f.stage(first((await w.look(f, 'beta')).offers), [], () => undefined);
    expect(staged.kind).toBe('staged');
    const beta = w.follower(join(w.home, 'versions', '0.3.0-beta.1'));
    w.release('0.2.1', 'An older fix');
    const stable = await w.look(beta, 'stable');
    expect(stable.offers).toEqual([]);
    expect(beta.waiting('stable')).toBe(
      'You’re on 0.3.0-beta.1. Conch moves to stable releases with the next one after it (0.3.0 or later): it never goes back a version by itself.',
    );
    w.release('0.3.0', 'Talk to it, for everyone');
    expect((await w.look(beta, 'stable')).offers.map((o) => o.version)).toEqual(['0.3.0']);
  });

  it('a developer’s copy follows its branch', async () => {
    const w = await world();
    const dev = join(w.base, 'dev');
    git(w.base, 'clone', '--quiet', w.origin, dev);
    git(dev, 'checkout', '--quiet', '-b', 'my-idea');
    expect(await w.look(w.follower(dev))).toMatchObject({
      source: 'branch',
      sourceWhy: 'This copy is on the branch “my-idea”, so it follows that branch.',
    });
    git(dev, 'checkout', '--quiet', 'main');
    commit(dev, { 'mine.txt': 'x' }, 'feat: my own change');
    expect((await w.look(w.follower(dev))).sourceWhy).toMatch(/commits of its own/);
    git(dev, 'reset', '--quiet', '--hard', 'origin/main');
    await writeFile(join(dev, 'package.json'), '{"edited": true}\n');
    expect((await w.look(w.follower(dev))).sourceWhy).toMatch(/changes of its own/);
    git(dev, 'checkout', '--quiet', '--', 'package.json');
    git(dev, 'config', 'conch.follow', 'branch');
    expect((await w.look(w.follower(dev))).sourceWhy).toMatch(
      /installed to follow the branch “main”/,
    );
    // Every change on main, chosen in Settings.
    const everyChange = await w
      .follower()
      .check({ fetch: false, channel: 'stable', everyChange: true, failed: [] });
    expect(everyChange.source).toBe('branch');
  });
});

describe('updating beside the running version', () => {
  it('makes the release ready in its own folder, backs up, then swaps the pointer', async () => {
    const w = await world();
    w.release('0.2.0', 'Edit pages by hand');
    const f = w.follower();
    const { offers } = await w.look(f);
    const steps: string[] = [];
    const head = git(w.conch, 'rev-parse', 'HEAD');
    const result = await f.stage(first(offers), offers, (p) => steps.push(p.phase));
    const folder = join(w.home, 'versions', '0.2.0');
    expect(result).toMatchObject({ kind: 'staged', version: '0.2.0', folder });
    expect(steps).toEqual(['verify', 'fetch', 'install', 'install', 'build', 'backup']);
    // Installed and built there, never in the running folder, which is untouched.
    const there = realpathSync(folder);
    expect(w.ran()).toBe(`install ${there}\nbuild ${there}\n`);
    expect(git(w.conch, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(w.conch, 'status', '--porcelain')).toBe('');
    expect(git(folder, 'rev-parse', 'HEAD')).toBe(git(w.maker, 'rev-parse', 'v0.2.0^{commit}'));
    expect(versionOf(folder)).toBe('0.2.0');
    expect(w.backup).toHaveBeenCalledOnce();
    expect(currentFolder(w.home)).toBe(folder);
    expect(readState(w.home).pending).toMatchObject({
      folder,
      version: '0.2.0',
      from: { folder: w.conch, version: '0.1.0' },
    });
  });

  it('a step that fails leaves everything as it was', async () => {
    const w = await world();
    w.release('0.2.0', 'Does not build', w.key, { 'fail-build': 'x' });
    const f = w.follower();
    const { offers } = await w.look(f);
    const result = await f.stage(first(offers), offers, () => undefined);
    expect(result).toEqual({
      kind: 'failed',
      message:
        'The update didn’t install (the new version wouldn’t build), so Conch kept the version you have. Nothing of yours changed.',
    });
    expect(existsSync(join(w.home, 'versions', '0.2.0'))).toBe(false);
    expect(currentFolder(w.home)).toBeUndefined();
    expect(git(w.conch, 'worktree', 'list').split('\n')).toHaveLength(1);
    // Trying again starts afresh.
    expect((await f.stage(first(offers), offers, () => undefined)).kind).toBe('failed');
  });

  it('no backup, no swap', async () => {
    const w = await world();
    w.release('0.2.0', 'Edit pages by hand');
    w.backup.mockRejectedValueOnce(new Error('There isn’t room for a backup.'));
    const f = w.follower();
    const { offers } = await w.look(f);
    expect(await f.stage(first(offers), offers, () => undefined)).toEqual({
      kind: 'refused',
      reason:
        'Conch couldn’t make a backup first (There isn’t room for a backup), so it left the version you have.',
    });
    expect(currentFolder(w.home)).toBeUndefined();
  });

  it('re-checks the exact tag it offered: a swapped tag object is refused', async () => {
    const w = await world();
    w.release('0.2.0', 'Edit pages by hand');
    const f = w.follower();
    const { offers } = await w.look(f);
    const unsigned = git(w.conch, 'mktree');
    const forged = { ...first(offers), object: unsigned };
    expect(await f.stage(forged, offers, () => undefined)).toMatchObject({ kind: 'refused' });
  });

  it('tidies away versions nobody needs once the new one is proved', async () => {
    const w = await world();
    w.release('0.2.0', 'Two');
    let f = w.follower();
    let { offers } = await w.look(f);
    await f.stage(first(offers), offers, () => undefined);
    prove(w.home, join(w.home, 'versions', '0.2.0'));
    w.release('0.3.0', 'Three');
    f = w.follower(join(w.home, 'versions', '0.2.0'));
    ({ offers } = await w.look(f));
    await f.stage(first(offers), offers, () => undefined);
    prove(w.home, join(w.home, 'versions', '0.3.0'));
    w.release('0.4.0', 'Four');
    f = w.follower(join(w.home, 'versions', '0.3.0'));
    ({ offers } = await w.look(f));
    await f.stage(first(offers), offers, () => undefined);
    prove(w.home, join(w.home, 'versions', '0.4.0'));
    const removed = await w.follower(join(w.home, 'versions', '0.4.0')).prune([]);
    // 0.4.0 runs, 0.3.0 is kept to go back to, the checkout stays; 0.2.0 goes.
    expect(removed.map((f) => f.replace(/^\/private/, ''))).toEqual([
      join(w.home, 'versions', '0.2.0').replace(/^\/private/, ''),
    ]);
    expect(existsSync(join(w.home, 'versions', '0.2.0'))).toBe(false);
    expect(existsSync(join(w.home, 'versions', '0.3.0'))).toBe(true);
    expect(existsSync(w.conch)).toBe(true);
  });
});

it('lets Dev reach the first signed prerelease only in the selected channel, despite its package baseline', async () => {
  const w = await world();
  git(w.maker, 'push', '--quiet', 'origin', ':refs/tags/v0.1.0');
  git(w.conch, 'tag', '-d', 'v0.1.0');
  git(w.conch, 'checkout', '--quiet', 'main');
  w.release('0.1.0-beta.1', 'First beta');
  const f = new ReleaseFollower(w.conch, { home: w.home, build: { kind: 'dev' } });
  const stable = await w.look(f, 'stable');
  expect(stable).toMatchObject({ source: 'branch', offers: [] });
  const beta = await w.look(f, 'beta');
  expect(beta.source).toBe('releases');
  expect(beta.offers.map((o) => o.version)).toEqual(['0.1.0-beta.1']);
  expect(f.waiting('stable')).toBeUndefined();
});
