/**
 * Your key for signing skills, locked with this computer's device key (ADR
 * 0040): a key left in the clear is locked in one atomic replace with no
 * copy kept, and a file that was changed (or locked elsewhere) fails closed,
 * in words, without ever being replaced by a new key.
 */
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isBrokenCopy } from '../lib/recover';
import { deviceSealer, isSealed } from '../lib/sealed';
import { skillsCommand, type SkillsIo } from './cli';
import { signingKeyCheck } from './doctor';
import { newSigner, SIG_FILE, type Signer } from './signing';
import { NEW_KEY_COMMAND, SIGNER_FILE, SigningKeyError, SkillTrust } from './trust';

const thisComputer = deviceSealer(async () => Buffer.alloc(32, 1));
const anotherComputer = deviceSealer(async () => Buffer.alloc(32, 2));
const noKeychain = deviceSealer(async () => {
  throw new Error('The Keychain wouldn’t answer.');
});

async function home() {
  return mkdtemp(join(tmpdir(), 'conch-signing-key-'));
}

/** Every file under a folder, with what's in it. */
async function everything(dir: string): Promise<{ name: string; text: string }[]> {
  const out: { name: string; text: string }[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out.push({ name: path, text: await readFile(path, 'latin1') });
  }
  return out;
}

/** Nothing on disk carries the private key, however it's spelled. */
async function expectNoPlainKey(dir: string, signer: Signer) {
  const der = Buffer.from(signer.privateKey, 'base64url');
  const spellings = [
    signer.privateKey,
    der.toString('base64'),
    der.toString('hex'),
    der.toString('latin1'),
    // The 32-byte seed at the end of the PKCS#8 encoding.
    der.subarray(-32).toString('base64url'),
  ];
  for (const file of await everything(dir))
    for (const spelling of spellings) expect(file.text, file.name).not.toContain(spelling);
}

async function plainKeyIn(dir: string, signer = newSigner('Ada')) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, SIGNER_FILE), `${JSON.stringify(signer, null, 2)}\n`, {
    mode: 0o600,
  });
  return signer;
}

