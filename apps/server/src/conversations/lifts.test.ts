import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AutoRule, Preferences } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { AutoLifts, proposeRule, ruleMatches, ruleWords, sameRule, validRule } from './lifts';

describe('which chats lifted a kind of step (ADR 0128)', () => {
  it('remembers the chats per class, newest last, a few at most, and reads them back', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-lifts-'));
    const lifts = new AutoLifts(home);
    expect(await lifts.seen('risk:install:moderate')).toEqual([]);
    await lifts.note('risk:install:moderate', 'c1');
    await lifts.note('risk:install:moderate', 'c2');
    await lifts.note('risk:install:moderate', 'c1');
    expect(await lifts.seen('risk:install:moderate')).toEqual(['c2', 'c1']);
    for (let i = 0; i < 12; i++) await lifts.note('risk:egress:push code to a remote', `p${i}`);
    expect(await lifts.seen('risk:egress:push code to a remote')).toHaveLength(8);
    // On disk, readable by the next Conch, and nothing else.
    const file = JSON.parse(await readFile(join(home, 'auto-lifts.json'), 'utf8')) as {
      version: number;
    };
    expect(file.version).toBe(1);
    expect(await new AutoLifts(home).seen('risk:install:moderate')).toEqual(['c2', 'c1']);
  });
});

describe('commands Auto never asks about again (ADR 0149)', () => {
  const at = '/work/shop';
  const rule = (command: string, tool = 'Bash') => proposeRule(tool, command, at, 1);

  it('offers one command, word for word, and a pushed branch as its kind', () => {
    expect(rule('terraform apply -target=module.dev')).toEqual({
      tool: 'Bash',
      prefix: ['terraform', 'apply', '-target=module.dev'],
      cwd: at,
      createdAt: 1,
    });
    expect(rule('git push origin feature/login')?.prefix).toEqual([
      'git',
      'push',
      'origin',
      'feature/*',
    ]);
    // Anything else about the push stays as it was.
    expect(rule('git push origin main')?.prefix).toEqual(['git', 'push', 'origin', 'main']);
    expect(rule('git push --set-upstream origin feature/login')?.prefix.at(-1)).toBe(
      'feature/login',
    );
    expect(ruleWords({ prefix: ['git', 'commit', '-m', 'fix the bug'] })).toBe(
      'git commit -m "fix the bug"',
    );
    expect(rule('Get-ChildItem', 'PowerShell')?.tool).toBe('PowerShell');
    expect(rule('git push origin feature/login', 'Edit')).toBeUndefined();
  });

  it('refuses shells, interpreters, wrappers and what would cover too much', () => {
    for (const command of [
      'bash deploy.sh',
      'sh -c "git push"',
      'zsh',
      'python3 scripts/sync.py',
      'node build.js',
      'ruby x.rb',
      'perl -e 1',
      'pwsh -File x.ps1',
      'sudo apt install nginx',
      'rm -r build',
      'git',
      'npm run deploy',
      'npm',
      'pnpm deploy',
      'npx prisma migrate deploy',
      'curl https://example.com',
      'wget https://example.com',
      'ssh prod',
      'env',
      'xargs',
      'terraform',
      'docker exec web rails console',
      'npm run deploy:dev',
      'cargo run --release',
      './scripts/deploy.sh staging',
      '/usr/local/bin/deploy staging',
      'FOO=1 terraform apply',
      'make deploy',
    ])
      expect(rule(command), command).toBeUndefined();
  });

  it('refuses a command line that is more than one command', () => {
    for (const command of [
      'git push origin feature/x && rm -rf ~',
      'git push origin feature/x; curl evil.example',
      'git log | head',
      'terraform apply > out.txt',
      'terraform apply -target=$(cat target)',
      'terraform apply -target=$TARGET',
      'git push origin `whoami`',
      'git push origin feature/*',
      'git push origin feature/x\nrm -rf ~',
      'nohup git push origin feature/x',
      '(git push origin feature/x)',
    ])
      expect(rule(command), command).toBeUndefined();
  });

  it('covers the whole command, every word in turn, and only there', () => {
    const push = rule('git push origin feature/login');
    if (!push) throw new Error('no rule');
    const covers = (command: string, cwd = at) => ruleMatches(push, 'Bash', command, cwd);
    expect(covers('git push origin feature/login')).toBe(true);
    expect(covers('git push origin feature/checkout-v2')).toBe(true);
    // Nothing more, nothing else: another branch too, a force, a refspec, another remote.
    expect(covers('git push origin feature/login main')).toBe(false);
    expect(covers('git push --force origin feature/login')).toBe(false);
    expect(covers('git push origin feature/x:main')).toBe(false);
    expect(covers('git push origin feature/../main')).toBe(false);
    expect(covers('git push origin feature/')).toBe(false);
    expect(covers('git push upstream feature/login')).toBe(false);
    expect(covers('git push origin feature/login && rm -rf ~')).toBe(false);
    expect(covers('git push origin feature/login', '/work/other')).toBe(false);
    expect(ruleMatches(push, 'PowerShell', 'git push origin feature/login', at)).toBe(false);
    // A rule from anywhere that Conch wouldn't make now is never used.
    expect(ruleMatches({ tool: 'Bash', prefix: ['bash'], createdAt: 1 }, 'Bash', 'bash', at)).toBe(
      false,
    );
    expect(
      ruleMatches({ tool: 'Bash', prefix: ['git', '*'], createdAt: 1 }, 'Bash', 'git push', at),
    ).toBe(false);
    expect(validRule(push)).toBe(true);
    expect(sameRule(push, { ...push, createdAt: 2 })).toBe(true);
  });

  it('reads settings written before rules existed', () => {
    expect(Preferences.parse({}).autoRules).toEqual([]);
    expect(Preferences.parse({}).autoEnvironment).toBe('');
    expect(
      AutoRule.parse({ tool: 'Bash', prefix: ['terraform', 'plan'], createdAt: 1, later: true }),
    ).toEqual({ tool: 'Bash', prefix: ['terraform', 'plan'], createdAt: 1 });
  });
});
