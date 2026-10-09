import { describe, expect, it } from 'vitest';

import { ToolLabel, type ActivityChip, type ActivityEffect } from './activity';
import { describeTool, type ToolResult } from './activity-describe';
import {
  baseName,
  baseOfIng,
  clip,
  favicon,
  folderName,
  fromPhrase,
  ing,
  notDone,
  past,
  quote,
  say,
  shortPath,
  trimEnd,
} from './activity-describe/words';

const ok = (output = ''): ToolResult => ({ status: 'success', output });
const err = (output = ''): ToolResult => ({ status: 'error', output });

/** Every label checked against the wire's own schema, whatever the case. */
function label(name: string, input: unknown, result?: ToolResult): ToolLabel {
  const made = describeTool(name, input, result);
  expect(() => ToolLabel.parse(made)).not.toThrow();
  return made;
}

/** What to expect: any part of a label, effects and chips matched by their parts too. */
type Want = Omit<Partial<ToolLabel>, 'effects' | 'chips'> & {
  effects?: Partial<ActivityEffect>[];
  chips?: Partial<ActivityChip>[];
};

type Case = [
  title: string,
  name: string,
  input: unknown,
  result: ToolResult | undefined,
  want: Want,
];

const bash = (command: string, extra: Record<string, unknown> = {}) => ({ command, ...extra });

describe('verbs', () => {
  it.each([
    ['run', 'running', 'ran'],
    ['read', 'reading', 'read'],
    ['write', 'writing', 'wrote'],
    ['make', 'making', 'made'],
    ['stop', 'stopping', 'stopped'],
    ['commit', 'committing', 'committed'],
    ['edit', 'editing', 'edited'],
    ['fix', 'fixing', 'fixed'],
    ['copy', 'copying', 'copied'],
    ['play', 'playing', 'played'],
    ['tie', 'tying', 'tied'],
    ['see', 'seeing', 'saw'],
    ['rebuild', 'rebuilding', 'rebuilt'],
    ['undo', 'undoing', 'undid'],
    ['rerun', 'rerunning', 'reran'],
    ['relay', 'relaying', 'relayed'],
    ['set', 'setting', 'set'],
    ['panic', 'panicking', 'panicked'],
    ['visit', 'visiting', 'visited'],
    ['scan', 'scanning', 'scanned'],
    ['push', 'pushing', 'pushed'],
    ['force-push', 'force-pushing', 'force-pushed'],
    ['debug', 'debugging', 'debugged'],
    ['find', 'finding', 'found'],
    ['build', 'building', 'built'],
    ['check', 'checking', 'checked'],
    ['format', 'formatting', 'formatted'],
    ['open', 'opening', 'opened'],
    ['be', 'being', 'was'],
  ])('%s → %s, %s', (verb, doing, done) => {
    expect(ing(verb)).toBe(doing);
    expect(past(verb)).toBe(done);
  });

  it.each([
    ['running', 'run'],
    ['making', 'make'],
    ['writing', 'write'],
    ['testing', 'test'],
    ['reading', 'read'],
    ['stopping', 'stop'],
    ['lying', 'lie'],
    ['coding', 'code'],
    ['buying', 'buy'],
    ['dying', 'die'],
  ])('%s comes from %s', (word, base) => expect(baseOfIng(word)).toBe(base));

  it('keeps a capital and writes all three ways', () => {
    expect(ing('Run')).toBe('Running');
    expect(say('push', 'to main')).toEqual({
      doing: 'Pushing to main',
      done: 'Pushed to main',
      tried: 'Couldn’t push to main',
    });
  });

  it.each([
    [say('run', 'the tests'), 'Didn’t run the tests'],
    [say('read', 'notes.md'), 'Didn’t read notes.md'],
    [say('send', 'an email'), 'Didn’t send an email'],
    [say('write', 'a.ts'), 'Didn’t write a.ts'],
    [say('force-push', 'to main'), 'Didn’t force-push to main'],
    [
      { doing: 'Making a picture', done: 'Made a picture', tried: 'Made a picture' },
      'Didn’t make a picture',
    ],
    [{ doing: 'Buying shoes', done: 'Bought shoes', tried: 'Bought shoes' }, 'Didn’t buy shoes'],
    [{ doing: 'Stopping it', done: 'Stopped it', tried: 'Stopped it' }, 'Didn’t stop it'],
    [
      { doing: 'GitHub release', done: 'GitHub release', tried: 'GitHub release' },
      'Didn’t go ahead: gitHub release',
    ],
  ])('%o never ran: %s', (said, not) => expect(notDone(said)).toBe(not));

  it.each([
    ['Run unit tests', 'Running unit tests', 'Ran unit tests'],
    ['Check git status', 'Checking git status', 'Checked git status'],
    ['List files in directory', 'Listing files in directory', 'Listed files in directory'],
    ['Install dependencies.', 'Installing dependencies', 'Installed dependencies'],
    ['Show recent commits', 'Showing recent commits', 'Showed recent commits'],
    ['Running the build', 'Running the build', 'Ran the build'],
    ['Find TypeScript files', 'Finding TypeScript files', 'Found TypeScript files'],
    ['Write the config', 'Writing the config', 'Wrote the config'],
  ])('“%s” said both ways', (phrase, doing, done) => {
    expect(fromPhrase(phrase)).toMatchObject({ doing, done });
  });

  it.each(['The tests', 'Tests the parser', 'git status', 'Updated the config', '', '   ', '123'])(
    '“%s” is not an instruction',
    (phrase) => expect(fromPhrase(phrase)).toBeUndefined(),
  );
});