describe('your key for signing skills, locked with this computer’s key', () => {
  it('locks a key left in the clear, atomically, and keeps no plaintext copy', async () => {
    const dir = await home();
    const ada = await plainKeyIn(dir);
    const trust = new SkillTrust(dir, { sealer: thisComputer });
    expect(await trust.signer('Someone else')).toEqual(ada);
    const kept = await readFile(join(dir, SIGNER_FILE), 'utf8');
    expect(isSealed(kept)).toBe(true);
    expect((await stat(join(dir, SIGNER_FILE))).mode & 0o777).toBe(0o600);
    // No half-written file, no set-aside copy, nothing in the clear anywhere.
    expect((await readdir(dir)).sort()).toEqual([SIGNER_FILE]);
    await expectNoPlainKey(dir, ada);
    // And it opens again, the same key.
    expect(await new SkillTrust(dir, { sealer: thisComputer }).signer('x')).toEqual(ada);
  });

  it('a start locks one left in the clear, and leaves a locked one alone', async () => {
    const dir = await home();
    const ada = await plainKeyIn(dir);
    const trust = new SkillTrust(dir, { sealer: thisComputer });
    expect(await trust.lockIfClear()).toBe(true);
    await expectNoPlainKey(dir, ada);
    // Locked already: a start doesn't open it (or reach for the keychain).
    const asleep = new SkillTrust(dir, { sealer: noKeychain });
    expect(await asleep.lockIfClear()).toBe(false);
  });

  it('a changed file fails closed in words, and is never replaced by a new key', async () => {
    const dir = await home();
    const trust = new SkillTrust(dir, { sealer: thisComputer });
    await trust.signer('Ada');
    const path = join(dir, SIGNER_FILE);
    const sealed = JSON.parse(await readFile(path, 'utf8')) as { c: string };
    const flipped = `${sealed.c.slice(0, 10)}${sealed.c[10] === 'A' ? 'B' : 'A'}${sealed.c.slice(11)}`;
    const tampered = `${JSON.stringify({ ...sealed, c: flipped })}\n`;
    await writeFile(path, tampered);
    const trusted = await trust.list();

    const opening = new SkillTrust(dir, { sealer: thisComputer }).signer('Mallory');
    await expect(opening).rejects.toBeInstanceOf(SigningKeyError);
    await expect(opening).rejects.toThrow(
      'Your key for signing skills can’t be opened: the file was changed, or it was locked on another computer.',
    );
    // Nothing was made in its place: the file and the trust list are as they were.
    expect(await readFile(path, 'utf8')).toBe(tampered);
    expect(await trust.list()).toEqual(trusted);
  });

  it('a key locked on another computer doesn’t open here', async () => {
    const dir = await home();
    await new SkillTrust(dir, { sealer: anotherComputer }).signer('Ada');
    expect(await new SkillTrust(dir, { sealer: thisComputer }).signingKey()).toMatchObject({
      state: 'unusable',
      reason: 'changed',
    });
  });

  it('a key in the clear that doesn’t hold together isn’t used, or locked, or replaced', async () => {
    const dir = await home();
    const ada = newSigner('Ada');
    // Someone swapped the public half for their own.
    await plainKeyIn(dir, { ...ada, publicKey: newSigner('Mallory').publicKey });
    const trust = new SkillTrust(dir, { sealer: thisComputer });
    await expect(trust.signer('x')).rejects.toThrow(
      'Your key for signing skills is damaged, so Conch won’t use it.',
    );
    await writeFile(join(dir, SIGNER_FILE), '{"name": "Ada", "privateKey": ');
    expect(await trust.signingKey()).toMatchObject({ state: 'unusable', reason: 'damaged' });
    expect(await readFile(join(dir, SIGNER_FILE), 'utf8')).toBe('{"name": "Ada", "privateKey": ');
  });

  it('without the keychain, nothing is made and nothing is written in the clear', async () => {
    const dir = await home();
    const trust = new SkillTrust(dir, { sealer: noKeychain });
    await expect(trust.signer('Ada')).rejects.toMatchObject({ reason: 'keychain' });
    expect(await readdir(dir).catch(() => [])).toEqual([]);
    // One in the clear stays put rather than be lost: Repair locks it once the keychain answers.
    const ada = await plainKeyIn(dir);
    await expect(trust.signer('Ada')).rejects.toMatchObject({ reason: 'keychain' });
    expect(JSON.parse(await readFile(join(dir, SIGNER_FILE), 'utf8'))).toEqual(ada);
    await expect(trust.replaceSigner('Ada')).rejects.toMatchObject({ reason: 'keychain' });
  });

  it('a new key only replaces one that can’t be opened, and keeps the old one locked aside', async () => {
    const dir = await home();
    const trust = new SkillTrust(dir, { sealer: anotherComputer });
    const old = await trust.signer('Ada');
    const here = new SkillTrust(dir, { sealer: thisComputer });
    expect(await here.replaceSigner('Ada')).toMatchObject({ replaced: true });
    const made = await here.signer('x');
    expect(made.publicKey).not.toBe(old.publicKey);
    // Both are yours: skills signed with the old key still verify here.
    expect((await here.list()).filter((p) => p.you)).toHaveLength(2);
    const aside = (await readdir(dir)).filter(isBrokenCopy);
    expect(aside).toHaveLength(1);
    expect(isSealed(await readFile(join(dir, aside[0] ?? ''), 'utf8'))).toBe(true);
    await expectNoPlainKey(dir, old);
    await expectNoPlainKey(dir, made);
    // One that opens is kept.
    expect(await here.replaceSigner('Ada')).toMatchObject({ replaced: false, signer: made });
  });

  it('a damaged one in the clear is removed when replaced: no plaintext copy is kept', async () => {
    const dir = await home();
    const ada = newSigner('Ada');
    await plainKeyIn(dir, { ...ada, name: '' });
    const trust = new SkillTrust(dir, { sealer: thisComputer });
    expect(await trust.replaceSigner('Ada')).toMatchObject({ replaced: true });
    await expectNoPlainKey(dir, ada);
    expect((await readdir(dir)).filter(isBrokenCopy)).toEqual([]);
  });
});

