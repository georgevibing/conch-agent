import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ConchCheckout,
  explainFetch,
  findCheckout,
  findPnpm,
  installProgress,
  overwritten,
  type UpdateProgressReport,
} from './conch';

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Ada',
  GIT_AUTHOR_EMAIL: 'ada@example.com',
  GIT_COMMITTER_NAME: 'Ada',
  GIT_COMMITTER_EMAIL: 'ada@example.com',
  GIT_TERMINAL_PROMPT: '0',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
    cwd,
    env: ENV,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
}

/**
 * A stand-in pnpm: records each run in `pnpm.log` next to it, and fails a
 * step when the checkout has a `fail-<step>` file (so a commit can carry the
 * failure, and going back removes it).
 */
const PNPM = `
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const step = args.includes('build') ? 'build' : 'install';
fs.appendFileSync(path.join(__dirname, 'pnpm.log'), step + ' ' + fs.readFileSync('version.txt', 'utf8').trim() + '\\n');
if (step === 'install') console.log('Progress: resolved 10, reused 5, downloaded 0, added 5');
if (fs.existsSync('fail-' + step)) { console.error('ERR_PNPM something broke'); process.exitCode = 1; }
`;

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A bare origin, Conch's clone of it, and another clone to push new commits from. */
async function world() {
  const base = await mkdtemp(join(tmpdir(), 'conch-update-'));
  dirs.push(base);
  const origin = join(base, 'origin.git');
  const conch = join(base, 'conch');
  const upstream = join(base, 'upstream');
  git(base, 'init', '--quiet', '--bare', '-b', 'main', origin);
  git(base, 'clone', '--quiet', origin, upstream);
  git(upstream, 'checkout', '--quiet', '-b', 'main');
  await writeFile(join(upstream, 'version.txt'), '1\n');
  await writeFile(join(upstream, 'pnpm-workspace.yaml'), 'packages: []\n');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '--quiet', '-m', 'feat: the first version');
  git(upstream, 'push', '--quiet', '-u', 'origin', 'main');
  git(base, 'clone', '--quiet', origin, conch);
  const pnpmScript = join(base, 'pnpm.js');
  await writeFile(pnpmScript, PNPM);
  const checkout = new ConchCheckout(conch, {
    pnpm: () => Promise.resolve({ command: process.execPath, prefix: [pnpmScript] }),
  });
  /** Commit in the upstream clone and push, like a new release. */
  const release = async (subject: string, files: Record<string, string> = {}) => {
    for (const [name, text] of Object.entries(files)) await writeFile(join(upstream, name), text);
    git(upstream, 'add', '-A');
    git(upstream, 'commit', '--quiet', '--allow-empty', '-m', subject);
    git(upstream, 'push', '--quiet', 'origin', 'main');
  };
  const log = async () =>
    existsSync(join(base, 'pnpm.log'))
      ? (await readFile(join(base, 'pnpm.log'), 'utf8')).trim()
      : '';
  return { base, conch, origin, upstream, checkout, release, log };
}

const steps = () => {
  const seen: UpdateProgressReport[] = [];
  return { seen, onProgress: (p: UpdateProgressReport) => seen.push(p) };
};

// These drive real git against temporary repositories: dozens of processes per
// test, which is slow on Windows while the rest of the suite runs alongside.
vi.setConfig({ testTimeout: 60_000 });

