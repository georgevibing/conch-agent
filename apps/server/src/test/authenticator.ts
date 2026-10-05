/**
 * A pretend passkey authenticator for tests (ADR 0065): it answers WebAuthn
 * registration and authentication options the way Touch ID or Windows Hello
 * would, with a real ES256 key, so the gateway's checks run on real bytes.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

import type { PasskeyAssertion, PasskeyRegistration } from '@conch/protocol';
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';

const UP = 0x01;
const UV = 0x04;
const BE = 0x08;
const BS = 0x10;
const AT = 0x40;

const b64 = (bytes: Uint8Array) => isoBase64URL.fromBuffer(new Uint8Array(bytes));
const sha256 = (data: Uint8Array | string) =>
  new Uint8Array(createHash('sha256').update(data).digest());

function counterBytes(counter: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, counter);
  return out;
}

function uuidBytes(uuid: string): Uint8Array {
  return Uint8Array.from(Buffer.from(uuid.replaceAll('-', ''), 'hex'));
}

export interface PretendPasskey {
  id: string;
  rpId: string;
  userHandle: string;
  privateKey: KeyObject;
  counter: number;
}

export class PretendAuthenticator {
  readonly passkeys: PretendPasskey[] = [];

  constructor(
    private readonly options: {
      /** The password manager it pretends to be. Defaults to Apple Passwords. */
      aaguid?: string;
      /** Fixed bytes for testing credential identifiers at their format boundaries. */
      credentialId?: Uint8Array;
      /** Synced (backed up): the counter stays 0, as iCloud Keychain's does. */
      synced?: boolean;
      /** The person touched and was recognised. Off: user presence only, no verification. */
      verifies?: boolean;
    } = {},
  ) {}

  #flags(extra = 0): number {
    const synced = this.options.synced ?? true;
    return UP | ((this.options.verifies ?? true) ? UV : 0) | (synced ? BE | BS : 0) | extra;
  }

  /** Answer `navigator.credentials.create()`'s options. */
  create(
    options: Record<string, unknown>,
    origin: string,
    tweak: { type?: string; origin?: string } = {},
  ): PasskeyRegistration {
    const rp = options.rp as { id: string };
    const user = options.user as { id: string };
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const credentialId = this.options.credentialId ?? new Uint8Array(randomBytes(32));
    const cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, isoBase64URL.toBuffer(jwk.x ?? '')],
        [-3, isoBase64URL.toBuffer(jwk.y ?? '')],
      ]),
    );
    const idLength = new Uint8Array([credentialId.length >> 8, credentialId.length & 0xff]);
    const authData = Buffer.concat([
      sha256(rp.id),
      new Uint8Array([this.#flags(AT)]),
      counterBytes(0),
      uuidBytes(this.options.aaguid ?? 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd'),
      idLength,
      credentialId,
      cose,
    ]);
    const clientDataJSON = JSON.stringify({
      type: tweak.type ?? 'webauthn.create',
      challenge: options.challenge,
      origin: tweak.origin ?? origin,
      crossOrigin: false,
    });
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', new Uint8Array(authData)],
      ]) as never,
    );
    const id = b64(credentialId);
    this.passkeys.push({ id, rpId: rp.id, userHandle: user.id, privateKey, counter: 0 });
    return {
      id,
      rawId: id,
      type: 'public-key',
      response: {
        clientDataJSON: b64(new TextEncoder().encode(clientDataJSON)),
        attestationObject: b64(attestationObject),
        transports: ['internal', 'hybrid'],
      },
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
    };
  }

  /** Answer `navigator.credentials.get()`'s options with this passkey (the newest by default). */
  get(
    options: Record<string, unknown>,
    origin: string,
    tweak: { passkey?: PretendPasskey; origin?: string; counter?: number; rpId?: string } = {},
  ): PasskeyAssertion {
    const passkey = tweak.passkey ?? this.passkeys.at(-1);
    if (!passkey) throw new Error('The pretend authenticator has no passkey.');
    if (tweak.counter !== undefined) passkey.counter = tweak.counter;
    else if (!(this.options.synced ?? true)) passkey.counter += 1;
    const authData = Buffer.concat([
      sha256(tweak.rpId ?? (options.rpId as string)),
      new Uint8Array([this.#flags()]),
      counterBytes(passkey.counter),
    ]);
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: options.challenge,
        origin: tweak.origin ?? origin,
        crossOrigin: false,
      }),
    );
    const signature = sign(
      'sha256',
      Buffer.concat([authData, sha256(clientDataJSON)]),
      passkey.privateKey,
    );
    return {
      id: passkey.id,
      rawId: passkey.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64(clientDataJSON),
        authenticatorData: b64(new Uint8Array(authData)),
        signature: b64(new Uint8Array(signature)),
        userHandle: passkey.userHandle,
      },
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
    };
  }
}
