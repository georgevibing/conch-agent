/**
 * Who made an app (ADR 0061 §5): your skills' signing key signs apps too,
 * over `conch-app-signature/1\n<id>\n<hash>`. A changed file, a signature
 * moved to another app, a skill's signature passed off as an app's (and
 * back), another algorithm or a short key: none of them holds.
 */
import { createPrivateKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { deviceSealer, isSealed } from '../lib/sealed';
import { newSigner, publicKeyFrom, signedMessage, type Signer } from '../skills/signing';
import { SIGNER_FILE, SkillTrust } from '../skills/trust';
import { appHash, readFiles, SIGNATURE_FILE } from './package';
import { appSignedMessage, signApp, verifyAppWith, type AppSignatureFile } from './sign';
import type { AppPackage } from './types';

const thisComputer = deviceSealer(async () => Buffer.alloc(32, 7));

async function home() {
  const dir = await mkdtemp(join(tmpdir(), 'conch app signing '));
  return { dir, trust: new SkillTrust(dir, { sealer: thisComputer }) };
}

function app(id = 'plant-diary', extra: Record<string, string> = {}): AppPackage {
  const read = readFiles(
    new Map(
      Object.entries({
        'conch-app.json': JSON.stringify({
          conch: 1,
          id,
          name: 'Plant diary',
          tagline: 'Keeps track of watering',
          version: '1.0.0',
          icon: { glyph: 'leaf', color: 'green' },
          tools: 'tools.mjs',
        }),
        'tools.mjs': 'export const tools = {};\n',
        ...extra,
      }).map(([p, t]) => [p, Buffer.from(t)]),
    ),
  );
  if (!read.ok) throw new Error(read.problems[0]?.message);
  return read.app;
}

/** The app with this signature beside it (and its other files as they are). */
function withSignature(target: AppPackage, sig: Buffer | string | object): AppPackage {
  const files = new Map(target.files);
  files.set(
    SIGNATURE_FILE,
    Buffer.isBuffer(sig) ? sig : Buffer.from(typeof sig === 'string' ? sig : JSON.stringify(sig)),
  );
  return { ...target, files };
}

const parsed = (sig: Buffer) => JSON.parse(sig.toString('utf8')) as AppSignatureFile;

/** A signature written by hand: any key, any message, any fields. */
function forge(
  signer: Signer,
  message: Buffer,
  fields: Partial<AppSignatureFile> & { app: string; hash: string },
) {
  const key = createPrivateKey({
    key: Buffer.from(signer.privateKey, 'base64url'),
    format: 'der',
    type: 'pkcs8',
  });
  return {
    v: 1,
    alg: 'ed25519',
    publisher: { name: signer.name, key: signer.publicKey },
    signedAt: 1,
    sig: sign(null, message, key).toString('base64url'),
    ...fields,
  };
}

describe('signing an app', () => {
  it('signs with your key, making (and trusting) one when you have none, sealed', async () => {
    const { dir, trust } = await home();
    const plant = app();
    const sig = await signApp(plant, dir, { trust, name: 'Ada', now: () => 42 });
    const file = parsed(sig);
    expect(file).toMatchObject({
      v: 1,
      alg: 'ed25519',
      app: 'plant-diary',
      hash: plant.hash,
      signedAt: 42,
      publisher: { name: 'Ada' },
    });
    expect(isSealed(await readFile(join(dir, SIGNER_FILE), 'utf8'))).toBe(true);
    expect(await trust.list()).toEqual([expect.objectContaining({ name: 'Ada', you: true })]);
    expect(await verifyAppWith(withSignature(plant, sig), trust)).toEqual({
      state: 'verified',
      publisher: 'Ada',
      fingerprint: expect.stringMatching(/^[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$/),
    });
    // The same key next time: the second signature names the same publisher key.
    const again = parsed(await signApp(plant, dir, { trust, name: 'Someone else' }));
    expect(again.publisher).toEqual(file.publisher);
  });

  it('is unsigned with no signature, and untrusted from someone you don’t know', async () => {
    const mine = await home();
    const theirs = await home();
    const plant = app();
    expect(await verifyAppWith(plant, theirs.trust)).toEqual({ state: 'unsigned' });
    const sig = await signApp(plant, mine.dir, { trust: mine.trust, name: 'Ada' });
    expect(await verifyAppWith(withSignature(plant, sig), theirs.trust)).toMatchObject({
      state: 'untrusted',
      publisher: 'Ada',
    });
  });

  it('names a look-alike: another key using a name you trust', async () => {
    const ada = await home();
    const you = await home();
    const mallory = await home();
    // You trust the real Ada.
    const real = await ada.trust.signer('Ada');
    await you.trust.trust({ key: real.publicKey, name: 'Ada' });
    const plant = app();
    const fake = await signApp(plant, mallory.dir, { trust: mallory.trust, name: 'ada ' });
    expect(await verifyAppWith(withSignature(plant, fake), you.trust)).toMatchObject({
      state: 'untrusted',
      publisher: 'ada',
      lookalike: true,
    });
    const genuine = await signApp(plant, ada.dir, { trust: ada.trust });
    expect(await verifyAppWith(withSignature(plant, genuine), you.trust)).toMatchObject({
      state: 'verified',
      publisher: 'Ada',
    });
  });
});

describe('a signature that doesn’t hold', () => {
  it('a file changed after signing', async () => {
    const { dir, trust } = await home();
    const plant = app();
    const sig = await signApp(plant, dir, { trust, name: 'Ada' });
    const changed = withSignature(
      app('plant-diary', { 'tools.mjs': 'export const tools = { evil: {} };\n' }),
      sig,
    );
    expect(await verifyAppWith(changed, trust)).toMatchObject({
      state: 'invalid',
      problem: 'It was changed after Ada signed it.',
      publisher: 'Ada',
    });
    const added = withSignature(app('plant-diary', { 'extra.md': 'x' }), sig);
    expect((await verifyAppWith(added, trust)).state).toBe('invalid');
  });

  it('a signature moved to another app', async () => {
    const { dir, trust } = await home();
    const sig = await signApp(app('plant-diary'), dir, { trust, name: 'Ada' });
    expect(await verifyAppWith(withSignature(app('weather'), sig), trust)).toMatchObject({
      state: 'invalid',
      problem: 'It carries a signature made for another app (“plant-diary”).',
    });
    // Renaming it in the file breaks the signature instead.
    const renamed = { ...parsed(sig), app: 'weather', hash: app('weather').hash };
    expect(await verifyAppWith(withSignature(app('weather'), renamed), trust)).toMatchObject({
      state: 'invalid',
      problem: 'Its signature doesn’t hold: it wasn’t made by the key it names.',
    });
  });

  it('a skill’s signature passed off as an app’s, and an app’s as a skill’s', async () => {
    const { trust } = await home();
    const ada = await trust.signer('Ada');
    const plant = app();
    // Signed with the skill domain over the same name and hash: it never holds as an app's.
    const skillSig = forge(ada, signedMessage(plant.manifest.id, plant.hash), {
      app: plant.manifest.id,
      hash: plant.hash,
    });
    expect(await verifyAppWith(withSignature(plant, skillSig), trust)).toMatchObject({
      state: 'invalid',
      problem: 'Its signature doesn’t hold: it wasn’t made by the key it names.',
    });
    // A SKILL.sig as it's written isn't an app's signature file at all.
    const skillFile = {
      v: 1,
      alg: 'ed25519',
      name: plant.manifest.id,
      hash: plant.hash,
      publisher: skillSig.publisher,
      signedAt: 1,
      sig: skillSig.sig,
    };
    expect(await verifyAppWith(withSignature(plant, skillFile), trust)).toMatchObject({
      state: 'invalid',
      problem: expect.stringMatching(/isn’t one Conch can read/),
    });
    // And the other way: an app's signature never verifies as a skill's.
    const appSig = parsed(await signApp(plant, '', { trust, name: 'Ada' }));
    const key = publicKeyFrom(appSig.publisher.key);
    if (!key) throw new Error('key');
    const asApp = verify(
      null,
      appSignedMessage(appSig.app, appSig.hash),
      key,
      Buffer.from(appSig.sig, 'base64url'),
    );
    const asSkill = verify(
      null,
      signedMessage(appSig.app, appSig.hash),
      key,
      Buffer.from(appSig.sig, 'base64url'),
    );
    expect([asApp, asSkill]).toEqual([true, false]);
  });

  it('another algorithm, or a key that isn’t a whole Ed25519 key', async () => {
    const { dir, trust } = await home();
    const plant = app();
    const good = parsed(await signApp(plant, dir, { trust, name: 'Ada' }));
    const unreadable = expect.objectContaining({
      state: 'invalid',
      problem: 'Its signature file isn’t one Conch can read, so it can’t say who made it.',
    });
    expect(
      await verifyAppWith(withSignature(plant, { ...good, alg: 'rsa-sha256' }), trust),
    ).toEqual(unreadable);
    expect(await verifyAppWith(withSignature(plant, { ...good, alg: 'none' }), trust)).toEqual(
      unreadable,
    );
    // A short key: 31 bytes.
    const short = Buffer.from(good.publisher.key, 'base64url')
      .subarray(0, 31)
      .toString('base64url');
    expect(
      await verifyAppWith(
        withSignature(plant, { ...good, publisher: { ...good.publisher, key: short } }),
        trust,
      ),
    ).toEqual(unreadable);
    // An RSA key, and an RSA signature, in its place.
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaKey = rsa.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
    const rsaSig = sign(
      'sha256',
      appSignedMessage(plant.manifest.id, plant.hash),
      rsa.privateKey,
    ).toString('base64url');
    expect(
      await verifyAppWith(
        withSignature(plant, {
          ...good,
          publisher: { ...good.publisher, key: rsaKey },
          sig: rsaSig,
        }),
        trust,
      ),
    ).toEqual(unreadable);
    // An X25519 key is 32 bytes too, but it didn't make this signature.
    const x = generateKeyPairSync('x25519').publicKey.export({ format: 'jwk' }).x ?? '';
    expect(
      await verifyAppWith(
        withSignature(plant, { ...good, publisher: { ...good.publisher, key: x } }),
        trust,
      ),
    ).toMatchObject({
      state: 'invalid',
      problem: 'Its signature doesn’t hold: it wasn’t made by the key it names.',
    });
    // Someone else's key named, your signature kept.
    expect(
      await verifyAppWith(
        withSignature(plant, {
          ...good,
          publisher: { ...good.publisher, key: newSigner('Eve').publicKey },
        }),
        trust,
      ),
    ).toMatchObject({
      state: 'invalid',
      problem: 'Its signature doesn’t hold: it wasn’t made by the key it names.',
    });
    expect(await verifyAppWith(withSignature(plant, 'not json'), trust)).toEqual(unreadable);
    expect(await verifyAppWith(withSignature(plant, { ...good, extra: 1 }), trust)).toEqual(
      unreadable,
    );
  });

  it('signs these exact files: the signature itself is left out of the hash', async () => {
    const { dir, trust } = await home();
    const plant = app();
    const sig = await signApp(plant, dir, { trust, name: 'Ada' });
    const signed = withSignature(plant, sig);
    expect(appHash(signed.files)).toBe(plant.hash);
    expect(parsed(sig).hash).toBe(plant.hash);
  });
});
