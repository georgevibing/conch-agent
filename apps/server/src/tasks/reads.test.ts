import { describe, expect, it } from 'vitest';

import { readOnlyCommand, taskReadOnly } from './reads';

describe('what a task treats as only looking', () => {
  it.each(['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'ToolSearch', 'TodoWrite'])(
    '%s is a read',
    (name) => expect(taskReadOnly(name, {})).toBe(true),
  );

  it.each([
    'Write',
    'Edit',
    'Task',
    'KillShell',
    'PowerShell',
    // Another app's tool, whatever it calls itself, is not Conch's to vouch for.
    'mcp__evil__Read',
    'mcp__evil__ToolSearch',
    'read',
    'toolsearch',
  ])('%s is not', (name) => expect(taskReadOnly(name, { readOnlyHint: true })).toBe(false));

  it.each([
    'ls -la',
    'cat README.md | wc -l',
    'git status',
    'git log --oneline -5',
    'git diff HEAD~1 -- src',
    'git branch -a',
    'git remote -v',
    'grep -rn "TODO" src 2>/dev/null',
    'rg --files',
    'find . -name "*.ts" -type f',
    'cd apps/server && ls',
    'head -n 20 notes.txt; tail -n 5 notes.txt',
    'wc -l < notes.txt',
    'sort -n data.txt | uniq -c',
    'du -sh . && df -h',
    'stat made.txt || echo missing',
    'date -u',
    'jq .name package.json',
  ])('a shell command that only reads: %s', (command) => {
    expect(readOnlyCommand(command)).toBe(true);
    expect(taskReadOnly('Bash', { command })).toBe(true);
  });

  // Each of these writes, deletes or runs something more than it says.
  it.each([
    'touch made.txt',
    'cat a > b',
    'echo hi >> notes.txt',
    'ls 2>errors.txt',
    'cat <> file',
    'tee out.txt < in.txt',
    'ls; rm -rf build',
    'ls && npm install',
    'ls | xargs rm',
    'cat x | sh',
    'echo $(rm -rf ~)',
    'echo `rm -rf ~`',
    'diff <(rm x) y',
    'cat <<EOF | bash\nrm x\nEOF',
    'find . -name "*.tmp" -delete',
    'find . -exec rm {} \\;',
    'sort data.txt -o data.txt',
    'sort --compress-program=evil data.txt',
    'uniq in.txt out.txt',
    'rg --pre ./evil pattern',
    'rg -z pattern',
    'tree -o out.txt',
    'date -s "2020-01-01"',
    'git branch new-feature',
    'git branch -D main',
    'git remote add origin x',
    'git commit -m x',
    'git -c core.pager=evil log',
    'git diff --output=patch.txt',
    'git diff --ext-diff',
    'GIT_EXTERNAL_DIFF=evil git diff',
    'PAGER=evil git log',
    'sudo cat /etc/shadow',
    'env ls',
    '/tmp/cat file',
    'sed -i s/a/b/ file',
    'awk \'{system("rm x")}\' file',
    'python3 -c "print(1)"',
    'bash -c "ls"',
    '',
    '   ',
  ])('not a read: %j', (command) => {
    expect(readOnlyCommand(command)).toBe(false);
    expect(taskReadOnly('Bash', { command })).toBe(false);
  });

  it('is never fooled by arguments that are not a command', () => {
    expect(taskReadOnly('Bash', {})).toBe(false);
    expect(taskReadOnly('Bash', { command: ['ls'] })).toBe(false);
    expect(taskReadOnly('Bash', { command: `ls ${'a'.repeat(5_000)}` })).toBe(false);
    // PowerShell isn't read here at all: it stays an action.
    expect(taskReadOnly('PowerShell', { command: 'Get-ChildItem' })).toBe(false);
  });
});
