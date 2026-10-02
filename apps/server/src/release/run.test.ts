import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findExecutable } from '../lib/proc';
import { gitIn } from '../updates/conch';
import { parseArgs, release, type ReleaseOptions } from './run';
import { verifyTag } from './signing';
import { commit, conchFiles, git, makeKey, signer } from './testing';

const dirs: string[] = [];
// The release's own git never sees the configuration of whoever runs the tests.
beforeEach(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', process.platform === 'win32' ? 'NUL' : '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const HEADER = '# The SSH keys Conch’s releases are signed with.\n';

/**
 * The maintainer's clone of a local bare "origin", with a few conventional
 * commits, a home with an SSH key in ~/.ssh, and a pretend gh that writes
 * down what it was asked. Never the real GitHub, never this repository.
 */
async function world({ signers = HEADER }: { signers?: string } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'conch-release-run-'));
  dirs.push(base);
  const origin = join(base, 'origin.git');
  const repo = join(base, 'conch');
  const home = join(base, 'home');
  await mkdir(join(home, '.ssh'), { recursive: true });
  const key = makeKey(join(home, '.ssh'), 'id_ed25519');
  git(base, 'init', '--quiet', '--bare', '-b', 'main', origin);
  git(base, 'clone', '--quiet', origin, repo);
  git(repo, 'checkout', '--quiet', '-b', 'main');
  // The tests' own git: no global configuration, so no signing key until one is set up.
  git(repo, 'config', 'user.email', 'ada@example.com');
  git(repo, 'config', 'user.name', 'Ada');
  commit(repo, conchFiles('0.2.0', signers), 'chore: the start');
  commit(repo, { 'a.txt': '1' }, 'feat(protocol): artifacts edited by hand');
  commit(repo, { 'b.txt': '1' }, 'feat(server): edit artifacts by hand, and live data');
  commit(repo, { 'c.txt': '1' }, 'feat(web): edit pages by hand, with a live preview');
  commit(repo, { 'd.txt': '1' }, 'fix(web): the composer keeps your draft after a restart');
  commit(repo, { 'e.txt': '1' }, 'test(e2e): editing by hand');
  git(repo, 'push', '--quiet', '-u', 'origin', 'main');
  const gh = join(base, 'gh.js');
  const ghLog = join(base, 'gh.log');
  writeFileSync(
    gh,
    `#!/usr/bin/env node\nrequire('fs').appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`,
  );
  chmodSync(gh, 0o755);
  const said: string[] = [];
  const answers: string[] = [];
  const asked: string[] = [];
  const go = (
    options: Partial<ReleaseOptions> = {},
    extra: { check?: () => Promise<boolean>; gh?: string | null } = {},
  ) =>
    release(
      { kind: 'stable', dryRun: false, ai: false, ...options },
      {
        root: repo,
        say: (line) => said.push(line),
        ask: async (question) => {
          asked.push(question);
          return answers.shift() ?? 'n';
        },
        check: extra.check ?? (async () => true),
        gh: async () => (extra.gh === null ? undefined : (extra.gh ?? gh)),
        home,
        today: () => '2026-10-02',
      },
    );
  return { base, origin, repo, home, key, said, answers, asked, go, ghLog };
}

const text = (said: string[]) => said.join('\n');

describe('reading pnpm release’s words', () => {
  it('takes the kind, the flags, and a version', () => {
    expect(parseArgs([])).toEqual({ kind: 'stable', dryRun: false, ai: true });
    expect(parseArgs(['beta', '--dry-run', '--no-ai'])).toEqual({
      kind: 'beta',
      dryRun: true,
      ai: false,
    });
    expect(parseArgs(['--version', 'v0.4.0'])).toMatchObject({ version: '0.4.0' });
    expect(parseArgs(['--version=1.0.0'])).toMatchObject({ version: '1.0.0' });
    expect(parseArgs(['--help'])).toEqual({ help: true });
    expect(parseArgs(['--sideways'])).toEqual({
      error: 'Unknown option: --sideways (try pnpm release --help)',
    });
  });
});

