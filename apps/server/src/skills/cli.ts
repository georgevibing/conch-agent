/**
 * `conch skills …`: sign the skills you share, and say whose you trust
 * (ADR 0031). Having this terminal is the proof that it's you, as for
 * `conch password`.
 *
 * - `skills sign <folder> [--as "Your name"]` writes `SKILL.sig` with your key
 *   (made the first time, kept in `skills.signing.json`, locked with this
 *   computer's device key: ADR 0047).
 * - `skills key` shows your public key and its fingerprint, to give people who
 *   want to trust you before they install anything of yours. `skills key
 *   --new` makes a new one, only when yours can't be opened.
 * - `skills trust <key> --as "Their name"`, `skills trusted`, `skills forget <fingerprint>`.
 */
import { lstat, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { SKILLS_SUBCOMMANDS } from '../cliCommands';
import type { Ui } from '../cli/ui';
import { readKey, splitSkill } from './frontmatter';
import { fingerprintOf, publicKeyFrom, SIG_FILE, signSkill } from './signing';
import { SigningKeyError, type SkillTrust } from './trust';

export interface SkillsIo {
  /** Everything a person reads goes through the terminal kit. */
  ui: Ui;
  /** What to tell people to type: `conch skills …` (or `pnpm conch` in a checkout). */
  conch: (args: string) => string;
  /** Where relative folders start: where `conch` was typed. */
  cwd: string;
  /** Your name when there's no key yet and no `--as`. */
  defaultName: string;
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1]?.trim() || undefined : undefined;
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i]?.startsWith('--')) i++;
    else if (args[i]) out.push(args[i] as string);
  }
  return out;
}

export async function skillsCommand(
  args: string[],
  trust: SkillTrust,
  io: SkillsIo,
): Promise<number> {
  const { ui } = io;
  try {
    return await run(args, trust, io);
  } catch (error) {
    if (!(error instanceof SigningKeyError)) throw error;
    // Fail closed, in words: nothing signed, nothing replaced, and what to do.
    ui.error(`${error.message} Nothing was signed.`);
    ui.hint(
      error.reason === 'keychain'
        ? 'Unlock this computer’s keychain (or sign in again), then run this again.'
        : `Restore it from a passphrase-locked backup, or make a new one: ${ui.code(io.conch('skills key --new'))}`,
    );
    return 1;
  }
}

async function run(args: string[], trust: SkillTrust, io: SkillsIo): Promise<number> {
  const { ui, conch } = io;
  const [verb = 'help', target] = positional(args);
  const as = option(args, '--as');

  if (verb === 'sign') {
    if (!target) {
      ui.say('Which skill would you like to sign?');
      ui.hint(ui.code(conch('skills sign <folder>')));
      return 1;
    }
    const folder = resolve(io.cwd, target);
    let text: string;
    try {
      if (!(await lstat(folder)).isDirectory()) throw new Error('not a folder');
      text = await readFile(join(folder, 'SKILL.md'), 'utf8');
    } catch {
      ui.error(`There's no SKILL.md in ${folder}.`);
      return 1;
    }
    const name = readKey(splitSkill(text).front, 'name')?.trim() || basename(folder);
    const signer = await trust.signer(as ?? io.defaultName);
    await signSkill(folder, name, signer);
    ui.ok(`Signed “${name}” as ${ui.bold(signer.name)}. ✨`);
    ui.hint(
      `${SIG_FILE} sits next to its SKILL.md. Change anything in the folder and sign it again.`,
    );
    ui.hint(`People who trust your key see “Verified: signed by ${signer.name}”.`);
    ui.hint(`Your key’s fingerprint: ${fingerprintOf(signer.publicKey)}`);
    return 0;
  }

  if (verb === 'key' && args.includes('--new')) {
    const { signer, replaced } = await trust.replaceSigner(as ?? io.defaultName);
    if (!replaced) {
      ui.ok(`Your key opens fine, so it was kept (${fingerprintOf(signer.publicKey)}).`);
      return 0;
    }
    ui.ok(`A new signing key for ${ui.bold(signer.name)}.`);
    ui.kv([['Fingerprint', fingerprintOf(signer.publicKey)]]);
    ui.hint('Skills you signed with the old key still say “Verified” here.');
    ui.hint(`Anyone who trusts you needs the new one: ${ui.code(conch('skills key'))}`);
    return 0;
  }

  if (verb === 'key') {
    const signer = await trust.signer(as ?? io.defaultName);
    ui.box(
      [
        `${ui.dim('Public key ')}  ${signer.publicKey}`,
        `${ui.dim('Fingerprint')}  ${fingerprintOf(signer.publicKey)}`,
      ],
      { title: `Your signing key · ${signer.name}`, tone: 'accent' },
    );
    ui.blank();
    ui.hint('Share the public key. The private one never leaves this computer.');
    ui.hint('Someone can trust you with:');
    ui.command(conch(`skills trust ${signer.publicKey} --as "${signer.name}"`));
    return 0;
  }

  if (verb === 'trust') {
    if (!target || !publicKeyFrom(target)) {
      ui.error('That isn’t a key Conch accepts: a signing key is 43 letters and digits.');
      return 1;
    }
    if (!as) {
      ui.say('Whose key is it?');
      ui.hint(ui.code(conch('skills trust <key> --as "Their name"')));
      return 1;
    }
    const added = await trust.trust({ key: target, name: as });
    ui.ok(`You trust ${ui.bold(added.name)} (${added.fingerprint}).`);
    ui.hint('Their signed skills say “Verified”, and their signed updates carry on.');
    return 0;
  }

  if (verb === 'trusted') {
    const publishers = await trust.list();
    if (!publishers.length) {
      ui.say('You don’t trust any publishers yet.');
      ui.hint(`Trust someone’s key: ${ui.code(conch('skills trust <key> --as "Their name"'))}`);
    }
    const label = (p: { name: string; you?: boolean }) => `${p.name}${p.you ? ' (you)' : ''}`;
    const width = Math.max(0, ...publishers.map((p) => label(p).length)) + 2;
    for (const p of publishers)
      ui.say(
        `${ui.accent(p.name)}${p.you ? ui.dim(' (you)') : ''}${' '.repeat(width - label(p).length)}${ui.dim(p.fingerprint)}`,
      );
    return 0;
  }

  if (verb === 'forget') {
    const fingerprint = positional(args).slice(1).join(' ');
    if (!fingerprint || !(await trust.forget(fingerprint.toUpperCase()))) {
      ui.error('No publisher has that fingerprint.');
      ui.hint(`See them: ${ui.code(conch('skills trusted'))}`);
      return 1;
    }
    ui.ok('Forgotten. Their skills are “signed by someone you don’t know” again.');
    return 0;
  }

  if (verb !== 'help') {
    ui.error(`Hmm, there’s no “skills ${verb}”. Here’s what there is:`);
    ui.blank();
  }
  ui.say(ui.bold(conch('skills <command>')));
  ui.blank();
  for (const { usage, summary } of SKILLS_SUBCOMMANDS)
    ui.say(`  ${ui.accent(usage.padEnd(28))}${ui.dim(summary)}`);
  return verb === 'help' ? 0 : 1;
}
