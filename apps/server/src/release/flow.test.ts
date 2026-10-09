/**
 * The release flow of ADR 0127, end to end on real git repositories and
 * real SSH keys: release-please's pull request gets Conch's notes, merging
 * it gets a signed tag every install takes, and the GitHub Release's page
 * says the same notes. release-please itself isn't run here; its branch is
 * made the way it makes it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findExecutable } from '../lib/proc';
import { gitIn } from '../updates/conch';
import { main } from './commands';
import { notesFor } from './history';
import { emptyNotes, parseNotes } from './notes';
import { releasePage } from './page';
import { CONFIG_FILE, MANIFEST_FILE, prBody, withoutReleaseAs, writePullRequestNotes } from './pr';
import { verifyTag } from './signing';
import { makeTag } from './tag';
import { commit, conchFiles, git, makeKey, signer, tag, type Key } from './testing';

const dirs: string[] = [];
beforeEach(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', process.platform === 'win32' ? 'NUL' : '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const REPO = 'georgevibing/conch-agent';
const CONFIG = {
  'release-type': 'node',
  prerelease: true,
  versioning: 'prerelease',
  'prerelease-type': 'alpha.1',
  'initial-version': '0.1.0-alpha.1',
  'pull-request-header': 'Merging this releases Conch.',
  'pull-request-footer': 'Made by release-please.',
  packages: { '.': { 'package-name': 'conch' } },
};

/** A Conch on main with a few conventional commits, its list trusting `trusted`. */
async function world({ trusted = true }: { trusted?: boolean } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'conch-release-flow-'));
  dirs.push(base);
  const origin = join(base, 'origin.git');
  const repo = join(base, 'conch');
  const ci = makeKey(base, 'conch-release');
  const other = makeKey(base, 'someone-else');
  git(base, 'init', '--quiet', '--bare', '-b', 'main', origin);
  git(base, 'clone', '--quiet', origin, repo);
  git(repo, 'checkout', '--quiet', '-b', 'main');
  commit(
    repo,
    {
      ...conchFiles('0.1.0', trusted ? `${signer('conch-release', ci)}\n` : '# no keys yet\n'),
      [CONFIG_FILE]: `${JSON.stringify(CONFIG, null, 2)}\n`,
      [MANIFEST_FILE]: '{}\n',
    },
    'chore: the start',
  );
  commit(repo, { 'a.txt': '1' }, 'feat(protocol): artifacts edited by hand');
  commit(repo, { 'b.txt': '1' }, 'feat(server): edit artifacts by hand, and live data');
  commit(repo, { 'c.txt': '1' }, 'feat(web): edit pages by hand, with a live preview');
  commit(repo, { 'd.txt': '1' }, 'fix(web): the composer keeps your draft after a restart');
  commit(repo, { 'e.txt': '1' }, 'test(e2e): editing by hand');
  git(repo, 'push', '--quiet', '-u', 'origin', 'main');
  const run = gitIn(repo, (await findExecutable('git')) ?? 'git');
  const sshKeygen = (await findExecutable('ssh-keygen')) ?? 'ssh-keygen';
  return { base, origin, repo, ci, other, git: run, sshKeygen };
}

/** release-please's branch, as it makes it: the version, the manifest and its own changelog. */
function releaseBranch(repo: string, version: string, extra: Record<string, string> = {}) {
  git(repo, 'checkout', '--quiet', '-B', 'release-please--branches--main', 'main');
  commit(
    repo,
    {
      'package.json': `${JSON.stringify({ name: 'conch', version, private: true }, null, 2)}\n`,
      [MANIFEST_FILE]: `${JSON.stringify({ '.': version }, null, 2)}\n`,
      'CHANGELOG.md': `# Changelog\n\n## ${version} (2026-10-09)\n\n### Features\n\n* **web:** edit pages by hand ([abc1234](https://example.com))\n`,
      ...extra,
    },
    `chore(main): release Conch ${version}`,
  );
}

/** Merging the release pull request. */
function merge(repo: string): string {
  git(repo, 'checkout', '--quiet', 'main');
  git(
    repo,
    'merge',
    '--quiet',
    '--no-ff',
    '-m',
    'Merge pull request #7',
    'release-please--branches--main',
  );
  return git(repo, 'rev-parse', 'HEAD');
}