const SHELL: Case[] = [
  // The real transcript's commands.
  [
    'a Python heredoc that edits one file',
    'Bash',
    bash(
      "python3 - <<'PY'\nfrom pathlib import Path\np = Path('apps/web/src/features/chat/Transcript.tsx')\ns = p.read_text()\ns = s.replace('old', 'new')\np.write_text(s)\nPY",
    ),
    ok(''),
    {
      family: 'edit',
      doing: 'Editing Transcript.tsx',
      done: 'Edited Transcript.tsx',
      subject: "python3 - <<'PY'",
      effects: [
        {
          kind: 'file',
          text: 'Changed Transcript.tsx',
          target: 'apps/web/src/features/chat/Transcript.tsx',
        },
      ],
    },
  ],
  [
    'a Python heredoc that runs git',
    'Bash',
    bash(
      "python3 - <<'PY'\nimport subprocess\nout = subprocess.run(['git', 'status', '--short'], capture_output=True, text=True)\nprint(out.stdout)\nPY",
    ),
    undefined,
    { family: 'explore', doing: 'Checking what’s changed', done: 'Checked what’s changed' },
  ],
  [
    'a Python heredoc that reads',
    'Bash',
    bash(
      "python3 - <<'PY'\nimport json\ndata = json.load(open('package.json'))\nprint(data['name'])\nPY",
    ),
    undefined,
    { family: 'explore', done: 'Read package.json' },
  ],
  [
    'a Python heredoc with nothing to tell',
    'Bash',
    bash("python3 - <<'PY'\nprint(2 + 2)\nPY"),
    undefined,
    { family: 'run', doing: 'Running a Python script', done: 'Ran a Python script' },
  ],
  [
    'a Python heredoc that walks the tree',
    'Bash',
    bash(
      "python3 <<'EOF'\nimport os\nfor root, dirs, files in os.walk('.'):\n    print(root)\nEOF",
    ),
    undefined,
    { family: 'explore', done: 'Looked through the files' },
  ],
  [
    'python -c',
    'Bash',
    bash(
      `python3 -c "import urllib.request; print(urllib.request.urlopen('https://example.com/x').read())"`,
    ),
    undefined,
    { family: 'research', done: 'Fetched example.com' },
  ],
  [
    'git -C with a long path',
    'Bash',
    bash('git -C /home/yiotis/projects/conch-agent status --short'),
    ok(' M apps/web/src/a.ts\n M b.ts\n?? c.ts\n'),
    {
      family: 'explore',
      done: 'Checked what’s changed',
      outcome: '3 changed files',
      subject: 'git -C /home/yiotis/projects/conch-agent status --short',
    },
  ],
  [
    'a clean status',
    'Bash',
    bash('git status'),
    ok('On branch main\nnothing to commit, working tree clean\n'),
    { outcome: 'No changes' },
  ],
  [
    'git diff of a file',
    'Bash',
    bash('git diff -- src/parser.ts'),
    undefined,
    { done: 'Looked at the changes to parser.ts' },
  ],
  [
    'git diff --stat',
    'Bash',
    bash('git diff --stat'),
    ok(' a | 2 +-\n b | 4 ++--\n 2 files changed, 3 insertions(+), 3 deletions(-)\n'),
    { done: 'Looked at the changes', outcome: '2 files changed' },
  ],
  [
    'git diff --cached',
    'Bash',
    bash('git diff --cached'),
    undefined,
    { done: 'Looked at the staged changes' },
  ],
  [
    'git log',
    'Bash',
    bash('git log --oneline -5'),
    ok('1dfc1e13 feat: a\n69fda815 feat: b\n33b44813 fix: c\n'),
    { done: 'Looked at recent commits', outcome: '3 commits' },
  ],
  ['git show', 'Bash', bash('git show HEAD~1'), undefined, { done: 'Looked at a commit' }],
  [
    'git show a file',
    'Bash',
    bash('git show main:src/app.ts'),
    undefined,
    { done: 'Read app.ts as it was' },
  ],
  [
    'git add',
    'Bash',
    bash('git add -A'),
    undefined,
    { family: 'ship', done: 'Staged the changes' },
  ],
  [
    'git add files',
    'Bash',
    bash('git add src/a.ts src/b.ts'),
    undefined,
    { done: 'Staged a.ts and b.ts' },
  ],
  [
    'git commit -m',
    'Bash',
    bash('git commit -m "Fix the date parsing"'),
    ok('[main 3f2a1bc] Fix the date parsing\n 2 files changed, 5 insertions(+), 1 deletion(-)\n'),
    {
      family: 'ship',
      doing: 'Committing the changes',
      done: 'Committed “Fix the date parsing”',
      outcome: '2 files changed',
      effects: [
        {
          kind: 'commit',
          text: 'Committed “Fix the date parsing”',
          target: 'Fix the date parsing',
        },
      ],
    },
  ],
  [
    'git commit with a heredoc message',
    'Bash',
    bash(
      `git commit -m "$(cat <<'EOF'\nfeat(protocol): tool labels on the wire\n\nLonger body.\nEOF\n)"`,
    ),
    undefined,
    { done: 'Committed “feat(protocol): tool labels on the wire”' },
  ],
  [
    'git commit with nothing to commit',
    'Bash',
    bash('git commit -am "x"'),
    err('On branch main\nnothing to commit, working tree clean'),
    { outcome: 'Nothing to commit', failed: false },
  ],
  [
    'git commit --amend',
    'Bash',
    bash('git commit --amend --no-edit'),
    undefined,
    { done: 'Amended the last commit' },
  ],
  [
    'git push to a branch',
    'Bash',
    bash('git push origin main'),
    ok('To github.com:george/conch.git\n   1dfc1e1..69fda81  main -> main\n'),
    {
      family: 'ship',
      doing: 'Pushing to main',
      done: 'Pushed to main',
      effects: [{ kind: 'push', text: 'Pushed to main', target: 'main' }],
    },
  ],
  [
    'git push without a branch learns it from the output',
    'Bash',
    bash('git push'),
    ok('To github.com:george/conch.git\n   1dfc1e1..69fda81  feat/stories -> feat/stories\n'),
    {
      done: 'Pushed to feat/stories',
      effects: [{ kind: 'push', text: 'Pushed to feat/stories', target: 'feat/stories' }],
    },
  ],
  [
    'git push with nothing new',
    'Bash',
    bash('git push'),
    ok('Everything up-to-date\n'),
    { outcome: 'Already up to date' },
  ],
  [
    'git push rejected',
    'Bash',
    bash('git push origin main'),
    err(' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs'),
    { done: 'Couldn’t push to main', outcome: 'The remote has newer commits', failed: true },
  ],
  [
    'git push --force',
    'Bash',
    bash('git push --force-with-lease origin fix/x'),
    undefined,
    { done: 'Force-pushed to fix/x' },
  ],
  [
    'git push -u',
    'Bash',
    bash('git push -u origin HEAD:feat/a'),
    undefined,
    { done: 'Pushed to feat/a' },
  ],
  [
    'add, commit and push in one go',
    'Bash',
    bash('git add -A && git commit -m "fix: the parser" && git push'),
    ok(
      '[main abc1234] fix: the parser\n 3 files changed, 10 insertions(+)\nTo github.com:x/y.git\n   abc1234..def5678  main -> main\n',
    ),
    {
      family: 'ship',
      doing: 'Committing and pushing to main',
      done: 'Committed and pushed to main',
      outcome: '3 files changed',
      effects: [
        { kind: 'commit', text: 'Committed “fix: the parser”' },
        { kind: 'push', text: 'Pushed to main' },
      ],
    },
  ],
  [
    'git pull',
    'Bash',
    bash('git pull --rebase'),
    ok('Already up to date.\n'),
    { done: 'Pulled the latest changes', outcome: 'Already up to date' },
  ],
  [
    'git fetch',
    'Bash',
    bash('git fetch origin'),
    undefined,
    { done: 'Fetched the latest from the remote' },
  ],
  [
    'git checkout -b',
    'Bash',
    bash('git checkout -b feat/stories'),
    undefined,
    { done: 'Made branch feat/stories' },
  ],
  ['git switch', 'Bash', bash('git switch main'), undefined, { done: 'Switched to main' }],
  [
    'git checkout a file',
    'Bash',
    bash('git checkout -- src/app.ts'),
    undefined,
    { family: 'edit', done: 'Undid the changes to app.ts' },
  ],
  ['git restore', 'Bash', bash('git restore .'), undefined, { done: 'Undid the changes' }],
  [
    'git restore --staged',
    'Bash',
    bash('git restore --staged a.ts'),
    undefined,
    { done: 'Unstaged a.ts' },
  ],
  [
    'git branch -D',
    'Bash',
    bash('git branch -D old'),
    ok(''),
    { done: 'Deleted branch old', effects: [{ kind: 'delete', text: 'Deleted branch old' }] },
  ],
  ['git branch', 'Bash', bash('git branch -a'), undefined, { done: 'Looked at the branches' }],
  ['git stash', 'Bash', bash('git stash'), undefined, { done: 'Put the changes aside' }],
  [
    'git stash pop',
    'Bash',
    bash('git stash pop'),
    undefined,
    { done: 'Brought back the stashed changes' },
  ],
  [
    'git merge',
    'Bash',
    bash('git merge feat/x'),
    undefined,
    { family: 'ship', done: 'Merged feat/x' },
  ],
  [
    'git rebase',
    'Bash',
    bash('git rebase origin/main'),
    undefined,
    { done: 'Rebased onto origin/main' },
  ],
  [
    'git rebase --continue',
    'Bash',
    bash('git rebase --continue'),
    undefined,
    { done: 'Continued the rebase' },
  ],
  [
    'git reset --hard',
    'Bash',
    bash('git reset --hard HEAD'),
    ok(''),
    { done: 'Threw away local changes', effects: [{ kind: 'delete' }] },
  ],
  [
    'git reset HEAD~1',
    'Bash',
    bash('git reset HEAD~1'),
    undefined,
    { done: 'Undid the last commit' },
  ],
  [
    'git clone',
    'Bash',
    bash('git clone https://github.com/anthropics/claude-code.git'),
    undefined,
    { done: 'Cloned claude-code' },
  ],
  [
    'git grep',
    'Bash',
    bash('git grep -n "tellStories"'),
    undefined,
    { done: 'Searched the code for “tellStories”' },
  ],
  ['git tag', 'Bash', bash('git tag v1.2.0'), undefined, { done: 'Tagged v1.2.0' }],
  [
    'git rev-parse',
    'Bash',
    bash('git rev-parse --abbrev-ref HEAD'),
    undefined,
    { done: 'Checked the repo' },
  ],
  [
    'git blame',
    'Bash',
    bash('git blame src/a.ts'),
    undefined,
    { done: 'Looked at who changed a.ts' },
  ],
  [
    'git cherry-pick',
    'Bash',
    bash('git cherry-pick abc123'),
    undefined,
    { done: 'Copied a commit over' },
  ],
  [
    'gh pr create',
    'Bash',
    bash('gh pr create --title "Stories in the chat" --body "x"'),
    ok('https://github.com/x/y/pull/12'),
    {
      family: 'ship',
      done: 'Opened a pull request',
      effects: [{ kind: 'publish', text: 'Opened a pull request “Stories in the chat”' }],
    },
  ],
  [
    'gh pr view',
    'Bash',
    bash('gh pr view 12'),
    undefined,
    { family: 'research', done: 'Looked at pull request #12' },
  ],
  [
    'gh pr checks',
    'Bash',
    bash('gh pr checks 12'),
    undefined,
    { family: 'verify', done: 'Checked the checks on pull request #12' },
  ],
  ['gh run watch', 'Bash', bash('gh run watch'), undefined, { done: 'Watched the CI run' }],
  [
    'gh issue create',
    'Bash',
    bash('gh issue create -t "Bug" -b "x"'),
    ok(''),
    { family: 'connect', effects: [{ kind: 'send', text: 'Opened an issue “Bug”' }] },
  ],
  ['gh api', 'Bash', bash('gh api repos/x/y/pulls'), undefined, { done: 'Asked GitHub' }],

  // Package managers.
  [
    'pnpm install',
    'Bash',
    bash('pnpm install'),
    ok('Already up to date\n'),
    { family: 'run', done: 'Installed the dependencies', outcome: 'Already up to date' },
  ],
  [
    'npm ci',
    'Bash',
    bash('npm ci'),
    ok('added 812 packages in 9s'),
    { done: 'Installed the dependencies', outcome: '812 packages added' },
  ],
  [
    'pnpm add',
    'Bash',
    bash('pnpm add -D vitest@5'),
    ok('Packages: +12\n'),
    {
      done: 'Added vitest',
      outcome: '12 packages added',
      effects: [{ kind: 'install', text: 'Installed vitest', target: 'vitest@5' }],
    },
  ],
  [
    'npm install two',
    'Bash',
    bash('npm install react react-dom'),
    undefined,
    { done: 'Added react and react-dom' },
  ],
  ['yarn add many', 'Bash', bash('yarn add a b c d'), undefined, { done: 'Added 4 packages' }],
  [
    'scoped packages',
    'Bash',
    bash('pnpm add @conch/protocol@workspace:*'),
    undefined,
    { done: 'Added @conch/protocol' },
  ],
  [
    'pnpm remove',
    'Bash',
    bash('pnpm remove lodash'),
    ok(''),
    { done: 'Removed lodash', effects: [{ kind: 'delete', text: 'Removed lodash' }] },
  ],
  [
    'pnpm test with a filter',
    'Bash',
    bash(
      'cd /home/yiotis/projects/conch-agent && pnpm --filter @conch/protocol test 2>&1 | tail -20',
    ),
    ok(
      ' ✓ src/a.test.ts (3)\n\n Test Files  80 passed (80)\n      Tests  241 passed (241)\n   Start at  12:00:00\n',
    ),
    { family: 'verify', doing: 'Running the tests', done: 'Ran the tests', outcome: '241 passed' },
  ],
  [
    'npm test',
    'Bash',
    bash('npm test'),
    err('Exit code 1\n Tests  2 failed | 239 passed (241)\n'),
    { done: 'Ran the tests', outcome: '2 failed', failed: true },
  ],
  ['npm run test:unit', 'Bash', bash('npm run test:unit'), undefined, { done: 'Ran the tests' }],
  [
    'pnpm typecheck',
    'Bash',
    bash('pnpm typecheck'),
    ok(''),
    { family: 'verify', done: 'Checked the types', outcome: 'No type errors' },
  ],
  [
    'pnpm lint',
    'Bash',
    bash('pnpm lint'),
    err('✖ 5 problems (3 errors, 2 warnings)\n'),
    { done: 'Ran the linter', outcome: '3 problems', failed: true },
  ],
  [
    'pnpm build',
    'Bash',
    bash('pnpm build'),
    ok('vite v7 building for production…\n✓ built in 1.2s'),
    { done: 'Built the project' },
  ],
  [
    'pnpm check',
    'Bash',
    bash('pnpm check'),
    ok(''),
    { done: 'Ran the checks', outcome: 'All passed' },
  ],
  [
    'pnpm format',
    'Bash',
    bash('pnpm format'),
    undefined,
    { family: 'edit', done: 'Formatted the code' },
  ],
  [
    'pnpm dev',
    'Bash',
    bash('pnpm dev'),
    undefined,
    { family: 'run', done: 'Started the dev server' },
  ],
  [
    'npm run a custom script',
    'Bash',
    bash('npm run gen:icons'),
    undefined,
    { done: 'Ran the gen:icons script' },
  ],
  [
    'pnpm exec tsc',
    'Bash',
    bash('pnpm exec tsc --noEmit'),
    undefined,
    { done: 'Checked the types' },
  ],
  [
    'npx prettier --check',
    'Bash',
    bash('npx prettier --check .'),
    err('[warn] Code style issues found in 3 files. Run Prettier with --write to fix.'),
    { done: 'Checked the formatting', outcome: '3 files to format', failed: true },
  ],
  [
    'npx prettier --write',
    'Bash',
    bash('npx prettier --write src/a.ts'),
    undefined,
    { family: 'edit', done: 'Formatted a.ts' },
  ],
  [
    'npm publish',
    'Bash',
    bash('npm publish'),
    ok(''),
    { family: 'ship', effects: [{ kind: 'publish', text: 'Published the package' }] },
  ],
  [
    'typecheck and test together',
    'Bash',
    bash('pnpm typecheck && pnpm test'),
    undefined,
    { done: 'Ran the checks' },
  ],

  // Test runners and checkers.
  [
    'vitest run a file',
    'Bash',
    bash('npx vitest run src/activity.test.ts'),
    ok(' Tests  12 passed (12)'),
    { done: 'Ran the tests in activity.test.ts', outcome: '12 passed' },
  ],
  [
    'jest',
    'Bash',
    bash('jest'),
    err('Tests:       1 failed, 5 passed, 6 total'),
    { outcome: '1 failed', failed: true },
  ],
  [
    'pytest',
    'Bash',
    bash('pytest -q'),
    err('..F..\n=========== 1 failed, 4 passed in 0.12s ===========\n'),
    { done: 'Ran the tests', outcome: '1 failed', failed: true },
  ],
  [
    'python -m pytest',
    'Bash',
    bash('python -m pytest tests/'),
    ok('5 passed in 0.31s\n'),
    { outcome: '5 passed' },
  ],
  [
    'go test',
    'Bash',
    bash('go test ./...'),
    ok('ok  \tgithub.com/x/a\t0.1s\nok  \tgithub.com/x/b\t0.2s\n'),
    { done: 'Ran the tests', outcome: '2 packages passed' },
  ],
  [
    'go test failing',
    'Bash',
    bash('go test ./...'),
    err('--- FAIL: TestX\nFAIL\tgithub.com/x/a\t0.1s\nok  \tgithub.com/x/b\t0.2s\n'),
    { outcome: '1 package failed', failed: true },
  ],
  [
    'cargo test',
    'Bash',
    bash('cargo test'),
    ok('test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured\n'),
    { outcome: '12 passed' },
  ],
  ['mocha', 'Bash', bash('mocha'), ok('\n  5 passing (20ms)\n'), { outcome: '5 passed' }],
  [
    'unittest',
    'Bash',
    bash('python -m unittest'),
    err('Ran 5 tests in 0.010s\n\nFAILED (failures=2)\n'),
    { outcome: '2 failed', failed: true },
  ],
  [
    'tsc --noEmit',
    'Bash',
    bash('tsc --noEmit -p .'),
    err('src/a.ts(1,1): error TS2322: x\nsrc/b.ts(2,2): error TS2345: y\n'),
    { done: 'Checked the types', outcome: '2 type errors', failed: true },
  ],
  [
    'tsc found errors',
    'Bash',
    bash('npx tsc'),
    err('Found 14 errors in 3 files.'),
    { outcome: '14 type errors' },
  ],
  [
    'eslint clean',
    'Bash',
    bash('eslint .'),
    ok(''),
    { done: 'Ran the linter', outcome: 'No problems' },
  ],
  [
    'eslint warnings only',
    'Bash',
    bash('eslint .'),
    ok('✖ 2 problems (0 errors, 2 warnings)'),
    { outcome: '2 warnings' },
  ],
  ['ruff', 'Bash', bash('ruff check .'), ok('All checks passed!'), { outcome: 'No problems' }],
  [
    'mypy',
    'Bash',
    bash('mypy src'),
    ok('Success: no issues found in 12 source files'),
    { outcome: 'No type errors' },
  ],
  ['cargo build', 'Bash', bash('cargo build --release'), undefined, { done: 'Built the project' }],
  ['make test', 'Bash', bash('make test'), undefined, { done: 'Ran the tests' }],
  [
    'make with a target',
    'Bash',
    bash('make docs-serve'),
    undefined,
    { done: 'Ran make docs-serve' },
  ],
  ['make alone', 'Bash', bash('make -j4'), undefined, { done: 'Built the project' }],
  ['gradle', 'Bash', bash('./gradlew test'), undefined, { done: 'Ran the tests' }],

  // Looking around.
  [
    'ls',
    'Bash',
    bash('ls -la'),
    ok('total 8\ndrwxr-xr-x a\n-rw-r--r-- b\n'),
    { family: 'explore', done: 'Looked through the folder', outcome: '2 items' },
  ],
  [
    'ls a folder',
    'Bash',
    bash('ls /Users/kaltsgea/pworkspace/conch-agent/packages/protocol/src'),
    undefined,
    { done: 'Looked through src' },
  ],
  ['ls home', 'Bash', bash('ls ~'), undefined, { done: 'Looked through your home folder' }],
  ['tree', 'Bash', bash('tree -L 2 apps'), undefined, { done: 'Looked through apps' }],
  [
    'find by name',
    'Bash',
    bash(`find . -name "*.test.ts" -not -path "*/node_modules/*"`),
    ok('a.test.ts\nb.test.ts\n'),
    { done: 'Looked for files named “*.test.ts”', outcome: '2 files' },
  ],
  [
    'find a folder',
    'Bash',
    bash('find apps/web -type f'),
    undefined,
    { done: 'Looked through web' },
  ],
  [
    'find and delete',
    'Bash',
    bash('find . -name "*.orig" -delete'),
    ok(''),
    { family: 'edit', effects: [{ kind: 'delete' }] },
  ],
  [
    'cat a file',
    'Bash',
    bash('cat /home/yiotis/projects/conch-agent/package.json'),
    undefined,
    {
      family: 'explore',
      done: 'Read package.json',
      chips: [{ kind: 'file', label: 'package.json' }],
    },
  ],
  ['head', 'Bash', bash('head -n 50 src/app.ts'), undefined, { done: 'Read app.ts' }],
  [
    'sed -n',
    'Bash',
    bash("sed -n '1,120p' apps/web/src/features/chat/Transcript.tsx"),
    undefined,
    { done: 'Read Transcript.tsx' },
  ],
  ['tail -f', 'Bash', bash('tail -f server.log'), undefined, { done: 'Watched server.log' }],
  ['two files', 'Bash', bash('cat a.md b.md'), undefined, { done: 'Read a.md and b.md' }],
  ['wc -l', 'Bash', bash('wc -l src/*.ts'), undefined, { done: 'Counted the lines in *.ts' }],
  [
    'grep in a folder',
    'Bash',
    bash('grep -rn "describeTool" packages/'),
    ok('a:1:x\nb:2:y\n'),
    { done: 'Searched packages for “describeTool”', outcome: '2 matches' },
  ],
  [
    'rg with escapes',
    'Bash',
    bash('rg -n "blocks\\(" apps/web/src'),
    ok('a:1:x\nb:2:y\nc:3:z\n'),
    { done: 'Searched src for “blocks(”', outcome: '3 matches' },
  ],
  ['rg everywhere', 'Bash', bash('rg "TODO"'), undefined, { done: 'Searched the code for “TODO”' }],
  [
    'grep in one file',
    'Bash',
    bash('grep -n "export" src/index.ts'),
    undefined,
    { done: 'Searched index.ts for “export”', chips: [{ kind: 'file', label: 'index.ts' }] },
  ],
  [
    'grep finding nothing',
    'Bash',
    bash('grep -rn nothinghere src'),
    err(''),
    { outcome: 'No matches', failed: false, done: 'Searched src for “nothinghere”' },
  ],
  ['rg -l', 'Bash', bash('rg -l "x" src'), ok('a.ts\nb.ts\n'), { outcome: '2 files' }],
  ['grep -c', 'Bash', bash('grep -c "x" a.ts'), ok('7\n'), { outcome: '7 matches' }],
  [
    'a pipeline is its first program',
    'Bash',
    bash('git log --oneline | head -20'),
    undefined,
    { done: 'Looked at recent commits' },
  ],
  ['ps | grep', 'Bash', bash('ps aux | grep node'), undefined, { done: 'Checked what’s running' }],
  [
    'lsof a port',
    'Bash',
    bash('lsof -i :3000'),
    undefined,
    { done: 'Checked what’s using port 3000' },
  ],
  ['which', 'Bash', bash('which pnpm'), undefined, { done: 'Looked for pnpm' }],
  ['a version', 'Bash', bash('node --version'), undefined, { done: 'Checked the Node version' }],
  ['pwd', 'Bash', bash('pwd'), undefined, { done: 'Checked the current folder' }],
  [
    'du',
    'Bash',
    bash('du -sh node_modules'),
    undefined,
    { done: 'Checked how much space node_modules takes' },
  ],

  // Changing files.
  [
    'mkdir',
    'Bash',
    bash('mkdir -p src/activity-describe'),
    undefined,
    { family: 'edit', done: 'Made the activity-describe folder' },
  ],
  [
    'touch',
    'Bash',
    bash('touch notes.md'),
    ok(''),
    { done: 'Created notes.md', effects: [{ kind: 'file', text: 'Created notes.md' }] },
  ],
  ['cp', 'Bash', bash('cp a.ts b.ts'), undefined, { done: 'Copied a.ts to b.ts' }],
  [
    'mv to rename',
    'Bash',
    bash('mv src/old.ts src/new.ts'),
    ok(''),
    {
      done: 'Renamed old.ts to new.ts',
      effects: [{ kind: 'file', text: 'Renamed old.ts to new.ts' }],
    },
  ],
  [
    'mv to a folder',
    'Bash',
    bash('mv a.ts b.ts lib/'),
    undefined,
    { done: 'Moved a.ts and b.ts to lib' },
  ],
  [
    'rm',
    'Bash',
    bash('rm -rf dist build'),
    ok(''),
    {
      family: 'edit',
      done: 'Deleted dist and build',
      effects: [
        { kind: 'delete', text: 'Deleted dist', target: 'dist' },
        { kind: 'delete', text: 'Deleted build' },
      ],
    },
  ],
  [
    'rm failing',
    'Bash',
    bash('rm missing.txt'),
    err('rm: missing.txt: No such file or directory'),
    {
      done: 'Couldn’t delete missing.txt',
      failed: true,
      outcome: 'Failed: rm: missing.txt: No such file or directory',
    },
  ],
  [
    'chmod +x',
    'Bash',
    bash('chmod +x scripts/check.sh'),
    undefined,
    { done: 'Made check.sh runnable' },
  ],
  [
    'sed -i',
    'Bash',
    bash("sed -i '' 's/a/b/' src/app.ts"),
    ok(''),
    { family: 'edit', done: 'Edited app.ts', effects: [{ kind: 'file', text: 'Changed app.ts' }] },
  ],
  [
    'cat > file heredoc',
    'Bash',
    bash("cat > notes.md <<'EOF'\n# Notes\nEOF"),
    ok(''),
    { family: 'edit', done: 'Wrote notes.md', effects: [{ kind: 'file', text: 'Wrote notes.md' }] },
  ],
  [
    'echo >> file',
    'Bash',
    bash('echo "x" >> .gitignore'),
    undefined,
    { done: 'Added to .gitignore' },
  ],
  [
    'tar -x',
    'Bash',
    bash('tar -xzf release.tar.gz'),
    undefined,
    { done: 'Unpacked release.tar.gz' },
  ],

  // Running things.
  [
    'python a file',
    'Bash',
    bash('python3 scripts/migrate.py --dry-run'),
    undefined,
    { family: 'run', done: 'Ran migrate.py' },
  ],
  [
    'a script by path',
    'Bash',
    bash('./scripts/release.sh'),
    undefined,
    { done: 'Released the project' },
  ],
  ['node a file', 'Bash', bash('node build/server.js'), undefined, { done: 'Ran server.js' }],
  [
    'node -e',
    'Bash',
    bash(`node -e "const fs = require('fs'); fs.writeFileSync('out.json', '{}')"`),
    undefined,
    { family: 'edit', done: 'Edited out.json' },
  ],
  ['bash -c', 'Bash', bash(`bash -c "pnpm test"`), undefined, { done: 'Ran the tests' }],
  [
    'Codex sends zsh -lc',
    'Bash',
    bash(`/bin/zsh -lc 'rg -n "foo" src'`),
    undefined,
    { done: 'Searched src for “foo”' },
  ],
  [
    'a Python traceback',
    'Bash',
    bash('python3 nope.py'),
    err(
      'Traceback (most recent call last):\n  File "nope.py", line 1, in <module>\nModuleNotFoundError: No module named \'x\'',
    ),
    {
      done: 'Couldn’t run nope.py',
      outcome: "Failed: ModuleNotFoundError: No module named 'x'",
      failed: true,
    },
  ],
  [
    'exit code only',
    'Bash',
    bash('false'),
    err('Exit code 1'),
    { failed: true, outcome: 'Exit code 1' },
  ],
  [
    'curl a site',
    'Bash',
    bash('curl -s https://api.github.com/repos/x/y | jq .stargazers_count'),
    undefined,
    {
      family: 'research',
      done: 'Fetched api.github.com',
      chips: [{ kind: 'site', label: 'api.github.com', href: 'https://api.github.com/repos/x/y' }],
    },
  ],
  [
    'curl localhost',
    'Bash',
    bash('curl -sI http://localhost:5173/'),
    ok('HTTP/1.1 200 OK\n'),
    { family: 'verify', done: 'Checked localhost:5173', outcome: 'Status 200' },
  ],
  [
    'curl -X POST',
    'Bash',
    bash(`curl -X POST https://hooks.example.com/x -d '{"a":1}'`),
    undefined,
    { done: 'Sent a request to hooks.example.com' },
  ],
  [
    'curl -o',
    'Bash',
    bash('curl -L -o model.bin https://huggingface.co/x/model.bin'),
    ok(''),
    { done: 'Downloaded model.bin', effects: [{ kind: 'file', text: 'Downloaded model.bin' }] },
  ],
  [
    'docker compose up',
    'Bash',
    bash('docker compose up -d'),
    undefined,
    { done: 'Started the services' },
  ],
  [
    'docker build',
    'Bash',
    bash('docker build -t conch .'),
    undefined,
    { family: 'verify', done: 'Built the image' },
  ],
  [
    'brew install',
    'Bash',
    bash('brew install ripgrep'),
    ok(''),
    { done: 'Added ripgrep', effects: [{ kind: 'install', text: 'Installed ripgrep' }] },
  ],
  [
    'pip install -r',
    'Bash',
    bash('pip install -r requirements.txt'),
    undefined,
    { done: 'Installed the dependencies' },
  ],
  [
    'apt-get install',
    'Bash',
    bash('sudo apt-get install -y ffmpeg'),
    undefined,
    { done: 'Added ffmpeg' },
  ],
  [
    'open a page',
    'Bash',
    bash('open https://conch.dev/docs'),
    undefined,
    { done: 'Opened conch.dev' },
  ],
  ['sleep', 'Bash', bash('sleep 5'), undefined, { done: 'Waited 5 seconds' }],
  ['sleep then test', 'Bash', bash('sleep 2 && pnpm test'), undefined, { done: 'Ran the tests' }],
  ['pkill', 'Bash', bash('pkill -f vite'), undefined, { done: 'Stopped vite' }],
  ['kill', 'Bash', bash('kill 1234'), undefined, { done: 'Stopped a process' }],
  [
    'env and sudo come off',
    'Bash',
    bash('CI=1 NODE_ENV=test sudo -E npx vitest run'),
    undefined,
    { done: 'Ran the tests' },
  ],
  ['timeout comes off', 'Bash', bash('timeout 60 pnpm test'), undefined, { done: 'Ran the tests' }],
  [
    'ssh',
    'Bash',
    bash('ssh pi@raspberrypi.local "uptime"'),
    undefined,
    { done: 'Ran a command on raspberrypi.local' },
  ],
  [
    'vercel deploy',
    'Bash',
    bash('vercel --prod'),
    ok(''),
    { family: 'ship', effects: [{ kind: 'publish', text: 'Deployed the project' }] },
  ],
  [
    'an unknown program',
    'Bash',
    bash('frobnicate --all'),
    undefined,
    { family: 'run', done: 'Ran frobnicate' },
  ],
  ['echo alone', 'Bash', bash('echo done'), undefined, { done: 'Wrote a note' }],
  [
    'cd then echo then work',
    'Bash',
    bash('cd apps/web && echo "---" && ls src'),
    undefined,
    { done: 'Looked through src' },
  ],
  [
    'a for loop',
    'Bash',
    bash('for f in src/*.ts; do wc -l "$f"; done'),
    undefined,
    { family: 'explore' },
  ],
  [
    'Claude Code’s own description wins',
    'Bash',
    bash('pnpm --filter @conch/web test -- Transcript', { description: 'Run unit tests' }),
    ok(' Tests  30 passed (30)'),
    { family: 'verify', doing: 'Running unit tests', done: 'Ran unit tests', outcome: '30 passed' },
  ],
  [
    'a description that isn’t a verb',
    'Bash',
    bash('git status', { description: 'Git status' }),
    undefined,
    { done: 'Checked what’s changed' },
  ],
  [
    'a failed described command keeps verify words',
    'Bash',
    bash('pnpm test', { description: 'Run the tests' }),
    err(' Tests  1 failed | 3 passed (4)'),
    { done: 'Ran the tests', outcome: '1 failed', failed: true },
  ],
  [
    'a failed described command',
    'Bash',
    bash('cp a b', { description: 'Copy the config' }),
    err('cp: a: No such file or directory'),
    { done: 'Couldn’t copy the config', failed: true },
  ],
  [
    'a declined command',
    'Bash',
    bash('rm -rf /'),
    err('Not run: it wasn’t allowed.'),
    { done: 'Didn’t delete the whole computer', outcome: 'Not allowed', failed: false },
  ],
  [
    'a background command',
    'Bash',
    bash('pnpm dev', { run_in_background: true }),
    ok('Command running in background with ID: abc'),
    { done: 'Started the dev server' },
  ],
  [
    'Codex array command',
    'shell',
    { command: ['bash', '-lc', 'cargo test'] },
    undefined,
    { done: 'Ran the tests' },
  ],
];

