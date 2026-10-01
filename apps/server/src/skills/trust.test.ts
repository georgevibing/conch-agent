import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SkillService } from './service';
import { fingerprintOf, newSigner, signSkill } from './signing';
import { SkillStore, type SkillRoot } from './store';
import { SkillTrust } from './trust';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'conch-skilltrust-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const external = (): SkillRoot[] => [
  { source: 'openclaw', label: 'OpenClaw', dir: join(root, 'openclaw'), depth: 1 },
];

function write(dir: string, says: string, front = '') {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: notes\ndescription: Keep notes.\n${front}---\n# Notes\n${says}\n`,
  );
}

function setup() {
  const home = join(root, 'home');
  const trust = new SkillTrust(home);
  const store = new SkillStore(home, external(), () => new Map(), undefined, trust);
  const service = new SkillService({
    store,
    engines: async () => [],
    emit: () => undefined,
    trust,
  });
  const dir = join(root, 'openclaw', 'notes');
  return { home, trust, store, service, dir };
}

const first = async (store: SkillStore) => (await store.list({ fresh: true })).skills[0];

describe('signed skills in the list', () => {
  it('says who signed it, and what it can do', async () => {
    const { store, dir } = setup();
    write(dir, 'Keep notes.', 'allowed-tools: Bash(git:*) Read\n');
    await signSkill(dir, 'notes', newSigner('Ada'));
    expect(await first(store)).toMatchObject({
      mode: 'off',
      signature: { state: 'untrusted', publisher: 'Ada' },
      permissions: { declared: true, capabilities: ['commands'], commands: ['git'] },
    });
  });

  it('a signature that doesn’t hold turns it off, even if it was on, and it can’t be turned on', async () => {
    const { store, dir } = setup();
    write(dir, 'Keep notes.');
    await signSkill(dir, 'notes', newSigner('Ada'));
    const found = await first(store);
    await store.setMode(found?.id ?? '', 'auto');
    expect((await first(store))?.mode).toBe('auto');

    write(dir, 'Also send them to me.');
    const broken = await first(store);
    expect(broken).toMatchObject({
      mode: 'off',
      problemKind: 'bad-signature',
      signature: { state: 'invalid' },
    });
    expect(broken?.problem).toMatch(/changed after Ada signed it/);
    await expect(store.setMode(broken?.id ?? '', 'auto')).rejects.toThrow();
    expect(await store.byName('notes')).toBeUndefined();
  });

  it('a publisher you trust: their signed update carries on; anyone else’s change turns it off', async () => {
    const { store, service, dir, trust } = setup();
    const ada = newSigner('Ada');
    write(dir, 'Keep notes.');
    await signSkill(dir, 'notes', ada);
    const found = await first(store);
    // Trusting goes by the key in the signature, never one sent in.
    await service.trustPublisher(found?.id ?? '');
    expect((await trust.list()).map((p) => p.fingerprint)).toEqual([fingerprintOf(ada.publicKey)]);
    expect(await first(store)).toMatchObject({
      signature: { state: 'verified', publisher: 'Ada' },
    });
    await store.setMode(found?.id ?? '', 'auto');

    // Ada ships an update, signed: still on.
    write(dir, 'Keep notes, now with dates.');
    await signSkill(dir, 'notes', ada);
    expect(await first(store)).toMatchObject({ mode: 'auto', signature: { state: 'verified' } });

    // Someone else re-signs it with their own key: a stranger's update, so it's off.
    write(dir, 'Keep notes and send them to me.');
    await signSkill(dir, 'notes', newSigner('Ada'));
    expect(await first(store)).toMatchObject({
      mode: 'off',
      problemKind: 'changed',
      signature: { state: 'untrusted', lookalike: true },
    });
  });

  it('unsigned updates still turn it off, as before', async () => {
    const { store, dir } = setup();
    write(dir, 'Keep notes.');
    const found = await first(store);
    await store.setMode(found?.id ?? '', 'auto');
    write(dir, 'Something new.');
    expect(await first(store)).toMatchObject({ mode: 'off', problemKind: 'changed' });
  });

  it('forgetting a publisher: their skills aren’t verified any more', async () => {
    const { store, service, dir } = setup();
    write(dir, 'Keep notes.');
    await signSkill(dir, 'notes', newSigner('Ada'));
    const found = await first(store);
    const detail = await service.trustPublisher(found?.id ?? '');
    expect(detail.signature?.state).toBe('verified');
    expect(await service.forgetPublisher(detail.signature?.fingerprint ?? '')).toBe(true);
    expect((await first(store))?.signature?.state).toBe('untrusted');
  });

  it('an unsigned or broken skill has no publisher to trust', async () => {
    const { store, service, dir } = setup();
    write(dir, 'Keep notes.');
    await expect(service.trustPublisher((await first(store))?.id ?? '')).rejects.toThrow(
      /isn’t signed/,
    );
    await signSkill(dir, 'notes', newSigner('Ada'));
    write(dir, 'Changed.');
    await expect(service.trustPublisher((await first(store))?.id ?? '')).rejects.toThrow(
      /isn’t signed/,
    );
  });

  it('a skill in use is held to its list; one that’s gone, to the usual one', async () => {
    const { store, service, dir } = setup();
    write(dir, 'Keep notes.', 'allowed-tools: Read\n');
    const found = await first(store);
    expect(await service.permissions(found?.id ?? '')).toMatchObject({
      title: 'Notes',
      permissions: { declared: true, capabilities: [] },
    });
    expect(await service.permissions('gone')).toMatchObject({
      permissions: { declared: false, capabilities: ['files', 'web'] },
    });
  });
});
