import { randomBytes } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { wrapKey } from './crypto';
import { FileKeystore, SettledKeystore, type OsKeystore } from './keystore';

/** A pretend keychain: what it keeps, whether it can be reached, whether it keeps what it's given. */
function fakeOs({ reachable = true, keeps = true } = {}) {
  const os = {
    kept: undefined as Buffer | undefined,
    reachable,
    keeps,
    kind: 'keychain' as const,
    async peek() {
      if (!os.reachable) throw new Error('unreachable');
      return os.kept;
    },
    async deviceKey() {
      const existing = await os.peek();
      if (existing) return existing;
      const key = randomBytes(32);
      await os.store(key);
      return key;
    },
    async store(key: Buffer) {
      if (!os.reachable || !os.keeps) throw new Error('wouldn’t keep it');
      os.kept = Buffer.from(key);
    },
    async forget() {
      os.kept = undefined;
    },
  } satisfies OsKeystore & Record<string, unknown>;
  return os;
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function home() {
  const dir = await mkdtemp(join(tmpdir(), 'conch-keystore-'));
  dirs.push(dir);
  return dir;
}

/** A vault file wrapped with this key, as `store.ts` writes it. */
async function vaultWith(dir: string, key: Buffer, keystore: 'file' | 'keychain' = 'file') {
  const wrap = wrapKey(key, randomBytes(32));
  await writeFile(join(dir, 'vault.json'), JSON.stringify({ format: 1, keystore, wrap }));
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe('the key to your passwords, settled with the operating system (ADR 0152)', () => {
  it('moves a file key into the keychain once it opens the vault, then the file goes', async () => {
    const dir = await home();
    const file = new FileKeystore(dir);
    const key = await file.deviceKey();
    await vaultWith(dir, key);
    const os = fakeOs();
    let moved = 0;
    const settled = new SettledKeystore(os, file, dir, () => moved++);
    expect((await settled.deviceKey()).equals(key)).toBe(true);
    expect(os.kept?.equals(key)).toBe(true);
    expect(await exists(join(dir, 'device.key'))).toBe(false);
    expect(await readFile(join(dir, 'device.moved'), 'utf8')).not.toContain(key.toString('hex'));
    expect(settled.kind).toBe('keychain');
    expect(moved).toBe(1);
  });

  it('never makes a new key while the keychain that has it can’t be reached', async () => {
    const dir = await home();
    const os = fakeOs();
    const settled = new SettledKeystore(os, new FileKeystore(dir), dir);
    const key = await settled.deviceKey();
    os.reachable = false;
    await expect(settled.deviceKey()).rejects.toThrow(/can’t be reached/);
    expect(await exists(join(dir, 'device.key'))).toBe(false);
    os.reachable = true;
    expect((await settled.deviceKey()).equals(key)).toBe(true);
  });

  it('keeps the file, and everything working, when the keychain won’t keep the key', async () => {
    const dir = await home();
    const file = new FileKeystore(dir);
    const key = await file.deviceKey();
    const settled = new SettledKeystore(fakeOs({ keeps: false }), file, dir);
    expect((await settled.deviceKey()).equals(key)).toBe(true);
    expect(await exists(join(dir, 'device.key'))).toBe(true);
    expect(settled.kind).toBe('file');
  });

  it('falls back to the file on a computer with no keychain to reach', async () => {
    const dir = await home();
    const settled = new SettledKeystore(fakeOs({ reachable: false }), new FileKeystore(dir), dir);
    const key = await settled.deviceKey();
    expect(settled.kind).toBe('file');
    expect((await new FileKeystore(dir).peek())?.equals(key)).toBe(true);
  });

  it('with two keys, takes the one that opens the vault', async () => {
    const dir = await home();
    const file = new FileKeystore(dir);
    const fileKey = await file.deviceKey();
    const os = fakeOs();
    os.kept = randomBytes(32);
    await vaultWith(dir, fileKey);
    const settled = new SettledKeystore(os, file, dir);
    expect((await settled.deviceKey()).equals(fileKey)).toBe(true);
    expect(os.kept.equals(fileKey)).toBe(true);

    const dir2 = await home();
    const file2 = new FileKeystore(dir2);
    await file2.deviceKey();
    const os2 = fakeOs();
    const keptKey = randomBytes(32);
    os2.kept = keptKey;
    await vaultWith(dir2, keptKey, 'keychain');
    const settled2 = new SettledKeystore(os2, file2, dir2);
    expect((await settled2.deviceKey()).equals(keptKey)).toBe(true);
  });

  it('doesn’t move a file key that doesn’t open the vault', async () => {
    const dir = await home();
    const file = new FileKeystore(dir);
    await file.deviceKey();
    await vaultWith(dir, randomBytes(32));
    const os = fakeOs();
    const settled = new SettledKeystore(os, file, dir);
    await settled.deviceKey();
    expect(os.kept).toBeUndefined();
    expect(await exists(join(dir, 'device.key'))).toBe(true);
  });
});