describe('pnpm conch skills, when the key can’t be opened', () => {
  async function setup() {
    const root = await home();
    const lines: string[] = [];
    const io: SkillsIo = {
      say: (line = '') => void lines.push(line),
      bold: (s) => s,
      dim: (s) => s,
      green: (s) => s,
      cwd: root,
      defaultName: 'ada',
    };
    const folder = join(root, 'weekly');
    await mkdir(folder);
    await writeFile(join(folder, 'SKILL.md'), '---\nname: weekly\ndescription: W.\n---\nDo it.\n');
    return { root, lines, io, folder, dir: join(root, 'home') };
  }

  it('signs nothing and says what to do', async () => {
    const { lines, io, folder, dir } = await setup();
    await new SkillTrust(dir, { sealer: anotherComputer }).signer('Ada');
    const trust = new SkillTrust(dir, { sealer: thisComputer });
    expect(await skillsCommand(['sign', folder], trust, io)).toBe(1);
    expect(lines[0]).toBe(
      '✗ Your key for signing skills can’t be opened: the file was changed, or it was locked on another computer. Nothing was signed.',
    );
    expect(lines[1]).toContain(NEW_KEY_COMMAND);
    await expect(readFile(join(folder, SIG_FILE))).rejects.toThrow();

    // `key --new` makes a new one; then signing works.
    expect(await skillsCommand(['key', '--new', '--as', 'Ada'], trust, io)).toBe(0);
    expect(lines.join('\n')).toContain('A new signing key for Ada.');
    expect(await skillsCommand(['sign', folder], trust, io)).toBe(0);
  });

  it('says to unlock the keychain when that’s what’s wrong', async () => {
    const { lines, io, folder, dir } = await setup();
    const trust = new SkillTrust(dir, { sealer: noKeychain });
    expect(await skillsCommand(['sign', folder], trust, io)).toBe(1);
    expect(lines[1]).toMatch(/Unlock this computer’s keychain/);
  });
});

describe('Repair everything', () => {
  const look = (trust: SkillTrust, repair: boolean) =>
    signingKeyCheck(trust).run({ repair, signal: new AbortController().signal });

  it('says nothing when you’ve never signed a skill', async () => {
    expect(await look(new SkillTrust(await home(), { sealer: thisComputer }), false)).toEqual([]);
  });

  it('a look only says a key is in the clear; a repair locks it', async () => {
    const dir = await home();
    const ada = await plainKeyIn(dir);
    const trust = new SkillTrust(dir, { sealer: thisComputer });
    expect(await look(trust, false)).toMatchObject([{ state: 'warning' }]);
    expect(isSealed(await readFile(join(dir, SIGNER_FILE), 'utf8'))).toBe(false);
    expect(await look(trust, true)).toMatchObject([
      { state: 'fixed', message: 'Locked it with this computer’s own key.' },
    ]);
    await expectNoPlainKey(dir, ada);
    expect(await look(trust, false)).toMatchObject([{ state: 'ok' }]);
  });

  it('one that can’t be opened needs you, with the command to copy', async () => {
    const dir = await home();
    await new SkillTrust(dir, { sealer: anotherComputer }).signer('Ada');
    expect(await look(new SkillTrust(dir, { sealer: thisComputer }), true)).toMatchObject([
      {
        state: 'needs-you',
        message: expect.stringContaining('Restore it from a passphrase-locked backup'),
        action: { kind: 'command', command: NEW_KEY_COMMAND },
      },
    ]);
  });
});