describe('checking for Conch’s own updates', () => {
  it('says it’s up to date when nothing new is upstream', async () => {
    const { checkout } = await world();
    const check = await checkout.check({ fetch: true });
    expect(check).toMatchObject({ behind: 0, ahead: 0, fetched: true, branch: 'main' });
    expect(check.blocked).toBeUndefined();
    expect(check.problem).toBeUndefined();
  });

  it('counts what’s waiting, and says what’s new in plain words, without the noise', async () => {
    const { checkout, release } = await world();
    await release('feat(web): attach files, pictures and long pastes to a message (#412)');
    await release('chore: bump dependencies');
    await release('test(e2e): wait for the first-run save');
    await release('fix(server): terminals heal a spawn helper that lost its execute bit.');
    await release('docs: attachments (ADR 0017)');
    const check = await checkout.check({ fetch: true });
    expect(check.behind).toBe(5);
    expect(check.improvements).toBe(2);
    expect(check.whatsNew).toEqual([
      'Terminals heal a spawn helper that lost its execute bit',
      'Attach files, pictures and long pastes to a message',
    ]);
    expect(check.blocked).toBeUndefined();
  });

  it('reads what the last fetch brought without the network', async () => {
    const { checkout, release } = await world();
    await release('feat: something new');
    expect((await checkout.check({ fetch: false })).behind).toBe(0);
    await checkout.check({ fetch: true });
    expect(await checkout.check({ fetch: false })).toMatchObject({ behind: 1, fetched: false });
  });

  it('says quietly that it couldn’t check when the upstream can’t be reached', async () => {
    const { checkout, conch, base } = await world();
    git(conch, 'remote', 'set-url', 'origin', join(base, 'gone.git'));
    const check = await checkout.check({ fetch: true });
    expect(check.fetched).toBe(false);
    expect(check.problem).toMatch(/couldn’t (reach|check)/);
  });

  it('explains a fetch that failed in words, never a prompt', () => {
    const failed = (stderr: string) => ({ stdout: '', stderr, code: 128 });
    expect(
      explainFetch(
        failed(
          "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
        ),
        'https://github.com/ada/conch.git',
      ),
    ).toBe('Conch couldn’t check for updates: GitHub asked for a sign-in.');
    expect(
      explainFetch(failed('fatal: unable to access: Could not resolve host: github.com')),
    ).toBe('Conch couldn’t reach the internet to check for updates.');
    expect(
      explainFetch(
        failed('git@git.example.com: Permission denied (publickey).'),
        'git@git.example.com:a/b',
      ),
    ).toMatch(/git\.example\.com asked for a sign-in/);
    expect(explainFetch({ stdout: '', stderr: '', code: undefined })).toMatch(/took too long/);
  });

  it('won’t offer one press over local changes, and says what to run instead', async () => {
    const { checkout, conch, release } = await world();
    await release('feat: something new');
    await writeFile(join(conch, 'version.txt'), 'mine\n');
    const check = await checkout.check({ fetch: true });
    expect(check.blocked?.reason).toMatch(/changes that aren’t saved in git \(1 file\)/);
    expect(check.blocked?.command).toBe(
      [`cd "${conch}"`, 'git stash', 'git pull --ff-only', 'git stash pop', 'pnpm install'].join(
        '\n',
      ),
    );
  });

  it('won’t merge: a folder with commits of its own is refused', async () => {
    const { checkout, conch, release } = await world();
    await release('feat: something new');
    await writeFile(join(conch, 'local.txt'), 'mine\n');
    git(conch, 'add', '.');
    git(conch, 'commit', '--quiet', '-m', 'my own change');
    const check = await checkout.check({ fetch: true });
    expect(check).toMatchObject({ ahead: 1, behind: 1 });
    expect(check.blocked?.reason).toMatch(/1 commit of its own/);
    expect(check.blocked?.command).toContain('git pull --rebase');
  });

  it('needs a branch that follows an upstream', async () => {
    const { checkout, conch } = await world();
    git(conch, 'checkout', '--quiet', '-b', 'mine');
    const check = await checkout.check({ fetch: true });
    expect(check.blocked?.reason).toMatch(/“mine” doesn’t follow one/);
    expect(check.blocked?.command).toContain('git branch --set-upstream-to=origin/mine');
    git(conch, 'checkout', '--quiet', '--detach');
    expect((await checkout.check({ fetch: true })).blocked?.reason).toMatch(/isn’t on a branch/);
  });
});