const today = () => '2026-10-09';

describe('the release pull request', () => {
  it('gets Conch’s notes in place of release-please’s, in the shape release-please reads back', async () => {
    const w = await world();
    releaseBranch(w.repo, '0.1.0-alpha.1');
    const result = await writePullRequestNotes({
      root: w.repo,
      git: w.git,
      repository: REPO,
      ai: false,
      today,
    });
    expect(result.version).toBe('0.1.0-alpha.1');
    const changelog = readFileSync(join(w.repo, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toContain('# What’s new in Conch');
    expect(changelog).not.toContain('### Features');
    expect(changelog).toContain(
      `## [0.1.0-alpha.1](https://github.com/${REPO}/commits/v0.1.0-alpha.1) (2026-10-09)`,
    );
    expect(changelog).toContain('### New\n\n- Edit pages by hand, with a live preview');
    // The feature's own fix isn't a fix anyone saw; the housekeeping isn't there.
    expect(changelog).not.toContain('e2e');
    // release-please reads the version from the first heading between the two `---`.
    const [header, notes, footer] = result.body.split(/^---$/m);
    expect(header?.trim()).toBe('Merging this releases Conch.');
    expect(footer?.trim()).toBe('Made by release-please.');
    expect(/^#{2,} \[?(\d+\.\d+\.\d+[^\]]*)\]?/m.exec(notes?.trim() ?? '')?.[1]).toBe(
      '0.1.0-alpha.1',
    );
    expect(parseNotes(notes ?? '')).toEqual(result.notes);
    expect(result.files).toEqual(['CHANGELOG.md']);
  });

  it('builds on main’s changelog, newest first, and since the last release its channel saw', async () => {
    const w = await world();
    releaseBranch(w.repo, '0.1.0-alpha.1');
    await writePullRequestNotes({ root: w.repo, git: w.git, repository: REPO, ai: false, today });
    git(w.repo, 'commit', '--quiet', '-am', 'chore: Conch’s notes');
    const merged = merge(w.repo);
    git(w.repo, 'push', '--quiet', 'origin', 'main');
    await makeTag(w.git, {
      version: '0.1.0-alpha.1',
      commit: merged,
      key: readFileSync(w.ci.file, 'utf8'),
      sshKeygen: w.sshKeygen,
    });
    git(w.repo, 'fetch', '--quiet', 'origin');
    commit(w.repo, { 'f.txt': '1' }, 'fix(web): links open where they should');
    git(w.repo, 'push', '--quiet', 'origin', 'main');
    git(w.repo, 'fetch', '--quiet', 'origin');

    releaseBranch(w.repo, '0.1.0-alpha.2');
    const second = await writePullRequestNotes({
      root: w.repo,
      git: w.git,
      repository: REPO,
      ai: false,
      today,
    });
    expect(second.since?.version).toBe('0.1.0-alpha.1');
    expect(second.notes.fixed).toEqual(['Links open where they should']);
    expect(second.notes.new).toEqual([]);
    const changelog = readFileSync(join(w.repo, 'CHANGELOG.md'), 'utf8');
    expect(changelog.indexOf('[0.1.0-alpha.2]')).toBeLessThan(changelog.indexOf('[0.1.0-alpha.1]'));
    expect(changelog).toContain(
      `https://github.com/${REPO}/compare/v0.1.0-alpha.1...v0.1.0-alpha.2`,
    );
  });

  it('takes the one-off release-as out once it’s the version being released', async () => {
    const w = await world();
    releaseBranch(w.repo, '0.1.0-beta.1', {
      [CONFIG_FILE]: `${JSON.stringify({ ...CONFIG, 'release-as': '0.1.0-beta.1' }, null, 2)}\n`,
      // Where release-please puts notes too long for the description: Conch's fit there.
      'release-notes.md': '## 0.1.0-beta.1\n\n…a thousand commits…\n',
    });
    const result = await writePullRequestNotes({
      root: w.repo,
      git: w.git,
      repository: REPO,
      ai: false,
      today,
    });
    expect(result.files).toEqual(['CHANGELOG.md', CONFIG_FILE, 'release-notes.md']);
    expect(existsSync(join(w.repo, 'release-notes.md'))).toBe(false);
    expect(JSON.parse(readFileSync(join(w.repo, CONFIG_FILE), 'utf8'))).toEqual(CONFIG);
    expect(withoutReleaseAs(JSON.stringify({ 'release-as': '0.2.0' }), '0.1.0')).toBeUndefined();
    expect(
      JSON.parse(
        withoutReleaseAs(
          JSON.stringify({ packages: { '.': { 'release-as': '0.1.0' } } }),
          '0.1.0',
        ) ?? '',
      ),
    ).toEqual({ packages: { '.': {} } });
  });

  it('says it isn’t ready to merge while the list trusts no key, and the workflow fails on it', async () => {
    const w = await world({ trusted: false });
    releaseBranch(w.repo, '0.1.0-alpha.1');
    const result = await writePullRequestNotes({
      root: w.repo,
      git: w.git,
      repository: REPO,
      ai: false,
      today,
    });
    expect(result.problems).toHaveLength(1);
    const [header, notes] = result.body.split(/^---$/m);
    expect(header).toContain('**Not ready to merge:** release/allowed_signers has no release key');
    // Below the header release-please reads nothing of it.
    expect(notes).not.toContain('Not ready');
    const flag = join(w.base, 'not-ready');
    const deps = {
      root: w.repo,
      say: () => {},
      ask: async () => 'n',
      home: w.base,
      env: { GITHUB_REPOSITORY: REPO },
    };
    expect(
      await main(
        ['ci', 'notes', '--body-file', join(w.base, 'b.md'), '--not-ready-file', flag],
        deps,
      ),
    ).toBe(0);
    expect(readFileSync(flag, 'utf8')).toMatch(/no release key/);
  });

  it('refuses a branch that isn’t release-please’s', async () => {
    const w = await world();
    await expect(
      writePullRequestNotes({ root: w.repo, git: w.git, repository: REPO, ai: false, today }),
    ).rejects.toThrow(/doesn’t name a version/);
  });

  it('writes an empty header and footer as empty, keeping the shape', () => {
    expect(prBody({}, '## 0.1.0 (d)\n\n### New\n\n- A')).toBe(
      '\n---\n\n\n## 0.1.0 (d)\n\n### New\n\n- A\n\n---\n\n',
    );
  });
});

describe('the signed tag', () => {
  async function merged(w: Awaited<ReturnType<typeof world>>) {
    releaseBranch(w.repo, '0.1.0-alpha.1');
    await writePullRequestNotes({ root: w.repo, git: w.git, repository: REPO, ai: false, today });
    git(w.repo, 'commit', '--quiet', '-am', 'chore: Conch’s notes');
    return merge(w.repo);
  }
  const keyOf = (k: Key) => readFileSync(k.file, 'utf8');

  it('is one every install takes, carrying the notes the pull request had', async () => {
    const w = await world();
    const at = await merged(w);
    const tagged = await makeTag(w.git, {
      version: '0.1.0-alpha.1',
      commit: at,
      key: keyOf(w.ci),
      sshKeygen: w.sshKeygen,
    });
    expect(tagged.kind).toBe('made');
    // Checked as an install checks it: the list as committed in the installed copy.
    const verdict = await verifyTag(w.git, {
      object: tagged.object,
      name: 'v0.1.0-alpha.1',
      signers: git(w.repo, 'show', `${at}:release/allowed_signers`),
      sshKeygen: w.sshKeygen,
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.commit).toBe(at);
    expect(verdict.signer).toBe('conch-release');
    const changelog = git(w.repo, 'show', `${at}:CHANGELOG.md`);
    const fromTag = parseNotes(verdict.message);
    expect(emptyNotes(fromTag)).toBe(false);
    expect(changelog).toContain(`- ${fromTag.new[0]}`);
    expect(git(w.repo, 'cat-file', '-p', tagged.object)).toContain(
      'tagger Conch releases <41898282+github-actions[bot]@users.noreply.github.com>',
    );
  });

  it('is left as it is when a run before made it, and refused when it isn’t this release’s', async () => {
    const w = await world();
    const at = await merged(w);
    const key = keyOf(w.ci);
    await makeTag(w.git, { version: '0.1.0-alpha.1', commit: at, key, sshKeygen: w.sshKeygen });
    expect(
      (await makeTag(w.git, { version: '0.1.0-alpha.1', commit: at, key, sshKeygen: w.sshKeygen }))
        .kind,
    ).toBe('there');
    git(w.repo, 'tag', '-d', 'v0.1.0-alpha.1');
    tag(w.repo, 'v0.1.0-alpha.1', 'Conch 0.1.0-alpha.1\n');
    await expect(
      makeTag(w.git, { version: '0.1.0-alpha.1', commit: at, key, sshKeygen: w.sshKeygen }),
    ).rejects.toThrow(/there already, and .* isn’t signed/);
  });

  it('isn’t made with a key the list doesn’t trust, or when the list trusts none', async () => {
    const w = await world();
    const at = await merged(w);
    await expect(
      makeTag(w.git, {
        version: '0.1.0-alpha.1',
        commit: at,
        key: keyOf(w.other),
        sshKeygen: w.sshKeygen,
      }),
    ).rejects.toThrow(/isn’t trusted by release\/allowed_signers at this release/);
    expect(git(w.repo, 'tag', '-l')).toBe('');
    await expect(
      makeTag(w.git, {
        version: '0.1.0-alpha.1',
        commit: at,
        key: 'not a key',
        sshKeygen: w.sshKeygen,
      }),
    ).rejects.toThrow(/isn’t an SSH private key/);

    const bare = await world({ trusted: false });
    const at2 = await merged(bare);
    await expect(
      makeTag(bare.git, {
        version: '0.1.0-alpha.1',
        commit: at2,
        key: keyOf(bare.ci),
        sshKeygen: bare.sshKeygen,
      }),
    ).rejects.toThrow(/has no release key/);
  });

  it('passes the list installs already have, so a new key only signs once a release trusts it', async () => {
    const w = await world();
    const ci = keyOf(w.ci);
    const other = keyOf(w.other);
    const first = await merged(w);
    await makeTag(w.git, {
      version: '0.1.0-alpha.1',
      commit: first,
      key: ci,
      sshKeygen: w.sshKeygen,
    });
    // The list moves to the new key alone: the release before doesn't trust it.
    const swapped = commit(
      w.repo,
      { 'release/allowed_signers': `${signer('someone-else', w.other)}\n` },
      'build(release): the new key',
    );
    await expect(
      makeTag(w.git, {
        version: '0.1.0-alpha.2',
        commit: swapped,
        key: other,
        sshKeygen: w.sshKeygen,
      }),
    ).rejects.toThrow(/isn’t trusted by v0\.1\.0-alpha\.1, the release before/);
    await expect(
      makeTag(w.git, {
        version: '0.1.0-alpha.2',
        commit: swapped,
        key: ci,
        sshKeygen: w.sshKeygen,
      }),
    ).rejects.toThrow(/isn’t trusted by release\/allowed_signers at this release/);
    // Rotating as ADR 0051 says: both keys, signed with the old one; then the new one may sign.
    const both = commit(
      w.repo,
      {
        'release/allowed_signers': `${signer('conch-release', w.ci)}\n${signer('someone-else', w.other)}\n`,
      },
      'build(release): both keys',
    );
    expect(
      (
        await makeTag(w.git, {
          version: '0.1.0-alpha.2',
          commit: both,
          key: ci,
          sshKeygen: w.sshKeygen,
        })
      ).kind,
    ).toBe('made');
    const next = commit(w.repo, { 'g.txt': '1' }, 'fix: one more');
    expect(
      (
        await makeTag(w.git, {
          version: '0.1.0-alpha.3',
          commit: next,
          key: other,
          sshKeygen: w.sshKeygen,
        })
      ).signer,
    ).toBe('someone-else');
  });

  it('is never a version Conch doesn’t release', async () => {
    const w = await world();
    const at = await merged(w);
    await expect(
      makeTag(w.git, {
        version: '0.1.0-rc.1',
        commit: at,
        key: keyOf(w.ci),
        sshKeygen: w.sshKeygen,
      }),
    ).rejects.toThrow(/isn’t a version Conch releases/);
  });

  it('writes the notes from the commits when the changelog has none', async () => {
    const w = await world();
    const at = git(w.repo, 'rev-parse', 'HEAD');
    const tagged = await makeTag(w.git, {
      version: '0.1.0',
      commit: at,
      key: keyOf(w.ci),
      sshKeygen: w.sshKeygen,
    });
    const message = git(w.repo, 'cat-file', '-p', tagged.object);
    expect(message).toContain('New\n- Edit pages by hand, with a live preview');
    expect((await notesFor(w.git, '0.1.0', { head: at })).notes.new).toEqual(
      parseNotes(message).new,
    );
  });
});

describe('the GitHub Release’s page', () => {
  const notes = { headsUp: [], new: ['Edit pages by hand'], better: [], fixed: ['Links open'] };

  it('says the notes the updater reads, then how to install and check it', () => {
    const page = releasePage({
      version: '0.4.0-beta.2',
      notes,
      repository: REPO,
      signed: { mac: false, windows: false },
    });
    expect(parseNotes(page)).toEqual(notes);
    expect(page).toContain('| CONCH_CHANNEL=beta sh');
    expect(page).toContain(`gh attestation verify <file> --repo ${REPO}`);
    expect(page).toContain('sha256sum -c SHA256SUMS');
    expect(page).toContain('conch-0.4.0-beta.2.spdx.json');
    expect(page).toContain('isn’t code-signed for macOS or Windows yet');
  });

  it('says nothing about signing once both are signed, and no channel for a stable release', () => {
    const page = releasePage({
      version: '0.4.0',
      notes,
      repository: REPO,
      signed: { mac: true, windows: true },
    });
    expect(page).not.toContain('code-signed');
    expect(page).not.toContain('CONCH_CHANNEL');
    expect(
      releasePage({
        version: '0.4.0',
        notes,
        repository: REPO,
        signed: { mac: true, windows: false },
      }),
    ).toContain('for Windows yet, so it asks once before opening it.');
  });
});

describe('pnpm release ci', () => {
  it('runs the workflow’s steps: notes, tag and page', async () => {
    const w = await world();
    releaseBranch(w.repo, '0.1.0-alpha.1');
    const said: string[] = [];
    const deps = {
      root: w.repo,
      say: (line: string) => said.push(line),
      ask: async () => 'n',
      home: w.base,
      env: { GITHUB_REPOSITORY: REPO, RELEASE_SIGNING_KEY: readFileSync(w.ci.file, 'utf8') },
      gh: async () => undefined,
    };
    const body = join(w.base, 'body.md');
    expect(await main(['ci', 'notes', '--body-file', body], deps)).toBe(0);
    expect(readFileSync(body, 'utf8')).toContain('## [0.1.0-alpha.1]');
    git(w.repo, 'commit', '--quiet', '-am', 'chore: Conch’s notes');
    const at = merge(w.repo);
    expect(await main(['ci', 'tag', '--version', '0.1.0-alpha.1', '--commit', at], deps)).toBe(0);
    expect(said.at(-1)).toBe(
      'Signed v0.1.0-alpha.1 as conch-release; it passes the check installs make.',
    );
    const page = join(w.base, 'page.md');
    expect(
      await main(['ci', 'page', '--version', '0.1.0-alpha.1', '--out', page], {
        ...deps,
        env: { ...deps.env, MAC_SIGNED: 'true' },
      }),
    ).toBe(0);
    expect(readFileSync(page, 'utf8')).toContain('isn’t code-signed for Windows yet');
    expect(
      await main(['ci', 'tag', '--version', '0.1.0-alpha.1', '--commit', at], {
        ...deps,
        env: { GITHUB_REPOSITORY: REPO },
      }),
    ).toBe(1);
    expect(said.at(-1)).toMatch(/RELEASE_SIGNING_KEY isn’t set/);
  });

  it('commits a channel change, with a Release-As footer when the change alone is the release', async () => {
    const w = await world();
    git(w.repo, 'config', 'user.email', 'ada@example.com');
    git(w.repo, 'config', 'user.name', 'Ada');
    const said: string[] = [];
    const deps = {
      root: w.repo,
      say: (l: string) => said.push(l),
      ask: async () => 'n',
      home: w.base,
      env: {},
    };
    const head = () => git(w.repo, 'log', '-1', '--format=%B');
    // Whatever else is staged stays staged, out of these commits.
    writeFileSync(join(w.repo, 'other.txt'), 'mine\n');
    git(w.repo, 'add', 'other.txt');

    expect(await main(['channel', 'beta'], deps)).toBe(0);
    expect(said).toContain('The first release will be 0.1.0-beta.1.');
    expect(head().trim()).toBe('chore(release): betas from now on');
    const config = JSON.parse(git(w.repo, 'show', `HEAD:${CONFIG_FILE}`)) as Record<
      string,
      unknown
    >;
    expect(config).toMatchObject({
      'prerelease-type': 'beta.1',
      'initial-version': '0.1.0-beta.1',
    });

    tag(w.repo, 'v0.1.0-beta.1', 'Conch 0.1.0-beta.1\n', w.ci);
    git(w.repo, 'push', '--quiet', 'origin', 'v0.1.0-beta.1');
    expect(await main(['channel', 'stable'], deps)).toBe(0);
    expect(head()).toContain('Release-As: 0.1.0');
    expect(await main(['channel', 'stable'], deps)).toBe(0);
    expect(said.at(-1)).toMatch(/^Releases are stable ones already\./);

    // The footer waiting would still decide: changing course again is refused until it's gone.
    expect(await main(['channel', 'beta'], deps)).toBe(1);
    expect(said.at(-1)).toMatch(/says Release-As: 0\.1\.0, which isn’t released yet/);
    expect(JSON.parse(git(w.repo, 'show', `HEAD:${CONFIG_FILE}`)).prerelease).toBe(false);

    expect(await main(['as', '0.0.9'], deps)).toBe(1);
    expect(await main(['as', 'v1.0.0'], deps)).toBe(0);
    expect(head()).toBe('chore(release): release 1.0.0 next\n\nRelease-As: 1.0.0');
    expect(git(w.repo, 'diff', '--cached', '--name-only')).toBe('other.txt');
    expect(await main(['channel', 'nightly'], deps)).toBe(1);
    expect(await main(['nope'], deps)).toBe(1);
  });
});

describe('pnpm release key', () => {
  it('hands GitHub a key only once the newest release trusts it', async () => {
    const w = await world();
    git(w.repo, 'config', 'user.email', 'ada@example.com');
    git(w.repo, 'config', 'user.name', 'Ada');
    tag(w.repo, 'v0.1.0-alpha.1', 'Conch 0.1.0-alpha.1\n', w.ci);
    git(w.repo, 'push', '--quiet', 'origin', 'v0.1.0-alpha.1');
    const home = join(w.base, 'home');
    mkdirSync(join(home, '.ssh'), { recursive: true });
    const said: string[] = [];
    const asked: string[] = [];
    const deps = {
      root: w.repo,
      say: (l: string) => said.push(l),
      ask: async (q: string) => {
        asked.push(q);
        return 'n';
      },
      home,
      env: {},
      gh: async () => '/bin/false',
    };
    // A new computer, a new key: it joins the list, and GitHub keeps the one it has.
    expect(await main(['key'], deps)).toBe(0);
    const list = readFileSync(join(w.repo, 'release/allowed_signers'), 'utf8');
    expect(list).toContain('conch-release namespaces="git" ssh-ed25519');
    expect(list.split('\n').filter((l) => l.includes('namespaces')).length).toBe(2);
    expect(asked).toEqual([]);
    expect(said.join('\n')).toMatch(/v0\.1\.0-alpha\.1 doesn’t trust this key yet/);

    // Once a release carries the list, the same command offers to hand it over.
    commit(w.repo, {}, 'build(release): the new key');
    tag(w.repo, 'v0.1.0-alpha.2', 'Conch 0.1.0-alpha.2\n', w.ci);
    git(w.repo, 'push', '--quiet', 'origin', 'main', 'v0.1.0-alpha.2');
    expect(await main(['key'], deps)).toBe(0);
    expect(asked).toHaveLength(1);
    expect(said.join('\n')).toContain('Using the release key made before');
  });
});
