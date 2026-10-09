import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { TYPES, check, problem, skipped } from './commits.mjs';

const script = fileURLToPath(new URL('./commits.mjs', import.meta.url));

test('subjects in the repository’s own style pass', () => {
  for (const subject of [
    'feat(web): the composer remembers what you were typing',
    'fix: Health asks Conch again before saying it can’t respond',
    'fix(server,web): Google sign-in from a phone finishes',
    'fix(server, web): two scopes with a space',
    'feat!: settings move to ~/.conch/settings.json',
    'feat(nacre)!: Button loses its old variant names',
    'test(e2e): the first chat’s memory step is named by what it did',
    'chore(main): release Conch 1.0.0',
    'ci: bump the actions group across 1 directory with 2 updates',
    'docs(adr/0051): a scope with a slash',
    'revert: the new composer, until the paste bug is fixed',
  ]) {
    assert.equal(problem(subject), null, subject);
  }
  for (const type of TYPES) assert.equal(problem(`${type}: something`), null, type);
});

test('each kind of mistake gets its own plain reason', () => {
  const cases = [
    ['Update stuff', /start with a type and a colon/],
    ['', /empty/],
    ['wip(agents): prompt layers', /"wip" isn't one of the types: feat, fix/],
    ['feature: a longer type', /"feature" isn't one of the types/],
    ['Fix: capitals', /lowercase: "fix"/],
    ['fix:no space', /space after the colon/],
    ['fix:  two spaces', /one space after the colon/],
    ['fix: ', /say what changed/],
    ['fix(): empty scope', /scope is empty/],
    ['fix(Web): capital scope', /scope in lowercase/],
    ['fix(web stuff): a space in the scope', /scope in lowercase/],
    ['fix (web): space before the scope', /start with a type and a colon/],
    ['fix(web) : space before the colon', /start with a type and a colon/],
  ];
  for (const [subject, reason] of cases) {
    assert.match(problem(subject) ?? 'passed', reason, JSON.stringify(subject));
  }
});

test('subjects git writes itself, and ones squashed away, are skipped', () => {
  for (const subject of [
    "Merge branch 'worktree-agent-a43648700497dc00f' into integrate-ux6",
    "Merge remote-tracking branch 'origin/main' into integrate-ux6",
    'Merge pull request #12 from someone/branch',
    'Revert "feat(web): the new composer"',
    'fixup! feat(web): the new composer',
    'squash! fix: something',
    'amend! fix: something',
  ]) {
    assert.ok(skipped(subject), subject);
  }
  assert.ok(!skipped('Merging is hard'));
  assert.ok(!skipped('Reverted the composer'));
});

function repository(subjects) {
  const dir = mkdtempSync(join(tmpdir(), 'conch-commits-'));
  const git = (...args) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        GIT_CONFIG_GLOBAL: devNull,
        GIT_CONFIG_NOSYSTEM: '1',
      },
    });
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'chore: the start');
  git('checkout', '-q', '-b', 'topic');
  for (const subject of subjects) git('commit', '-q', '--allow-empty', '-m', subject);
  // A merge from main into the branch, as people do to catch up.
  git('checkout', '-q', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'feat: meanwhile on main');
  git('checkout', '-q', 'topic');
  git('merge', '-q', '--no-ff', '--no-edit', 'main');
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a range is checked commit by commit, without merges or what main already has', () => {
  const repo = repository([
    'feat(web): a good one',
    'Update stuff',
    'fixup! feat(web): a good one',
    'fix:no space',
  ]);
  try {
    const { lines, failures } = check({ range: 'main..topic', cwd: repo.dir });
    assert.equal(failures, 2);
    assert.match(lines[0] ?? '', /^[0-9a-f]{7,} "Update stuff": start with a type/);
    assert.match(lines[1] ?? '', /"fix:no space": put a space after the colon\.$/);
    assert.match(
      lines.at(-1) ?? '',
      /2 subjects need a fix \(checked 3 commit subjects, skipping 1 merge, revert or fixup commit\)/,
    );
    assert.match(lines.at(-1) ?? '', /git rebase -i/);
    assert.equal(lines.length, 3);
  } finally {
    repo.done();
  }
});

test('the title is checked like a subject, and a GitHub revert title passes', () => {
  const repo = repository(['feat(web): a good one']);
  try {
    let result = check({ range: 'main..topic', title: 'Some changes', cwd: repo.dir });
    assert.equal(result.failures, 1);
    assert.match(
      result.lines[0] ?? '',
      /^The title "Some changes": start with a type.*re-run this check\.$/,
    );
    assert.doesNotMatch(result.lines.at(-1) ?? '', /rebase/);

    result = check({
      range: 'main..topic',
      title: 'Revert "feat(web): a good one"',
      cwd: repo.dir,
    });
    assert.equal(result.failures, 0);
    assert.deepEqual(result.lines, [
      'Checked 1 commit subject and the title: all follow Conventional Commits.',
    ]);
  } finally {
    repo.done();
  }
});

test('from the command line: exit 0 when fine, 1 for bad subjects, 2 for a bad range', () => {
  const repo = repository(['feat: fine']);
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], { cwd: repo.dir, encoding: 'utf8' });
  try {
    let result = run('main..topic', '--title', 'feat: fine too');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /all follow Conventional Commits/);

    result = run('main..topic', '--title=Fine');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /The title "Fine"/);

    result = run('nowhere..topic');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /nowhere/);

    result = run('--output=/tmp/x');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown option/);
  } finally {
    repo.done();
  }
});
