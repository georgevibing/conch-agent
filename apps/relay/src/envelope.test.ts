import { describe, expect, it } from 'vitest';

import {
  b64url,
  generateKeyPair,
  keyId,
  open,
  parseSetupCode,
  publicKeyOf,
  RELAY_INFO,
  relayAad,
  seal,
  setupCode,
} from './envelope.ts';

const hex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('the envelope (HPKE, RFC 9180)', () => {
  // RFC 9180 Appendix A.1.1: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-128-GCM, base mode.
  const vector = {
    info: hex('4f6465206f6e2061204772656369616e2055726e'),
    pkEm: hex('37fda3567bdbd628e88668c3c8d7e97d1d1253b6d4ea6d44c150f741f1bf4431'),
    skEm: hex('52c4a758a802cd8b936eceea314432798d5baf2d7e9235dc084ab1b9cfa2f736'),
    pkRm: hex('3948cfe0ad1ddb695d780e59077195da6c56506b027329794ab02bca80815c4d'),
    skRm: hex('4612c550263fc8ad58375df3f557aac531d26850903e55a9f23f21d8534e8ac8'),
    pt: hex('4265617574792069732074727574682c20747275746820626561757479'),
    aad: hex('436f756e742d30'),
    ct:
      'f938558b5d72f1a23810b4be2ab4f84331acc02fc97babc53a52ae8218a355a9' +
      '6d8770ac83d07bea87e13c512a',
  };

  it('matches the RFC’s test vector exactly', async () => {
    const sealed = await seal(vector.pkRm, vector.pt, {
      info: vector.info,
      aad: vector.aad,
      aead: 1,
      ephemeral: { publicKey: vector.pkEm, privateKey: vector.skEm },
    });
    expect(toHex(sealed.enc)).toBe(toHex(vector.pkEm));
    expect(toHex(sealed.ct)).toBe(vector.ct);
    const opened = await open(vector.skRm, sealed, { info: vector.info, aad: vector.aad, aead: 1 });
    expect(toHex(opened)).toBe(toHex(vector.pt));
  });

  it('round-trips with a fresh key every time, under AES-256-GCM', async () => {
    const gateway = await generateKeyPair();
    expect(toHex(await publicKeyOf(gateway.privateKey))).toBe(toHex(gateway.publicKey));
    const message = new TextEncoder().encode('{"body":"hello"}');
    const aad = relayAad('abc', 1_700_000_000_000);
    const a = await seal(gateway.publicKey, message, { info: RELAY_INFO, aad });
    const b = await seal(gateway.publicKey, message, { info: RELAY_INFO, aad });
    // A new ephemeral key for each: the same message never looks the same twice.
    expect(toHex(a.enc)).not.toBe(toHex(b.enc));
    expect(toHex(a.ct)).not.toBe(toHex(b.ct));
    expect(
      new TextDecoder().decode(await open(gateway.privateKey, a, { info: RELAY_INFO, aad })),
    ).toBe('{"body":"hello"}');
  });

  it('refuses another key, another id or time, and any changed byte', async () => {
    const gateway = await generateKeyPair();
    const other = await generateKeyPair();
    const aad = relayAad('abc', 1);
    const sealed = await seal(gateway.publicKey, new Uint8Array([1, 2, 3]), {
      info: RELAY_INFO,
      aad,
    });
    await expect(open(other.privateKey, sealed, { info: RELAY_INFO, aad })).rejects.toThrow();
    await expect(
      open(gateway.privateKey, sealed, { info: RELAY_INFO, aad: relayAad('abd', 1) }),
    ).rejects.toThrow();
    await expect(
      open(gateway.privateKey, sealed, { info: RELAY_INFO, aad: relayAad('abc', 2) }),
    ).rejects.toThrow();
    const flipped = Uint8Array.from(sealed.ct);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    await expect(
      open(gateway.privateKey, { ...sealed, ct: flipped }, { info: RELAY_INFO, aad }),
    ).rejects.toThrow();
  });

  it('carries a setup code that holds no secret', async () => {
    const { publicKey } = await generateKeyPair();
    const tokenHash = new Uint8Array(32).fill(7);
    const code = setupCode({ publicKey, tokenHash });
    expect(code).toMatch(/^conch-relay-1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
    const back = parseSetupCode(` ${code}\n`);
    expect(b64url.encode(back.publicKey)).toBe(b64url.encode(publicKey));
    expect(await keyId(back.publicKey)).toBe(await keyId(publicKey));
    expect(() => parseSetupCode('conch-relay-1.abc')).toThrow(/incomplete/);
    expect(() => parseSetupCode('hello')).toThrow(/isn’t/);
  });
});
