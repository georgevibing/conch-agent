import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { captureUi } from '../cli/ui';
import { skillsCommand, type SkillsIo } from './cli';
import { checkSignature, fingerprintOf, newSigner, SIG_FILE } from './signing';
import { deviceSealer } from '../lib/sealed';
import { SkillTrust } from './trust';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'conch-skills-cli-'));
  const { ui, text } = captureUi();
  /** What was said, a line each, without the indent. */
  const lines = () =>
    text()
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => line.replace(/^ {2}/, ''));
  const io: SkillsIo = {
    ui,
    conch: (args) => `conch ${args}`,
    cwd: root,
    defaultName: 'ada',
  };
  const trust = new SkillTrust(join(root, 'home'), {
    sealer: deviceSealer(async () => Buffer.alloc(32, 4)),
  });
  const folder = join(root, 'weekly-review');
  await mkdir(folder);
  await writeFile(
    join(folder, 'SKILL.md'),
    '---\nname: weekly-review\ndescription: Weekly review.\n---\n# Weekly\nDo it.\n',
  );
  return { root, lines, io, trust, folder };
}

describe('conch skills', () => {
  it('signs a folder (relative to where you typed it) with your key, made once', async () => {
    const { lines, io, trust, folder } = await setup();
    expect(await skillsCommand(['sign', 'weekly-review', '--as', 'Ada Lovelace'], trust, io)).toBe(
      0,
    );
    expect(lines()[0]).toBe('✓ Signed “weekly-review” as Ada Lovelace. ✨');
    const signed = JSON.parse(await readFile(join(folder, SIG_FILE), 'utf8'));
    expect(signed).toMatchObject({ name: 'weekly-review', publisher: { name: 'Ada Lovelace' } });
    // Trusted here from the start: you made it.
    expect(await checkSignature(folder, 'weekly-review', await trust.fingerprints())).toMatchObject(
      {
        state: 'verified',
      },
    );
    // Signing again keeps the same key, whatever name is typed.
    await skillsCommand(['sign', folder, '--as', 'Someone'], trust, io);
    expect(JSON.parse(await readFile(join(folder, SIG_FILE), 'utf8')).publisher.key).toBe(
      signed.publisher.key,
    );
  });

  it('says so when there’s no skill there', async () => {
    const { lines, io, trust, root } = await setup();
    expect(await skillsCommand(['sign', root], trust, io)).toBe(1);
    expect(lines()[0]).toMatch(/There's no SKILL.md/);
  });

  it('trusts a key by hand, and only a real one; forgets by fingerprint', async () => {
    const { lines, io, trust } = await setup();
    expect(await skillsCommand(['trust', 'not-a-key', '--as', 'Ada'], trust, io)).toBe(1);
    const ada = newSigner('Ada');
    expect(await skillsCommand(['trust', ada.publicKey], trust, io)).toBe(1);
    expect(await skillsCommand(['trust', ada.publicKey, '--as', 'Ada'], trust, io)).toBe(0);
    const fingerprint = fingerprintOf(ada.publicKey);
    expect(lines().at(-2)).toBe(`✓ You trust Ada (${fingerprint}).`);
    await skillsCommand(['trusted'], trust, io);
    expect(lines().at(-1)).toBe(`Ada  ${fingerprint}`);
    expect(
      await skillsCommand(['forget', ...fingerprint.toLowerCase().split(' ')], trust, io),
    ).toBe(0);
    expect(await trust.list()).toEqual([]);
  });

  it('shows your key to share', async () => {
    const { lines, io, trust } = await setup();
    await skillsCommand(['key', '--as', 'Ada'], trust, io);
    const signer = await trust.signer('x');
    expect(lines().join('\n')).toContain(`Public key   ${signer.publicKey}`);
    expect(lines().join('\n')).not.toContain(signer.privateKey);
  });
});
