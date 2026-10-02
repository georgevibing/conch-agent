/**
 * The gateway for the `releases` journey (ADR 0048), under the supervisor
 * like `pnpm start`, beside a pretend upstream: a bare git "origin" with
 * releases tagged and signed by a key made here with `ssh-keygen`, and a
 * pretend Conch installed from it at v0.1.0. Nothing reaches the network.
 *
 * Each version of the pretend Conch is a few files and a `start.ts` that
 * runs this repository's gateway, so updating to it really swaps folders and
 * restarts. Its pnpm is pretend too: "installing" links this repository's
 * `node_modules`, "building" does nothing.
 *
 * `CONCH_E2E_RELEASES_WORLD` is where it all lives; the spec signs new tags
 * there with the same key (`world.json` says where things are).
 */
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { commit, git, makeKey, signer, tag } from '../apps/server/src/release/testing';
import { notes, pretendConch } from './releases-world';

const repoRoot = join(import.meta.dirname, '..');

if (process.env.CONCH_SUPERVISED === '1') {
  // Started by the supervisor before any swap: the gateway itself.
  await import('../apps/server/src/main');
} else {
  const base = process.env.CONCH_E2E_RELEASES_WORLD;
  if (!base) throw new Error('CONCH_E2E_RELEASES_WORLD names where the pretend upstream goes.');
  const origin = join(base, 'origin.git');
  const maker = join(base, 'maker');
  const conch = join(base, 'conch');
  mkdirSync(base, { recursive: true });
  const key = makeKey(base, 'maker-key');
  const signers = `${signer('maker@example.com', key)}\n`;
  git(base, 'init', '--quiet', '--bare', '-b', 'main', origin);
  git(base, 'clone', '--quiet', origin, maker);
  git(maker, 'checkout', '--quiet', '-b', 'main');
  commit(maker, pretendConch('0.1.0', signers), 'release: v0.1.0');
  tag(maker, 'v0.1.0', notes('0.1.0', ['The first version']), key);
  commit(maker, pretendConch('0.2.0', signers), 'release: v0.2.0');
  tag(
    maker,
    'v0.2.0',
    notes('0.2.0', ['Edit pages by hand, with a live preview', 'Connect Teams, Matrix and WeChat']),
    key,
  );
  commit(maker, pretendConch('0.3.0-beta.1', signers), 'release: v0.3.0-beta.1');
  tag(maker, 'v0.3.0-beta.1', notes('0.3.0-beta.1', ['Talk to your assistant, hands free']), key);
  git(maker, 'push', '--quiet', '-u', 'origin', 'main', '--tags');
  git(base, 'clone', '--quiet', origin, conch);
  git(conch, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', 'v0.1.0');

  // The pretend pnpm: `npm_execpath` is how Conch finds the pnpm that started it.
  const pnpm = join(base, 'pnpm-pretend.cjs');
  writeFileSync(
    pnpm,
    `const fs = require('fs');
const path = require('path');
const step = process.argv.includes('build') ? 'build' : 'install';
fs.appendFileSync(${JSON.stringify(join(base, 'pnpm.log'))}, step + ' ' + process.cwd() + '\\n');
if (step === 'install') {
  console.log('Progress: resolved 10, reused 10, downloaded 0, added 10');
  for (const dir of ['node_modules', 'apps/server/node_modules']) {
    const link = path.join(process.cwd(), dir);
    if (!fs.existsSync(link)) fs.symlinkSync(path.join(${JSON.stringify(repoRoot)}, dir), link, 'dir');
  }
}
`,
  );
  // Installed, as the installer would: what it runs is this repository's code.
  for (const dir of ['node_modules', 'apps/server/node_modules'])
    symlinkSync(join(repoRoot, dir), join(conch, dir), 'dir');
  writeFileSync(join(base, 'world.json'), JSON.stringify({ origin, maker, conch, key }));
  Object.assign(process.env, {
    CONCH_CHECKOUT: conch,
    npm_execpath: pnpm,
    CONCH_SUPERVISE: '1',
  });
  await import('../apps/server/src/start');
}