describe('shell commands in plain words', () => {
  it.each(SHELL)('%s', (_title, name, input, result, want) => {
    expect(label(name, input, result)).toMatchObject(want);
  });
});

const TOOLS: Case[] = [
  // Claude Code.
  [
    'Read',
    'Read',
    { file_path: '/Users/x/pworkspace/conch-agent/apps/web/src/features/chat/Transcript.tsx' },
    undefined,
    {
      family: 'explore',
      doing: 'Reading Transcript.tsx',
      done: 'Read Transcript.tsx',
      subject: 'features/chat/Transcript.tsx',
      chips: [
        {
          kind: 'file',
          label: 'Transcript.tsx',
          href: '/Users/x/pworkspace/conch-agent/apps/web/src/features/chat/Transcript.tsx',
        },
      ],
    },
  ],
  [
    'Read a picture',
    'Read',
    { file_path: '/tmp/shot.png' },
    undefined,
    { done: 'Looked at shot.png' },
  ],
  [
    'Read a missing file',
    'Read',
    { file_path: '/x/nope.ts' },
    err('<tool_use_error>File does not exist.</tool_use_error>'),
    { done: 'Couldn’t read nope.ts', failed: true, outcome: 'Failed: File does not exist' },
  ],
  [
    'Write a new file',
    'Write',
    { file_path: '/x/new.ts', content: 'a\nb\n' },
    ok('File created successfully at: /x/new.ts'),
    {
      family: 'edit',
      doing: 'Writing new.ts',
      done: 'Created new.ts',
      outcome: '2 lines',
      effects: [{ kind: 'file', text: 'Created new.ts', target: '/x/new.ts' }],
    },
  ],
  [
    'Write over a file',
    'Write',
    { file_path: '/x/notes.md', content: 'hello' },
    ok('The file /x/notes.md has been updated.'),
    { done: 'Wrote notes.md', effects: [{ kind: 'file', text: 'Changed notes.md' }] },
  ],
  [
    'Write while running has no effects',
    'Write',
    { file_path: '/x/notes.md', content: 'hello' },
    undefined,
    { done: 'Wrote notes.md' },
  ],
  [
    'Edit',
    'Edit',
    { file_path: '/x/notes.md', old_string: 'a\nb', new_string: 'a\nc\nd' },
    ok('ok'),
    {
      family: 'edit',
      doing: 'Editing notes.md',
      done: 'Edited notes.md',
      outcome: '+2 −1',
      effects: [{ kind: 'file', text: 'Changed notes.md', target: '/x/notes.md' }],
    },
  ],
  [
    'Edit that failed',
    'Edit',
    { file_path: '/x/a.ts', old_string: 'x', new_string: 'y' },
    err('<tool_use_error>String to replace not found in file.</tool_use_error>'),
    { done: 'Couldn’t edit a.ts', failed: true },
  ],
  [
    'MultiEdit',
    'MultiEdit',
    {
      file_path: '/x/a.ts',
      edits: [
        { old_string: 'a', new_string: 'b' },
        { old_string: 'c', new_string: 'd\ne' },
      ],
    },
    ok(''),
    { done: 'Edited a.ts', outcome: '+3 −2' },
  ],
  [
    'NotebookEdit',
    'NotebookEdit',
    { notebook_path: '/x/a.ipynb', edit_mode: 'insert' },
    undefined,
    { done: 'Added a cell to a.ipynb' },
  ],
  [
    'Glob',
    'Glob',
    { pattern: '**/*.tsx' },
    ok('a.tsx\nb.tsx\n'),
    { family: 'explore', done: 'Looked for .tsx files', outcome: '2 files' },
  ],
  [
    'Glob a pattern in a folder',
    'Glob',
    { pattern: 'src/**/*.test.*', path: '/x/packages/nacre' },
    ok('No files found'),
    { done: 'Looked for files matching “src/**/*.test.*” in nacre', outcome: 'No files' },
  ],
  [
    'Grep files',
    'Grep',
    { pattern: 'describeTool', path: 'packages' },
    ok('Found 3 files\na\nb\nc'),
    { done: 'Searched packages for “describeTool”', outcome: '3 files' },
  ],
  [
    'Grep content',
    'Grep',
    { pattern: 'blocks\\(', output_mode: 'content' },
    ok('a.ts:1:x\nb.ts:2:y'),
    { done: 'Searched the code for “blocks(”', outcome: '2 matches' },
  ],
  [
    'Grep lines that look like counts, outside count mode',
    'Grep',
    { pattern: 'expiresAt', path: '/x/apps' },
    ok(
      'apps/server/src/auth/session.ts:12\napps/server/src/auth/store.ts:40\napps/web/src/login.ts:8',
    ),
    { outcome: '3 matches' },
  ],
  [
    'Grep in count mode',
    'Grep',
    { pattern: 'expiresAt', output_mode: 'count' },
    ok('a.ts:12\nb.ts:40'),
    { outcome: '52 matches' },
  ],
  ['Grep nothing', 'Grep', { pattern: 'zzz' }, ok('No files found'), { outcome: 'No matches' }],
  [
    'LS',
    'LS',
    { path: '/x/apps/web' },
    ok('- /x/apps/web/\n  - src/\n  - package.json\n'),
    { done: 'Looked through web', outcome: '2 items' },
  ],
  [
    'WebFetch an amazon.de product',
    'WebFetch',
    { url: 'https://www.amazon.de/-/en/dp/B0CHWRXH8B?th=1', prompt: 'What is the price?' },
    ok('The price is €249.'),
    {
      family: 'research',
      doing: 'Reading amazon.de',
      done: 'Read amazon.de',
      chips: [
        {
          kind: 'site',
          label: 'amazon.de',
          href: 'https://www.amazon.de/-/en/dp/B0CHWRXH8B?th=1',
          image: '/api/favicon?host=amazon.de',
        },
      ],
    },
  ],
  [
    'WebFetch failing',
    'WebFetch',
    { url: 'https://example.com/x' },
    err('Request failed with status code 404'),
    { done: 'Couldn’t read example.com', failed: true },
  ],
  [
    'WebSearch',
    'WebSearch',
    { query: 'best espresso grinder 2026' },
    ok(
      'Links: [{"title":"a","url":"https://www.reddit.com/r/x"},{"title":"b","url":"https://example.com/y"},{"title":"c","url":"https://example.com/z"}]',
    ),
    {
      family: 'research',
      done: 'Searched the web for “best espresso grinder 2026”',
      outcome: '3 results',
      chips: [
        { kind: 'text', label: 'best espresso grinder 2026' },
        { kind: 'site', label: 'reddit.com' },
        { kind: 'site', label: 'example.com' },
      ],
    },
  ],
  [
    'Task',
    'Task',
    { description: 'Explore codebase structure', prompt: 'x', subagent_type: 'Explore' },
    undefined,
    {
      family: 'delegate',
      doing: 'Asking a helper to explore codebase structure',
      done: 'Asked a helper to explore codebase structure',
    },
  ],
  [
    'Agent keeps an acronym',
    'Agent',
    { description: 'API audit' },
    undefined,
    { done: 'Asked a helper to API audit' },
  ],
  [
    'TodoWrite first',
    'TodoWrite',
    { todos: [{ status: 'pending' }, { status: 'pending' }] },
    undefined,
    { family: 'plan', done: 'Made a plan', outcome: '0 of 2 done' },
  ],
  [
    'TodoWrite later',
    'TodoWrite',
    { todos: [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }] },
    undefined,
    { done: 'Updated the plan', outcome: '1 of 3 done' },
  ],
  [
    'ExitPlanMode',
    'ExitPlanMode',
    { plan: 'x' },
    undefined,
    { family: 'plan', done: 'Shared the plan' },
  ],
  ['Skill', 'Skill', { skill: 'dataviz' }, undefined, { done: 'Used the dataviz skill' }],
  [
    'BashOutput running',
    'BashOutput',
    { bash_id: 'a' },
    ok('<status>running</status>\n<stdout>\n RUN v5\n</stdout>'),
    { family: 'run', done: 'Checked on a command', outcome: 'Still running' },
  ],
  [
    'BashOutput done with tests',
    'BashOutput',
    { bash_id: 'a' },
    ok(
      '<status>completed</status>\n<exit_code>0</exit_code>\n<stdout>\n Tests  9 passed (9)\n</stdout>',
    ),
    { outcome: '9 passed' },
  ],
  [
    'BashOutput failed',
    'BashOutput',
    { bash_id: 'a' },
    ok('<status>failed</status>\n<exit_code>1</exit_code>\n<stdout>\nError: boom\n</stdout>'),
    { failed: true, outcome: 'Failed: boom' },
  ],
  ['KillShell', 'KillShell', { shell_id: 'a' }, undefined, { done: 'Stopped a command' }],
  ['AskUserQuestion', 'AskUserQuestion', {}, undefined, { done: 'Asked you a question' }],
  [
    'IDE diagnostics',
    'mcp__ide__getDiagnostics',
    {},
    undefined,
    { family: 'verify', done: 'Checked for problems' },
  ],

  // Conch's host tools.
  [
    'web_search',
    'mcp__conch__web_search',
    { query: 'lisbon weather' },
    ok(
      JSON.stringify({
        query: 'lisbon weather',
        sources: [
          { title: 'a', url: 'https://weather.com/x' },
          { title: 'b', url: 'https://www.ipma.pt/y' },
        ],
      }),
    ),
    {
      family: 'research',
      done: 'Searched the web for “lisbon weather”',
      outcome: '2 results',
      chips: [
        { kind: 'text' },
        { kind: 'site', label: 'weather.com' },
        { kind: 'site', label: 'ipma.pt' },
      ],
    },
  ],
  [
    'product_details',
    'mcp__conch__product_details',
    { urls: ['https://www.lakeland.co.uk/a', 'https://shop.example/b'] },
    ok(
      JSON.stringify({
        products: [
          { url: 'https://www.lakeland.co.uk/a', found: true, title: 'Kettle' },
          { url: 'https://shop.example/b', found: false, problem: 'The site returned 403.' },
        ],
      }),
    ),
    {
      family: 'research',
      done: 'Looked at 2 products',
      outcome: '1 product',
      chips: [
        { kind: 'site', label: 'lakeland.co.uk' },
        { kind: 'site', label: 'shop.example' },
      ],
    },
  ],
  [
    'quote',
    'mcp__conch__quote',
    { symbols: ['AAPL'], period: '1M' },
    ok(
      JSON.stringify({
        quotes: [{ symbol: 'AAPL', price: 257.2, changePercent: 0.67, direction: 'up' }],
      }),
    ),
    { family: 'research', done: 'Checked what AAPL is at', outcome: '257.2, up 0.67%' },
  ],
  [
    'quote for several, nothing back yet',
    'quote',
    { symbols: ['AAPL', 'MSFT'] },
    undefined,
    { family: 'research', doing: 'Checking what AAPL and MSFT are at' },
  ],
  [
    'price_history',
    'mcp__conch__price_history',
    { symbol: 'aapl', period: '5Y' },
    ok('{}'),
    { family: 'research', done: 'Charted AAPL price over 5Y' },
  ],
  [
    'fundamentals',
    'mcp__conch__fundamentals',
    { companies: ['Apple', 'Microsoft'] },
    ok('{}'),
    { family: 'research', done: 'Read Apple and Microsoft’s filings' },
  ],
  [
    'crypto_market',
    'mcp__conch__crypto_market',
    {},
    ok(JSON.stringify({ market: { totalMarketCap: 2.4e12, change24h: -1.234, currency: 'USD' } })),
    { family: 'research', done: 'Checked how crypto is doing', outcome: 'Down 1.23% in 24h' },
  ],
  [
    'music_search',
    'mcp__conch__music_search',
    { query: 'bohemian rhapsody', kind: 'song' },
    ok(JSON.stringify({ query: 'bohemian rhapsody', results: [{ title: 'a' }, { title: 'b' }] })),
    { family: 'research', done: 'Found “bohemian rhapsody”', outcome: '2 songs' },
  ],
  [
    'music_search for podcasts, nothing found',
    'music_search',
    { query: 'zzz', kind: 'podcast' },
    ok(JSON.stringify({ query: 'zzz', results: [] })),
    { family: 'research', outcome: 'Nothing found' },
  ],
  [
    'video_search',
    'mcp__conch__video_search',
    { query: 'sourdough shaping' },
    ok(JSON.stringify({ query: 'sourdough shaping', videos: [{ title: 'a' }, { title: 'b' }] })),
    { family: 'research', done: 'Found videos of “sourdough shaping”', outcome: '2 videos' },
  ],
  [
    'video_details',
    'video_details',
    { urls: ['https://youtu.be/dQw4w9WgXcQ'] },
    ok(JSON.stringify({ videos: [{ title: 'a' }] })),
    { family: 'research', done: 'Looked up a video', outcome: '1 video' },
  ],
  [
    'web_fetch with a title',
    'web_fetch',
    { url: 'https://www.amazon.de/dp/B0CHWRXH8B' },
    ok(
      JSON.stringify({
        url: 'https://www.amazon.de/dp/B0CHWRXH8B',
        title: 'Apple AirPods Pro (2nd generation)',
        text: '…',
      }),
    ),
    {
      done: 'Read amazon.de',
      outcome: 'Apple AirPods Pro (2nd generation)',
      chips: [{ kind: 'site', label: 'amazon.de' }],
    },
  ],
  [
    'places nearby',
    'mcp__conch__places',
    { what: 'coffee', near: 'the Ritz, London' },
    ok(JSON.stringify({ places: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] })),
    {
      family: 'research',
      done: 'Found coffee near the Ritz, London',
      outcome: '3 places',
      chips: [{ kind: 'text' }],
    },
  ],
  [
    'places, one place',
    'places',
    { near: 'the Louvre' },
    ok(JSON.stringify({ places: [{ name: 'Louvre' }] })),
    { family: 'research', done: 'Looked up the Louvre' },
  ],
  [
    'places, how far',
    'places',
    { near: 'Brighton', from: 'London' },
    ok(JSON.stringify({ places: [{ name: 'Brighton' }] })),
    { done: 'Measured how far Brighton is from London' },
  ],
  [
    'knowledge_card',
    'mcp__conch__knowledge_card',
    { query: 'Ada Lovelace', lang: 'en' },
    ok(
      JSON.stringify({ title: 'Ada Lovelace', url: 'https://en.wikipedia.org/wiki/Ada_Lovelace' }),
    ),
    {
      family: 'research',
      done: 'Looked up “Ada Lovelace”',
      outcome: 'Ada Lovelace',
      chips: [{ kind: 'site', label: 'en.wikipedia.org' }],
    },
  ],
  [
    'link_preview, one link',
    'link_preview',
    { urls: ['https://github.com/vitejs/vite'] },
    ok(JSON.stringify({ links: [{ url: 'https://github.com/vitejs/vite' }] })),
    { family: 'research', done: 'Read github.com', chips: [{ kind: 'site', label: 'github.com' }] },
  ],
  [
    'link_preview, several',
    'link_preview',
    { urls: ['https://a.example/1', 'https://a.example/2', 'https://b.example/'] },
    undefined,
    {
      doing: 'Previewing 3 links',
      chips: [
        { kind: 'site', label: 'a.example' },
        { kind: 'site', label: 'b.example' },
      ],
    },
  ],
  [
    'book_search',
    'mcp__conch__book_search',
    { query: 'Le Guin', limit: 6 },
    ok(JSON.stringify({ books: [{ title: 'A' }, { title: 'B' }] })),
    { family: 'research', done: 'Searched books for “Le Guin”', outcome: '2 books' },
  ],
  [
    'show_search',
    'show_search',
    { query: 'Severance', kind: 'tv' },
    ok(JSON.stringify({ shows: [{ title: 'Severance' }] })),
    { done: 'Searched TV shows for “Severance”', outcome: '1 show' },
  ],
  [
    'show_search for a film',
    'show_search',
    { query: 'Dune', kind: 'movie' },
    ok(JSON.stringify({ title: 'Dune (2021 film)' })),
    { done: 'Looked up the film “Dune”', outcome: 'Dune (2021 film)' },
  ],
  [
    'read_file',
    'mcp__conch__read_file',
    { file_path: '/x/README.md' },
    undefined,
    { done: 'Read README.md' },
  ],
  [
    'search_files text',
    'mcp__conch__search_files',
    { text: 'budget', path: 'docs' },
    ok(JSON.stringify({ matches: [{ path: 'a' }, { path: 'b' }] })),
    { done: 'Searched docs for “budget”', outcome: '2 matches' },
  ],
  [
    'search_files name',
    'mcp__conch__search_files',
    { name: 'invoice' },
    ok(JSON.stringify({ matches: [] })),
    { done: 'Looked for files named “invoice”', outcome: 'No files' },
  ],
  [
    'publish_file',
    'mcp__conch__publish_file',
    { file_path: '/x/report.pdf' },
    ok('{}'),
    {
      family: 'make',
      done: 'Offered report.pdf to download',
      effects: [{ kind: 'publish', text: 'Offered report.pdf to download' }],
    },
  ],
  [
    'file_make',
    'mcp__conch__file_make',
    { format: 'pdf', name: 'Q3 report' },
    ok(JSON.stringify({ id: 'att_1', name: 'Q3 report.pdf', pages: 3 })),
    {
      family: 'make',
      doing: 'Making Q3 report.pdf',
      done: 'Made Q3 report.pdf',
      outcome: '3 pages',
      effects: [{ kind: 'publish', text: 'Made Q3 report.pdf' }],
    },
  ],
  [
    'file_make with the extension already there',
    'file_make',
    { format: 'xlsx', name: 'Budget.xlsx' },
    ok(JSON.stringify({ sheets: 2 })),
    { done: 'Made Budget.xlsx', outcome: '2 sheets' },
  ],
  [
    'file_convert of a chat file',
    'file_convert',
    { source: 'att_abc', to: 'pdf' },
    ok('{}'),
    { family: 'make', done: 'Converted a file to PDF' },
  ],
  [
    'file_combine into a zip',
    'file_combine',
    { sources: ['a', 'b', 'c'], to: 'zip', name: 'Everything' },
    ok('{}'),
    { done: 'Packed 3 files into Everything.zip' },
  ],
  [
    'file_unzip',
    'file_unzip',
    { source: '/x/photos.zip' },
    ok(JSON.stringify({ files: [{}, {}], more: 3 })),
    { doing: 'Unpacking photos.zip', done: 'Unpacked photos.zip', outcome: '5 files' },
  ],
  [
    'process_start of the tests',
    'mcp__conch__process_start',
    { command: 'pnpm --filter @conch/web test' },
    ok(
      JSON.stringify({
        id: 'x',
        command: 'pnpm --filter @conch/web test',
        status: 'running',
        exitCode: null,
        output: '',
      }),
    ),
    {
      family: 'verify',
      doing: 'Starting the tests',
      done: 'Started the tests',
      outcome: 'Still running',
    },
  ],
  [
    'process_start queued',
    'process_start',
    { command: 'pnpm build' },
    ok(JSON.stringify({ command: 'pnpm build', status: 'queued', exitCode: null, output: '' })),
    { done: 'Started the build', outcome: 'Waiting to start' },
  ],
  [
    'process_read of a running test command',
    'mcp__conch__process_read',
    { id: 'x', wait_ms: 30000 },
    ok(
      JSON.stringify({
        command: 'pnpm test',
        status: 'running',
        exitCode: null,
        output: ' RUN  v5.0.2\n ✓ src/a.test.ts (3)\n',
      }),
    ),
    {
      family: 'verify',
      doing: 'Checking on the tests',
      done: 'Checked on the tests',
      outcome: 'Still running',
      subject: 'pnpm test',
    },
  ],
  [
    'wait_for CI that came back red',
    'mcp__conch__wait_for',
    { kind: 'ci', ref: '482' },
    ok('CI finished: 2 failed — e2e, server unit; 5 passed (o/conch #482).\nFailed:\n- e2e'),
    {
      family: 'verify',
      doing: 'Waiting for CI',
      done: 'Waited for CI',
      outcome: 'CI finished: 2 failed — e2e, server unit; 5 passed (o/conch #482)',
    },
  ],
  [
    'wait_for a command',
    'wait_for',
    { kind: 'process', process_id: 'x' },
    ok('`pnpm test` finished after 3 min.'),
    { family: 'run', done: 'Waited for a command', outcome: '`pnpm test` finished after 3 min' },
  ],
  [
    'process_read once the tests are done',
    'mcp__conch__process_read',
    { id: 'x' },
    ok(
      JSON.stringify({
        command: 'pnpm test',
        status: 'exited',
        exitCode: 0,
        output: ' Test Files  80 passed (80)\n      Tests  7388 passed (7388)\n',
      }),
    ),
    { done: 'Ran the tests', outcome: '7,388 passed' },
  ],
  [
    'process_read once the tests failed',
    'process_read',
    { id: 'x' },
    ok(
      JSON.stringify({
        command: 'pnpm test',
        status: 'exited',
        exitCode: 1,
        output: ' Tests  3 failed | 10 passed (13)\n',
      }),
    ),
    { done: 'Ran the tests', outcome: '3 failed', failed: true },
  ],
  [
    'process_read that timed out',
    'process_read',
    { id: 'x' },
    ok(JSON.stringify({ command: 'pnpm e2e', status: 'timed-out', exitCode: null, output: '' })),
    { outcome: 'Time limit reached', failed: true },
  ],
  [
    'process_read listing',
    'process_read',
    {},
    ok(JSON.stringify([{ command: 'a' }, { command: 'b' }])),
    { done: 'Checked the commands', outcome: '2 commands' },
  ],
  [
    'process_read without a result',
    'process_read',
    { id: 'x' },
    undefined,
    { doing: 'Checking on a command', done: 'Checked on a command' },
  ],
  [
    'process_stop',
    'process_stop',
    { id: 'x' },
    ok(JSON.stringify({ command: 'pnpm dev', status: 'stopped', exitCode: null, output: '' })),
    { done: 'Stopped the dev server' },
  ],
  [
    'process_write',
    'process_write',
    { id: 'x', text: 'y\n' },
    undefined,
    { done: 'Typed into a command' },
  ],
  [
    'delegate one part',
    'mcp__conch__delegate',
    { parts: [{ title: 'Check the flights', instructions: 'x' }] },
    undefined,
    { family: 'delegate', done: 'Asked a helper to check the flights' },
  ],
  [
    'delegate three parts',
    'delegate',
    { parts: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] },
    undefined,
    { done: 'Asked 3 helpers', subject: 'a, b, c' },
  ],
  [
    'start_background_task',
    'start_background_task',
    { title: 'Weekly report' },
    undefined,
    { done: 'Started “Weekly report” in the background' },
  ],
  [
    'task_control',
    'task_control',
    { id: 'x', action: 'retry' },
    undefined,
    { done: 'Retried a task' },
  ],
  [
    'remember',
    'mcp__conch__remember',
    { content: 'Prefers aisle seats' },
    undefined,
    { family: 'remember', done: 'Saved a memory', subject: 'Prefers aisle seats' },
  ],
  [
    'recall',
    'mcp__conch__recall',
    { query: 'flights' },
    undefined,
    { family: 'remember', done: 'Looked through memories for “flights”' },
  ],
  [
    'search_chats',
    'search_chats',
    { query: 'Lisbon plan' },
    undefined,
    { family: 'remember', done: 'Searched past chats for “Lisbon plan”' },
  ],
  ['read_chat', 'read_chat', { chat: 'x' }, undefined, { done: 'Read a past chat' }],
  [
    'update_plan',
    'update_plan',
    { steps: [{ status: 'done' }, { status: 'active' }] },
    undefined,
    { family: 'plan', done: 'Updated the plan', outcome: '1 of 2 done' },
  ],
  [
    'image_generate',
    'mcp__conch__image_generate',
    { prompt: 'a cat in a hat' },
    ok(JSON.stringify({ id: 'a', name: 'Cat.png', path: '/x/Cat.png' })),
    {
      family: 'make',
      done: 'Made a picture',
      subject: 'a cat in a hat',
      effects: [{ kind: 'file', text: 'Made Cat.png', target: '/x/Cat.png' }],
    },
  ],
  [
    'image_generate with a picture link',
    'image_generate',
    { prompt: 'x', source: 'a.png' },
    ok('Saved at https://cdn.example.com/out/cat.png'),
    {
      done: 'Edited a picture',
      chips: [
        {
          kind: 'image',
          href: 'https://cdn.example.com/out/cat.png',
          image: 'https://cdn.example.com/out/cat.png',
        },
      ],
    },
  ],
  [
    'image_generate declined',
    'image_generate',
    { prompt: 'x' },
    ok('The user declined. No image request was sent.'),
    { outcome: 'Not made' },
  ],
  [
    'create_routine',
    'create_routine',
    { title: 'Morning brief' },
    ok('{}'),
    {
      family: 'plan',
      done: 'Set up “Morning brief”',
      effects: [{ kind: 'schedule', text: 'Set up “Morning brief”' }],
    },
  ],
  [
    'delete_routine',
    'delete_routine',
    { id: 'x' },
    ok('{}'),
    { effects: [{ kind: 'delete', text: 'Deleted a routine' }] },
  ],
  [
    'suggest_standing_order',
    'suggest_standing_order',
    { text: 'Tell me if a flight changes' },
    ok('Offered on a card.'),
    { family: 'plan', done: 'Suggested a standing order' },
  ],
  ['use_skill', 'use_skill', { name: 'pdf' }, undefined, { done: 'Used the pdf skill' }],
  [
    'a script that calls tools',
    'mcp__conch__run_script',
    { title: 'Tag the invoices among my emails', script: 'return 1' },
    ok('It returned:\n47\n\n312 tool calls: google_mail_search ×1 · 12.0 s of work.'),
    {
      family: 'run',
      done: 'Ran a script to tag the invoices among my emails',
      outcome: '312 tool calls',
    },
  ],
  ['current_time', 'mcp__conch__current_time', {}, undefined, { done: 'Checked the time' }],
  [
    'computer screenshot',
    'mcp__conch__computer',
    { action: 'screenshot' },
    undefined,
    { done: 'Looked at the screen' },
  ],
  [
    'computer click',
    'computer',
    { action: 'left_click', coordinate: [1, 2] },
    undefined,
    { doing: 'Clicking on the screen' },
  ],
  [
    'computer typing, never what',
    'computer',
    { action: 'type', text: 'my secret words' },
    undefined,
    { done: 'Typed on the computer' },
  ],
  [
    'computer open',
    'computer',
    { action: 'open_app', app: 'Notes' },
    undefined,
    { done: 'Opened Notes' },
  ],
  [
    'passwords_find',
    'passwords_find',
    { query: 'github' },
    undefined,
    { done: 'Looked in your passwords' },
  ],
  ['exit_plan_mode', 'exit_plan_mode', {}, undefined, { done: 'Shared the plan' }],

  // Conch's apps.
  [
    'calendar briefing',
    'mcp__conch__google_calendar_briefing',
    {},
    undefined,
    {
      family: 'connect',
      doing: 'Looking at your calendar',
      done: 'Looked at your calendar',
      chips: [{ kind: 'app', label: 'Google Calendar' }],
    },
  ],
  [
    'mail search',
    'google_mail_search',
    { query: 'invoice' },
    undefined,
    { done: 'Searched your mail', subject: '“invoice”' },
  ],
  [
    'mail send',
    'mcp__conch__google_mail_send',
    { to: 'ana@example.com', subject: 'Hi' },
    ok('sent'),
    {
      done: 'Sent an email',
      effects: [
        { kind: 'send', text: 'Sent an email to ana@example.com', target: 'ana@example.com' },
      ],
    },
  ],
  [
    'mail send failing',
    'google_mail_send',
    { to: 'ana@example.com' },
    err('Gmail said no'),
    { done: 'Couldn’t send an email', failed: true },
  ],
  [
    'calendar create',
    'google_calendar_create_event',
    { summary: 'Dentist' },
    ok('{}'),
    { effects: [{ kind: 'schedule', text: 'Added “Dentist” to your calendar' }] },
  ],
  [
    'slack send',
    'mcp__conch__slack_send_message',
    { channel: '#design' },
    ok('{}'),
    {
      done: 'Sent a message',
      effects: [{ kind: 'send', text: 'Sent a message in Slack', target: '#design' }],
    },
  ],
  [
    'app_new',
    'mcp__conch__app_new',
    { name: 'Plant diary' },
    undefined,
    { family: 'make', done: 'Started the “Plant diary” app' },
  ],
  [
    'app_write',
    'app_write',
    { path: 'pages/main.html', content: 'x' },
    undefined,
    { done: 'Wrote main.html' },
  ],
  [
    'app_try',
    'app_try',
    { tool: 'log_watering' },
    undefined,
    { family: 'verify', done: 'Tried “Log watering”' },
  ],
  ['app_check', 'app_check', {}, undefined, { done: 'Checked the app' }],

  // The browser.
  [
    'browser_open a site',
    'mcp__conch__browser_open',
    { url: 'https://www.amazon.de/s?k=kettle' },
    undefined,
    { family: 'browse', done: 'Opened amazon.de', chips: [{ kind: 'site', label: 'amazon.de' }] },
  ],
  [
    'browser_open bare host',
    'browser_open',
    { url: 'amazon.de' },
    undefined,
    { done: 'Opened amazon.de' },
  ],
  [
    'browser_open words',
    'browser_open',
    { url: 'cheap flights to lisbon' },
    undefined,
    { done: 'Searched for “cheap flights to lisbon”' },
  ],
  [
    'browser_click',
    'browser_click',
    { ref: 'e12', element: 'Sign in button' },
    undefined,
    { doing: 'Clicking “Sign in button”', done: 'Clicked “Sign in button”' },
  ],
  [
    'browser_click hover',
    'browser_click',
    { ref: 'e12', element: 'Menu', how: 'hover' },
    undefined,
    { done: 'Pointed at “Menu”' },
  ],
  [
    'browser_type',
    'browser_type',
    { ref: 'e3', element: 'Search box', text: 'kettle' },
    undefined,
    { done: 'Typed in “Search box”' },
  ],
  ['browser_read', 'browser_read', { find: 'price' }, undefined, { done: 'Looked for “price”' }],
  ['browser_screenshot', 'browser_screenshot', {}, undefined, { done: 'Looked at the page' }],
  ['browser_press', 'browser_press', { key: 'Enter' }, undefined, { done: 'Pressed Enter' }],

  // Other servers.
  [
    'an MCP search',
    'mcp__linear__search_issues',
    { query: 'x' },
    undefined,
    { family: 'connect', done: 'Searched issues in Linear' },
  ],
  [
    'an MCP create',
    'mcp__notion__create_page',
    {},
    ok('{}'),
    {
      done: 'Created a page in Notion',
      effects: [{ kind: 'other', text: 'Created a page in Notion' }],
    },
  ],
  [
    'an MCP post',
    'mcp__slack-mcp__post_message',
    {},
    ok('{}'),
    {
      done: 'Posted a message in Slack',
      effects: [{ kind: 'send', text: 'Posted a message in Slack' }],
    },
  ],
  ['an MCP get', 'mcp__github__get_issue', {}, undefined, { done: 'Looked at an issue in GitHub' }],
  [
    'an MCP list',
    'mcp__aws-outlook-mcp__calendar_view',
    {},
    undefined,
    { done: 'Used calendar view in Outlook' },
  ],
  [
    'an MCP delete',
    'mcp__linear__delete_comment',
    {},
    ok('{}'),
    { effects: [{ kind: 'delete', text: 'Deleted a comment in Linear' }] },
  ],
  [
    'an MCP calendar create',
    'mcp__google__create_event',
    {},
    ok('{}'),
    { effects: [{ kind: 'schedule', text: 'Created an event in Google' }] },
  ],
  [
    'Asana’s doubled prefix',
    'mcp__enterprise-asana-mcp__asana___CreateTask',
    {},
    undefined,
    { done: 'Created a task in Asana' },
  ],
  [
    'a plugin server',
    'mcp__plugin_AmazonBuilderCoreAIAgents-pipeline-assistant_builder-mcp__GetPipelineHealth',
    {},
    undefined,
    { done: 'Looked at pipeline health in Builder' },
  ],
  [
    'Codex dynamic tool',
    'provider__clock__curr_time',
    {},
    undefined,
    { family: 'connect', done: 'Used curr time in Clock' },
  ],
  [
    'Codex native tool',
    'provider__native__lookup_weather',
    {},
    undefined,
    { done: 'Looked up weather' },
  ],
  [
    'an unknown Conch tool',
    'mcp__conch__frobnicate_things',
    {},
    undefined,
    { done: 'Used frobnicate things' },
  ],
  [
    'an ACP title',
    'Run unit tests',
    { description: 'Run unit tests' },
    undefined,
    { family: 'run', doing: 'Running unit tests', done: 'Ran unit tests' },
  ],
  [
    'an ACP title in -ing',
    'Reading configuration files',
    {},
    undefined,
    { family: 'explore', done: 'Read configuration files' },
  ],
  [
    'an unknown tool',
    'tide_tables',
    {},
    undefined,
    { family: 'other', doing: 'Using tide tables', done: 'Used tide tables' },
  ],
  [
    'the weather',
    'mcp__conch__weather',
    { place: 'Lisbon' },
    { status: 'success', output: '{"now":{"temp":21.4,"sky":"Partly cloudy"}}' },
    {
      family: 'research',
      done: 'Checked the weather in Lisbon',
      outcome: '21° and partly cloudy',
    },
  ],
];

