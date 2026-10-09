/**
 * The release key (ADR 0127): the SSH key CI signs release tags with.
 * `pnpm release key` makes one (or uses the one made before), puts its
 * public half in `release/allowed_signers`, and offers to hand the private
 * half to GitHub as the `RELEASE_SIGNING_KEY` secret of the `release`
 * environment. The private half never goes anywhere else.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { run } from '../lib/proc';
import { Stop } from './history';
import { keyOf, SIGNERS_FILE, signerKeys, signerLine } from './signing';

export const KEY_NAME = 'conch-release';
export const SECRET = 'RELEASE_SIGNING_KEY';
export const ENVIRONMENT = 'release';

export interface KeyDeps {
  root: string;
  home: string;
  say: (line: string) => void;
  ask: (question: string) => Promise<string>;
  sshKeygen?: string;
  gh?: string;
}

const yes = (answer: string) => /^y(es)?$/i.test(answer.trim());

export async function setUpKey(deps: KeyDeps): Promise<void> {
  const { say } = deps;
  if (!deps.sshKeygen) throw new Stop('Making a key needs ssh-keygen, which comes with Git.');
  const file = join(deps.home, '.ssh', KEY_NAME);
  if (existsSync(file)) say(`Using the release key made before: ${file}`);
  else {
    const made = await run(
      deps.sshKeygen,
      ['-q', '-t', 'ed25519', '-N', '', '-C', KEY_NAME, '-f', file],
      { timeout: 60_000 },
    );
    if (made.code !== 0)
      throw new Stop(`ssh-keygen couldn’t make the key: ${(made.stderr || made.stdout).trim()}`);
    say(`Made a release key: ${file}`);
  }
  const pub = keyOf(await readFile(`${file}.pub`, 'utf8'));
  if (!pub) throw new Stop(`${file}.pub isn’t an SSH public key.`);

  const listPath = join(deps.root, SIGNERS_FILE);
  const list = await readFile(listPath, 'utf8').catch(() => '');
  if (signerKeys(list).includes(pub)) say(`It’s in ${SIGNERS_FILE} already.`);
  else {
    if (signerKeys(list).length)
      say(
        `${SIGNERS_FILE} trusts another key too. Installs only take a list from a release signed by a key they already trust, so release once more with that one before removing it.`,
      );
    await writeFile(
      listPath,
      `${list.trimEnd()}${list.trim() ? '\n' : ''}${signerLine(KEY_NAME, pub)}\n`,
    );
    say(`Added it to ${SIGNERS_FILE}. Commit that, so every Conch trusts releases signed with it.`);
  }

  const command = `gh secret set ${SECRET} --env ${ENVIRONMENT} < ${file}`;
  if (
    deps.gh &&
    yes(
      await deps.ask(
        `Set up GitHub’s “${ENVIRONMENT}” environment (main only) and give it the private key? (y/N) `,
      ),
    )
  ) {
    const gh = (args: string[], input?: string) =>
      run(deps.gh as string, args, { cwd: deps.root, timeout: 60_000, ...(input && { input }) });
    const first = (r: { stderr: string; stdout: string }) =>
      (r.stderr || r.stdout).trim().split('\n')[0] ?? '';
    // Only main may use it: a branch's workflow can't sign a release.
    const environment = await gh([
      'api',
      '--method',
      'PUT',
      `repos/{owner}/{repo}/environments/${ENVIRONMENT}`,
      '-F',
      'deployment_branch_policy[protected_branches]=false',
      '-F',
      'deployment_branch_policy[custom_branch_policies]=true',
    ]);
    if (environment.code !== 0)
      throw new Stop(
        `gh couldn’t make the ${ENVIRONMENT} environment (${first(environment)}). docs/RELEASING.md says how by hand.`,
      );
    const policy = await gh([
      'api',
      '--method',
      'POST',
      `repos/{owner}/{repo}/environments/${ENVIRONMENT}/deployment-branch-policies`,
      '-f',
      'name=main',
      '-f',
      'type=branch',
    ]);
    // It's there already when this ran before.
    if (policy.code !== 0 && !/already exists/i.test(`${policy.stderr}${policy.stdout}`))
      throw new Stop(`gh couldn’t keep the ${ENVIRONMENT} environment to main (${first(policy)}).`);
    const set = await gh(
      ['secret', 'set', SECRET, '--env', ENVIRONMENT],
      await readFile(file, 'utf8'),
    );
    if (set.code !== 0)
      throw new Stop(`gh couldn’t set the secret (${first(set)}). Run it yourself: ${command}`);
    say(
      `GitHub has it, as the ${SECRET} secret of the ${ENVIRONMENT} environment, which only main can use.`,
    );
  } else say(`Then give GitHub the private key: ${command}`);
  say(
    'Keep a copy of the private key somewhere safe, like a password manager: releases can only change keys with it.',
  );
}