describe('pnpm release, end to end, against a local origin and a pretend gh', () => {
  it('a dry run shows the version, the notes and the commits, and changes nothing', async () => {
    const w = await world();
    const head = git(w.repo, 'rev-parse', 'HEAD');
    expect(await w.go({ dryRun: true })).toBe(0);
    const out = text(w.said);
    expect(out).toContain('Conch 0.3.0');
    expect(out).toContain('Edit pages by hand, with a live preview');
    expect(out).toContain('The composer keeps your draft after a restart');
    expect(out).not.toContain('Editing by hand');
    expect(out).toContain('fix(web): the composer keeps your draft after a restart');
    expect(out).toContain('A real release would offer to sign with');
    expect(out).toContain('Dry run: nothing was changed.');
    expect(w.asked).toEqual([]);
    expect(git(w.repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(w.repo, 'tag', '-l')).toBe('');
    expect(git(w.repo, 'status', '--porcelain')).toBe('');
  });

  it('the first release: sets up the SSH key, asks once, then commits, tags, pushes and makes the GitHub Release', async () => {
    const w = await world();
    w.answers.push('y', 'y');
    expect(await w.go()).toBe(0);
    expect(w.asked).toEqual([
      `Sign releases with ${join(w.home, '.ssh', 'id_ed25519.pub')} (this repository only)? (y/N) `,
      'Release v0.3.0? (y/N) ',
    ]);
    // Committed and tagged here…
    expect(git(w.repo, 'log', '-1', '--format=%s')).toBe('release: v0.3.0');
    expect(JSON.parse(readFileSync(join(w.repo, 'package.json'), 'utf8')).version).toBe('0.3.0');
    const changelog = readFileSync(join(w.repo, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toContain('## 0.3.0 — 2026-10-02');
    expect(changelog).toContain('### New\n\n- Edit pages by hand, with a live preview');
    expect(changelog).toContain('### Fixed\n\n- The composer keeps your draft after a restart');
    const signers = readFileSync(join(w.repo, 'release/allowed_signers'), 'utf8');
    expect(signers).toContain(
      `ada@example.com namespaces="git" ${w.key.pub.split(' ').slice(0, 2).join(' ')}`,
    );
    // …and on origin, as every install would see it: signed, and checked as they check it.
    expect(git(w.origin, 'rev-parse', 'main')).toBe(git(w.repo, 'rev-parse', 'HEAD'));
    const object = git(w.origin, 'rev-parse', 'refs/tags/v0.3.0');
    const verdict = await verifyTag(gitIn(w.origin, 'git'), {
      object,
      name: 'v0.3.0',
      signers,
      sshKeygen: await findExecutable('ssh-keygen'),
    });
    expect(verdict).toMatchObject({
      ok: true,
      message: expect.stringContaining('Conch 0.3.0\n\nNew\n- Edit pages by hand'),
    });
    const gh = readFileSync(w.ghLog, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as string[]);
    expect(gh).toHaveLength(1);
    expect(gh[0]?.slice(0, 4)).toEqual(['release', 'create', 'v0.3.0', '--title']);
    expect(gh[0]).not.toContain('--prerelease');
    expect(text(w.said)).toContain('Released v0.3.0.');
  });

  it('betas count up, and promoting one to stable is just pnpm release', async () => {
    const w = await world();
    w.answers.push('y', 'y');
    expect(await w.go({ kind: 'beta' })).toBe(0);
    expect(git(w.origin, 'tag', '-l')).toBe('v0.3.0-beta.1');
    commit(w.repo, { 'f.txt': '1' }, 'fix(server): a page reads again after a restart');
    git(w.repo, 'push', '--quiet', 'origin', 'main');
    w.answers.push('y');
    expect(await w.go({ kind: 'beta' })).toBe(0);
    expect(git(w.origin, 'tag', '-l').split('\n')).toEqual(['v0.3.0-beta.1', 'v0.3.0-beta.2']);
    const gh = readFileSync(w.ghLog, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as string[]);
    expect(gh.every((args) => args.includes('--prerelease'))).toBe(true);
    // beta.2's notes are what's new since beta.1.
    const beta2 = git(w.origin, 'cat-file', 'tag', 'v0.3.0-beta.2');
    expect(beta2).toContain('A page reads again after a restart');
    expect(beta2).not.toContain('Edit pages by hand');
    w.answers.push('y');
    expect(await w.go()).toBe(0);
    expect(git(w.origin, 'tag', '-l', 'v0.3.0')).toBe('v0.3.0');
    // The stable release tells everything since the last stable one.
    expect(git(w.origin, 'cat-file', 'tag', 'v0.3.0')).toContain('Edit pages by hand');
  });

  it('a breaking change is a heads-up, and a new minor before 1.0', async () => {
    const w = await world();
    git(
      w.repo,
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      'feat(server)!: settings move to a new file',
      '-m',
      'BREAKING CHANGE: Sign in again after updating.',
    );
    git(w.repo, 'push', '--quiet', 'origin', 'main');
    expect(await w.go({ dryRun: true })).toBe(0);
    expect(text(w.said)).toContain('Conch 0.3.0');
    expect(text(w.said)).toMatch(/Heads up\n\s+• Sign in again after updating/);
  });

  it('stops in one line when it can’t: another branch, changes, behind origin, a failing check, a no', async () => {
    const w = await world();
    git(w.repo, 'switch', '--quiet', '-c', 'idea');
    expect(await w.go()).toBe(1);
    expect(w.said.at(-1)).toBe('Releases are made from main; this is “idea”. Run: git switch main');
    git(w.repo, 'switch', '--quiet', 'main');
    writeFileSync(join(w.repo, 'a.txt'), 'changed');
    expect(await w.go()).toBe(1);
    expect(w.said.at(-1)).toBe('There are uncommitted changes. Commit or stash them first.');
    git(w.repo, 'checkout', '--quiet', '--', 'a.txt');
    commit(w.repo, { 'g.txt': '1' }, 'feat: not pushed');
    expect(await w.go()).toBe(1);
    expect(w.said.at(-1)).toMatch(/has commits origin doesn’t/);
    git(w.repo, 'push', '--quiet', 'origin', 'main');
    w.answers.push('y', 'y');
    expect(await w.go({}, { check: async () => false })).toBe(1);
    expect(w.said.at(-1)).toBe(
      'pnpm check didn’t pass, so nothing was changed. Run it to see why.',
    );
    expect(git(w.repo, 'log', '-1', '--format=%s')).toBe('feat: not pushed');
    w.answers.push('n');
    expect(await w.go()).toBe(1);
    expect(w.said.at(-1)).toBe('Nothing was changed.');
    expect(git(w.origin, 'tag', '-l')).toBe('');
  });

  it('refuses a key installs don’t trust, and says how to change keys', async () => {
    const other = makeKey(await mkdtemp(join(tmpdir(), 'conch-other-')), 'other');
    const w = await world({ signers: `${HEADER}${signer('bob@example.com', other)}\n` });
    w.answers.push('y');
    expect(await w.go()).toBe(1);
    expect(w.said.at(-1)).toMatch(
      /Your signing key isn’t in release\/allowed_signers, so installs would refuse this release/,
    );
    expect(git(w.repo, 'log', '-1', '--format=%s')).toBe('test(e2e): editing by hand');
  });

  it('with no gh, the tag carries the notes', async () => {
    const w = await world();
    w.answers.push('y', 'y');
    expect(await w.go({}, { gh: null })).toBe(0);
    expect(text(w.said)).toContain('No gh here, so no GitHub Release: the tag carries the notes.');
    expect(existsSync(w.ghLog)).toBe(false);
  });

  it('nothing to release, a version that exists, or one that isn’t newer', async () => {
    const w = await world();
    w.answers.push('y', 'y');
    await w.go();
    expect(await w.go()).toBe(1);
    expect(w.said.at(-1)).toBe('Nothing to release: no commits since v0.3.0.');
    expect(await w.go({ version: '0.3.0' })).toBe(1);
    expect(w.said.at(-1)).toBe('v0.3.0 already exists.');
    expect(await w.go({ version: '0.2.9' })).toBe(1);
    expect(w.said.at(-1)).toBe('0.2.9 isn’t newer than 0.3.0, the newest release.');
  });
});
