/**
 * `pnpm conch skills …`: sign the skills you share, and say whose you trust
 * (ADR 0031). Having this terminal is the proof that it's you, as for
 * `pnpm conch password`.
 *
 * - `skills sign <folder> [--as "Your name"]` writes `SKILL.sig` with your key
 *   (made the first time, kept in `skills.signing.json`, locked with this
 *   computer's device key: ADR 0040).
 * - `skills key` shows your public key and its fingerprint, to give people who
 *   want to trust you before they install anything of yours. `skills key
 *   --new` makes a new one, only when yours can't be opened.
 * - `skills trust <key> --as "Their name"`, `skills trusted`, `skills forget <fingerprint>`.
 */
import { lstat, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { SKILLS_SUBCOMMANDS } from '../cliCommands';
import { readKey, splitSkill } from './frontmatter';
import { fingerprintOf, publicKeyFrom, SIG_FILE, signSkill } from './signing';
import { NEW_KEY_COMMAND, SigningKeyError, type SkillTrust } from './trust';

export interface SkillsIo {
  say: (line?: string) => void;
  bold: (s: string) => string;
  dim: (s: string) => string;
  green: (s: string) => string;
  /** Where relative folders start: where `pnpm conch` was typed. */
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
  try {
    return await run(args, trust, io);
  } catch (error) {
    if (!(error instanceof SigningKeyError)) throw error;
    // Fail closed, in words: nothing signed, nothing replaced, and what to do.
    io.say(`✗ ${error.message} Nothing was signed.`);
    io.say(
      io.dim(
        error.reason === 'keychain'
          ? 'Unlock this computer’s keychain (or sign in again), then run this again.'
          : `Restore it from a passphrase-locked backup, or make a new one: ${NEW_KEY_COMMAND}`,
      ),
    );
    return 1;
  }
}

async function run(args: string[], trust: SkillTrust, io: SkillsIo): Promise<number> {
  const { say, bold, dim, green } = io;
  const [verb = 'help', target] = positional(args);
  const as = option(args, '--as');

  if (verb === 'sign') {
    if (!target) {
      say('Which skill? pnpm conch skills sign <folder>');
      return 1;
    }
    const folder = resolve(io.cwd, target);
    let text: string;
    try {
      if (!(await lstat(folder)).isDirectory()) throw new Error('not a folder');
      text = await readFile(join(folder, 'SKILL.md'), 'utf8');
    } catch {
      say(`✗ There's no SKILL.md in ${folder}.`);
      return 1;
    }
    const name = readKey(splitSkill(text).front, 'name')?.trim() || basename(folder);
    const signer = await trust.signer(as ?? io.defaultName);
    await signSkill(folder, name, signer);
    say(`${green('✓')} Signed “${name}” as ${bold(signer.name)}.`);
    say(
      dim(`${SIG_FILE} is next to its SKILL.md. Change anything in the folder and sign it again.`),
    );
    say(dim(`People who trust your key see “Verified: signed by ${signer.name}”.`));
    say(dim(`Your key's fingerprint: ${fingerprintOf(signer.publicKey)}`));
    return 0;
  }

  if (verb === 'key' && args.includes('--new')) {
    const { signer, replaced } = await trust.replaceSigner(as ?? io.defaultName);
    if (!replaced) {
      say(`Your key opens fine, so it was kept (${fingerprintOf(signer.publicKey)}).`);
      return 0;
    }
    say(`${green('✓')} A new signing key for ${bold(signer.name)}.`);
    say(dim(`Fingerprint  ${fingerprintOf(signer.publicKey)}`));
    say(dim('Skills you signed with the old key still say “Verified” here.'));
    say(dim('Anyone who trusts you needs the new one: pnpm conch skills key'));
    return 0;
  }

  if (verb === 'key') {
    const signer = await trust.signer(as ?? io.defaultName);
    say(bold(`Your signing key (${signer.name})`));
    say();
    say(`Public key   ${signer.publicKey}`);
    say(`Fingerprint  ${fingerprintOf(signer.publicKey)}`);
    say();
    say(dim('Share the public key; the private one never leaves this computer.'));
    say(
      dim(
        `Someone can trust you with: pnpm conch skills trust ${signer.publicKey} --as "${signer.name}"`,
      ),
    );
    return 0;
  }

  if (verb === 'trust') {
    if (!target || !publicKeyFrom(target)) {
      say('✗ That isn’t a key Conch accepts: a signing key is 43 letters and digits.');
      return 1;
    }
    if (!as) {
      say('Whose key is it? pnpm conch skills trust <key> --as "Their name"');
      return 1;
    }
    const added = await trust.trust({ key: target, name: as });
    say(`${green('✓')} You trust ${bold(added.name)} (${added.fingerprint}).`);
    say(dim('Their signed skills say “Verified”, and their signed updates carry on.'));
    return 0;
  }

  if (verb === 'trusted') {
    const publishers = await trust.list();
    if (!publishers.length) say('You don’t trust any publishers yet.');
    for (const p of publishers)
      say(`${bold(p.name)}${p.you ? dim(' (you)') : ''}  ${dim(p.fingerprint)}`);
    return 0;
  }

  if (verb === 'forget') {
    const fingerprint = positional(args).slice(1).join(' ');
    if (!fingerprint || !(await trust.forget(fingerprint.toUpperCase()))) {
      say('✗ No publisher with that fingerprint. pnpm conch skills trusted lists them.');
      return 1;
    }
    say(`${green('✓')} Forgotten. Their skills are “signed by someone you don’t know” again.`);
    return 0;
  }

  say(bold('pnpm conch skills <command>'));
  say();
  for (const { usage, summary } of SKILLS_SUBCOMMANDS) say(`${usage.padEnd(28)}${dim(summary)}`);
  return verb === 'help' ? 0 : 1;
}