describe('updating Conch itself', () => {
  it('moves forward to what it checked, installs and rebuilds, with progress', async () => {
    const { checkout, conch, release, log } = await world();
    const before = git(conch, 'rev-parse', 'HEAD');
    await release('feat: a calmer restart screen', { 'version.txt': '2\n' });
    const { seen, onProgress } = steps();
    const result = await checkout.update(onProgress);
    expect(result).toMatchObject({
      kind: 'updated',
      from: before,
      to: git(conch, 'rev-parse', 'origin/main'),
      whatsNew: ['A calmer restart screen'],
    });
    expect(git(conch, 'rev-parse', 'HEAD')).toBe(git(conch, 'rev-parse', 'origin/main'));
    expect(await log()).toBe('install 2\nbuild 2');
    expect([...new Set(seen.map((s) => s.label))]).toEqual([
      'Getting the update',
      'Installing',
      'Getting the new look ready',
    ]);
    expect(seen.find((s) => s.phase === 'install' && s.percent === 50)).toBeDefined();
  });

  it('does nothing when there’s nothing new', async () => {
    const { checkout, log } = await world();
    expect(await checkout.update(() => undefined)).toEqual({ kind: 'current' });
    expect(await log()).toBe('');
  });

  it('refuses over local changes and leaves them exactly as they were', async () => {
    const { checkout, conch, release, log } = await world();
    await release('feat: something new', { 'version.txt': '2\n' });
    await writeFile(join(conch, 'version.txt'), 'mine\n');
    const result = await checkout.update(() => undefined);
    expect(result).toMatchObject({ kind: 'refused', reason: expect.stringMatching(/could lose/) });
    expect(await readFile(join(conch, 'version.txt'), 'utf8')).toBe('mine\n');
    expect(await log()).toBe('');
  });

  it('refuses when the folder has diverged, and never merges', async () => {
    const { checkout, conch, release } = await world();
    await release('feat: something new');
    await writeFile(join(conch, 'local.txt'), 'mine\n');
    git(conch, 'add', '.');
    git(conch, 'commit', '--quiet', '-m', 'my own change');
    const head = git(conch, 'rev-parse', 'HEAD');
    expect(await checkout.update(() => undefined)).toMatchObject({ kind: 'refused' });
    expect(git(conch, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('goes back to the version you had when installing fails', async () => {
    const { checkout, conch, release, log } = await world();
    const before = git(conch, 'rev-parse', 'HEAD');
    await release('feat: a broken release', { 'version.txt': '2\n', 'fail-install': 'x' });
    const { seen, onProgress } = steps();
    const result = await checkout.update(onProgress);
    expect(result).toEqual({
      kind: 'rolled-back',
      message:
        'The update didn’t install (installing its parts didn’t work), so Conch went back to the version you had.',
    });
    expect(git(conch, 'rev-parse', 'HEAD')).toBe(before);
    expect(existsSync(join(conch, 'fail-install'))).toBe(false);
    // The old parts were put back: install ran again on the old version.
    expect(await log()).toBe('install 2\ninstall 1');
    expect(seen.at(-1)).toMatchObject({
      phase: 'rollback',
      label: 'Going back to the version you had',
    });
  });

  it('goes back, and rebuilds what you had, when the new version won’t build', async () => {
    const { checkout, conch, release, log } = await world();
    const before = git(conch, 'rev-parse', 'HEAD');
    await release('feat: doesn’t build', { 'version.txt': '2\n', 'fail-build': 'x' });
    const result = await checkout.update(() => undefined);
    expect(result).toMatchObject({
      kind: 'rolled-back',
      message: expect.stringMatching(/wouldn’t build/),
    });
    expect(git(conch, 'rev-parse', 'HEAD')).toBe(before);
    expect(await log()).toBe('install 2\nbuild 2\ninstall 1\nbuild 1');
  });

  it('moves to exactly the commit it checked, even when more arrives meanwhile', async () => {
    const { checkout, conch, release, log } = await world();
    await release('feat: what was listed', { 'version.txt': '2\n' });
    const check = checkout.check.bind(checkout);
    let listed: Awaited<ReturnType<typeof checkout.check>> | undefined;
    // Right after the check, another fetch (the daily one, a terminal) brings a newer commit.
    vi.spyOn(checkout, 'check').mockImplementation(async (options) => {
      listed = await check(options);
      await release('feat: arrived after the check', { 'version.txt': '3\n' });
      git(conch, 'fetch', '--quiet', 'origin');
      return listed;
    });
    const result = await checkout.update(() => undefined);
    expect(listed).toMatchObject({ behind: 1, whatsNew: ['What was listed'] });
    expect(listed?.target).toMatch(/^[0-9a-f]{40}$/);
    expect(result).toMatchObject({
      kind: 'updated',
      to: listed?.target,
      whatsNew: ['What was listed'],
    });
    // What arrived is what was listed, not the commit fetched after it.
    expect(git(conch, 'rev-parse', 'HEAD')).toBe(listed?.target);
    expect(git(conch, 'rev-parse', 'HEAD')).not.toBe(git(conch, 'rev-parse', 'origin/main'));
    expect((await readFile(join(conch, 'version.txt'), 'utf8')).trim()).toBe('2');
    expect(await log()).toBe('install 2\nbuild 2');
  });

  it('never writes over a file git ignores, and says what to move', async () => {
    const { checkout, conch, release, log } = await world();
    // Yours, ignored by git in this folder: a `.env` with your own settings.
    await writeFile(join(conch, '.git', 'info', 'exclude'), '.env\n');
    await writeFile(join(conch, '.env'), 'MINE=1\n');
    const before = git(conch, 'rev-parse', 'HEAD');
    await release('feat: ships an example .env', { '.env': 'THEIRS=1\n', 'version.txt': '2\n' });
    const result = await checkout.update(() => undefined);
    expect(result).toMatchObject({
      kind: 'refused',
      reason: expect.stringMatching(/would replace a file of yours in Conch’s folder \(\.env\)/),
    });
    expect(await readFile(join(conch, '.env'), 'utf8')).toBe('MINE=1\n');
    expect(git(conch, 'rev-parse', 'HEAD')).toBe(before);
    expect(await log()).toBe('');
  });

  it('leaves the folder alone if it changed while updating, and says what to run', async () => {
    const { conch, release } = await world();
    await release('feat: a broken release', { 'version.txt': '2\n', 'fail-install': 'x' });
    // Someone edits a file while the install runs.
    const edit = new ConchCheckout(conch, {
      pnpm: () => Promise.resolve({ command: process.execPath, prefix: ['-e', ''] }),
      stream: async () => {
        await writeFile(join(conch, 'version.txt'), 'edited meanwhile\n');
        return { code: 1, tail: 'failed' };
      },
    });
    const result = await edit.update(() => undefined);
    expect(result).toMatchObject({
      kind: 'failed',
      message: expect.stringMatching(/changed meanwhile, so Conch left it as it is/),
      command: expect.stringContaining('git reset --keep'),
    });
    expect(await readFile(join(conch, 'version.txt'), 'utf8')).toBe('edited meanwhile\n');
  });
});

describe('finding Conch’s folder', () => {
  it('walks up from the gateway’s code to the workspace root, unless told otherwise', () => {
    const root = findCheckout(import.meta.dirname);
    expect(root && existsSync(join(root, 'pnpm-workspace.yaml'))).toBe(true);
    expect(findCheckout(import.meta.dirname, '/somewhere/else')).toMatch(/somewhere[\\/]else$/);
  });

  it('reads which files git won’t write over', () => {
    expect(
      overwritten(
        'error: The following untracked working tree files would be overwritten by merge:\n\t.env\n\tnotes/todo.md\nPlease move or remove them before you merge.\nAborting\n',
      ),
    ).toEqual(['.env', 'notes/todo.md']);
    expect(overwritten('fatal: Not possible to fast-forward, aborting.')).toEqual([]);
  });

  it('reads pnpm’s install progress', () => {
    expect(installProgress('Progress: resolved 838, reused 830, downloaded 8, added 419')).toBe(50);
    expect(installProgress('Already up to date')).toBeUndefined();
  });
});

describe('finding pnpm', () => {
  it('falls back to the corepack beside Node, as the installer leaves it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conch-corepack-'));
    const node = join(dir, 'node');
    const corepack = join(dir, process.platform === 'win32' ? 'corepack.cmd' : 'corepack');
    await writeFile(node, '');
    await writeFile(corepack, '#!/bin/sh\n', { mode: 0o755 });
    const path = process.env.PATH;
    process.env.PATH = '';
    try {
      const found = await findPnpm({}, node);
      // A pnpm somewhere this computer always looks is used first; otherwise corepack's.
      if (found && !found.prefix.includes('pnpm')) return;
      expect(found?.prefix.at(-1)).toBe('pnpm');
      expect([found?.command, ...(found?.prefix ?? [])].join(' ')).toContain(corepack);
    } finally {
      process.env.PATH = path;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