describe('tools in plain words', () => {
  it.each(TOOLS)('%s', (_title, name, input, result, want) => {
    expect(label(name, input, result)).toMatchObject(want);
  });
});

describe('the rules’ promises', () => {
  it('puts no effects on a call that is still running or failed', () => {
    expect(
      label('Edit', { file_path: '/x/a.ts', old_string: 'a', new_string: 'b' }).effects,
    ).toBeUndefined();
    expect(
      label('Bash', bash('git push origin main'), { status: 'running' }).effects,
    ).toBeUndefined();
    expect(
      label('Bash', bash('git push origin main'), err('fatal: no remote')).effects,
    ).toBeUndefined();
  });

  it('keeps raw shell out of the words, and the command in the subject', () => {
    const made = label(
      'Bash',
      bash(`FOO=1 bash -c 'cd /tmp && python3 -c "print(1)" | tee out.log 2>&1'`),
    );
    expect(made.doing).not.toMatch(/[|&;$<>]/);
    expect(made.done).not.toMatch(/[|&;$<>]/);
    expect(made.subject).toContain('FOO=1');
  });

  it('cuts long things short, inside the schema', () => {
    const long = 'x'.repeat(5000);
    for (const made of [
      label('Bash', bash(`git commit -m "${long}"`), ok(`[main abc1234] ${long}`)),
      label('Grep', { pattern: long, path: `/${long}/a.ts` }),
      label('WebSearch', { query: long }),
      label(`mcp__${long}__${long}`, {}),
      label('Read', { file_path: `/a/${long}.ts` }),
      label('Bash', bash(`echo ${long}`), err(long)),
    ]) {
      expect(made.doing.length).toBeLessThanOrEqual(120);
      expect(made.done.length).toBeLessThanOrEqual(120);
      expect((made.outcome ?? '').length).toBeLessThanOrEqual(100);
    }
  });

  it('writes sentence case with no trailing period', () => {
    for (const [name, input] of [...SHELL, ...TOOLS].map(([, n, i]) => [n, i] as const)) {
      const made = describeTool(name, input);
      expect(made.doing.charAt(0)).toBe(made.doing.charAt(0).toUpperCase());
      expect(made.done).not.toMatch(/[^.]\.$/);
      expect(made.doing).not.toMatch(/—/);
    }
  });

  it('never throws, whatever it’s given', () => {
    const odd: unknown[] = [
      null,
      undefined,
      42,
      'string',
      [],
      [1, 2],
      { command: 42 },
      { command: null },
      { command: ['a', 3, null] },
      { command: '"unterminated' },
      { command: "'unterminated" },
      { command: '$(((((' },
      { command: '`' },
      { command: '<<EOF' },
      { command: 'cat <<' },
      { command: '|||&&&;;;' },
      { command: '\\' },
      { command: '> ' },
      { command: '2>&1' },
      { command: '\u0001\u0001' },
      { command: '\u00010\u0001' },
      { command: 'git' },
      { command: 'git -C' },
      { command: 'pnpm --filter' },
      { command: 'python3 -c' },
      { command: 'python3 -m' },
      { command: 'find' },
      { command: 'curl' },
      { command: 'rm' },
      { command: 'sed -i' },
      { file_path: 42 },
      { todos: 'x' },
      { todos: [null, 1, 'x'] },
      { edits: [null] },
      { parts: 'x' },
      { url: 'not a url' },
      { url: 'http://' },
      { query: {} },
      Object.create(null),
    ];
    const names = [
      'Bash',
      'Read',
      'Edit',
      'MultiEdit',
      'Write',
      'Grep',
      'Glob',
      'WebFetch',
      'WebSearch',
      'TodoWrite',
      'delegate',
      'process_read',
      'process_start',
      'browser_open',
      'mcp__x__y',
      'mcp____',
      'mcp__',
      '',
      ' ',
      'provider__',
      'x'.repeat(400),
    ];
    const results: (ToolResult | undefined)[] = [
      undefined,
      ok(),
      err(),
      ok('{'),
      ok('[1,2'),
      ok('null'),
      ok('{"status":"exited","exitCode":"x","command":5}'),
      err('\u001b[31mError\u001b[0m: red'),
      { status: 'pending' },
    ];
    for (const name of names)
      for (const input of odd)
        for (const result of results)
          expect(() => ToolLabel.parse(describeTool(name, input, result))).not.toThrow();
  });

  it('fuzzes shell input without throwing', () => {
    const pieces = [
      'git',
      'push',
      '-C',
      '"',
      "'",
      '$(',
      ')',
      '`',
      '|',
      '&&',
      ';',
      '\n',
      '<<',
      'EOF',
      '>',
      '2>&1',
      '-m',
      'x',
      'pnpm',
      'test',
      'python3',
      '-',
      'rm',
      '-rf',
      '/',
      'cd',
      '..',
      '\\',
      '#',
      '{',
      '}',
      '(',
      'sudo',
      'env',
      'A=1',
      'npx',
      'xargs',
    ];
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    for (let i = 0; i < 2000; i++) {
      const command = Array.from(
        { length: next() % 14 },
        () => pieces[next() % pieces.length],
      ).join(next() % 3 ? ' ' : '');
      expect(() =>
        ToolLabel.parse(describeTool('Bash', { command }, next() % 2 ? ok(command) : err(command))),
      ).not.toThrow();
    }
  });

  it('stays fast on huge outputs and commands', () => {
    const output =
      `${'line of noisy output that goes on and on 1234567890 :: -> '.repeat(200)}\n`.repeat(400);
    const nasty = `${' '.repeat(50_000)}->${'a'.repeat(50_000)}`;
    const command = `${'echo a && '.repeat(3000)}pnpm test`;
    const started = Date.now();
    label('Bash', bash('pnpm test'), ok(output));
    label('Bash', bash('git push'), ok(nasty));
    label('Bash', bash('rg x'), ok(output));
    label('Bash', bash(command), err(output));
    label('Bash', bash(`python3 - <<'PY'\n${'x = 1\n'.repeat(20_000)}PY`));
    label('Grep', { pattern: 'x', output_mode: 'content' }, ok(output));
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe('calls that never ran', () => {
  const no = (approval: ToolResult['approval'], output = ''): ToolResult => ({
    status: 'error',
    output,
    approval,
  });

  it.each([
    ['Bash', bash('pnpm test'), 'Didn’t run the tests'],
    [
      'Edit',
      { file_path: '/x/notes.md', old_string: 'a', new_string: 'b' },
      'Didn’t edit notes.md',
    ],
    ['Write', { file_path: '/x/notes.md', content: 'x' }, 'Didn’t write notes.md'],
    ['Read', { file_path: '/x/secret.txt' }, 'Didn’t read secret.txt'],
    ['google_mail_send', { to: 'ana@example.com' }, 'Didn’t send an email'],
    ['Bash', bash('git push origin main'), 'Didn’t push to main'],
    ['Bash', bash('git commit -m "fix"'), 'Didn’t commit the changes'],
    ['mcp__conch__process_start', { command: 'pnpm test' }, 'Didn’t start the tests'],
  ] as const)('%s: %s', (name, input, done) => {
    for (const approval of ['declined', 'refused', 'expired'] as const) {
      const made = label(name, input, no(approval));
      expect(made.done).toBe(done);
      expect(made.failed).toBe(false);
      expect(made.effects).toBeUndefined();
    }
  });

  it('says why it didn’t run, and keeps the words for while it waited', () => {
    expect(label('Bash', bash('pnpm test'), no('declined'))).toMatchObject({
      doing: 'Running the tests',
      outcome: 'You said no',
    });
    expect(label('Bash', bash('pnpm test'), no('refused')).outcome).toBe('Not allowed');
    expect(label('Bash', bash('pnpm test'), no('expired')).outcome).toBe('Not answered');
  });

  it('is said the same whatever the tool reported, even before it reported', () => {
    for (const status of ['success', 'error', 'running', 'pending'] as const) {
      expect(
        label('Bash', bash('rm -rf build'), { status, approval: 'declined', output: 'ok' }).done,
      ).toMatch(/^Didn’t /);
    }
  });

  it('reads an answer that let it run as running', () => {
    expect(
      label('Bash', bash('pnpm test'), { ...ok(' Tests  3 passed (3)'), approval: 'allowed' }),
    ).toMatchObject({ done: 'Ran the tests', outcome: '3 passed' });
  });
});

describe('favicon', () => {
  it('asks the gateway, never a third-party service', () => {
    expect(favicon('amazon.de')).toBe('/api/favicon?host=amazon.de');
    expect(favicon('a&b=c.example')).toBe('/api/favicon?host=a%26b%3Dc.example');
  });

  it('has none for this computer, addresses and ports', () => {
    expect(favicon('localhost:5173')).toBeUndefined();
    expect(favicon('127.0.0.1:8080')).toBeUndefined();
    expect(favicon('93.184.216.34')).toBeUndefined();
    expect(favicon('[2001:db8::1]')).toBeUndefined();
  });
});

describe('words on hostile input', () => {
  /** Milliseconds `run` takes. */
  const timed = (run: () => unknown) => {
    const start = Date.now();
    run();
    return Date.now() - start;
  };

  it('says paths, folders and quotes in linear time, however long the run of marks', () => {
    for (const hostile of [
      `${'/'.repeat(50_000)}!`,
      `${'\\'.repeat(50_000)}!`,
      `${'"'.repeat(50_000)}!`,
      `${'.'.repeat(50_000)}!`,
      `a${' '.repeat(50_000)}!`,
    ]) {
      expect(timed(() => baseName(hostile))).toBeLessThan(50);
      expect(timed(() => shortPath(hostile))).toBeLessThan(50);
      expect(timed(() => folderName(hostile))).toBeLessThan(50);
      expect(timed(() => quote(hostile))).toBeLessThan(50);
      expect(timed(() => fromPhrase(hostile))).toBeLessThan(50);
      expect(timed(() => clip(hostile, 50_000))).toBeLessThan(50);
      for (const name of ['Read', 'LS', 'Glob', 'Task']) {
        const input = { file_path: hostile, path: hostile, pattern: hostile, description: hostile };
        expect(timed(() => label(name, input))).toBeLessThan(50);
      }
      expect(timed(() => label('Bash', { command: `git show HEAD${hostile}` }))).toBeLessThan(50);
      expect(timed(() => label('Bash', { command: `cp a ${hostile}` }))).toBeLessThan(50);
    }
  });

  it('trims the same as before', () => {
    expect(baseName('/home/x/repo/src/Transcript.tsx///')).toBe('Transcript.tsx');
    expect(baseName('"C:\\Users\\me\\notes.txt\\"')).toBe('notes.txt');
    expect(shortPath('/a/b/c/d/e/')).toBe('c/d/e');
    expect(folderName('///')).toBe('the whole computer');
    expect(folderName('src/')).toBe('src');
    expect(quote('"hello"')).toBe('“hello”');
    expect(trimEnd('done. ,;', ',;.', true)).toBe('done');
    expect(fromPhrase('Run the tests...')?.done).toBe('Ran the tests');
  });
});
