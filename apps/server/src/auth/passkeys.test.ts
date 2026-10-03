import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { PretendAuthenticator } from '../test/authenticator';
import { CHALLENGE_TTL_MS, PasskeyCeremonies, PasskeyError, passkeyPlace } from './passkeys';
import { AccessError, AccessStore } from './store';

/**
 * Passkeys (ADR 0065): made and used with real ES256 signatures from a
 * pretend authenticator. The attacks: an answer replayed, sent from another
 * site, answered for a different purpose or session, made without the
 * person's face or finger, or from a copied authenticator whose counter
 * went backwards.
 */

const PLACE = { rpId: 'conch.example.com', origin: 'https://conch.example.com' };

async function setup(now = () => Date.now()) {
  const home = await mkdtemp(join(tmpdir(), 'conch-passkeys-'));
  const store = new AccessStore(home);
  return { store, ceremonies: new PasskeyCeremonies(store, now) };
}

async function addOne(
  store: AccessStore,
  ceremonies: PasskeyCeremonies,
  authenticator = new PretendAuthenticator(),
) {
  const options = await ceremonies.registrationOptions({
    place: PLACE,
    purpose: 'add',
    sessionId: 's_1',
    userName: 'george',
  });
  const { passkey } = await ceremonies.verifyRegistration({
    response: authenticator.create(options, PLACE.origin),
    place: PLACE,
    purpose: 'add',
    sessionId: 's_1',
    deviceName: 'Safari on Mac',
  });
  await store.addPasskey(passkey);
  return { passkey, authenticator };
}

function request(host: string, options: { https?: boolean; remote?: string; proto?: string } = {}) {
  return {
    headers: { host, ...(options.proto && { 'x-forwarded-proto': options.proto }) },
    protocol: options.https ? 'https' : 'http',
    socket: { remoteAddress: options.remote ?? '203.0.113.9' },
  } as unknown as FastifyRequest;
}

describe('where passkeys work', () => {
  it('works on an HTTPS name and on localhost, never on an IP or plain HTTP', () => {
    expect(passkeyPlace(request('conch.example.com', { https: true }))).toEqual(PLACE);
    expect(passkeyPlace(request('localhost:4317', { remote: '127.0.0.1' }))).toEqual({
      rpId: 'localhost',
      origin: 'http://localhost:4317',
    });
    expect(passkeyPlace(request('203.0.113.9', { https: true }))).toBeUndefined();
    expect(passkeyPlace(request('[2001:db8::1]', { https: true }))).toBeUndefined();
    expect(passkeyPlace(request('mac.local:4317'))).toBeUndefined();
  });

  it('trusts a forwarded https only from a proxy on this computer', () => {
    expect(
      passkeyPlace(request('mac.tail1.ts.net', { remote: '127.0.0.1', proto: 'https' })),
    ).toEqual({ rpId: 'mac.tail1.ts.net', origin: 'https://mac.tail1.ts.net' });
    expect(passkeyPlace(request('mac.tail1.ts.net', { proto: 'https' }))).toBeUndefined();
  });
});

describe('making and using a passkey', () => {
  it('signs in with the passkey it made, and names it after its password manager', async () => {
    const { store, ceremonies } = await setup();
    const { passkey, authenticator } = await addOne(store, ceremonies);
    expect(passkey.name).toBe('Apple Passwords');
    expect(passkey.synced).toBe(true);
    expect(await store.method()).toBe('passkey');

    const options = await ceremonies.authenticationOptions({ place: PLACE, purpose: 'sign-in' });
    expect(options.allowCredentials ?? []).toEqual([]);
    const used = await ceremonies.verifyAuthentication({
      response: authenticator.get(options, PLACE.origin),
      place: PLACE,
      purpose: 'sign-in',
    });
    expect(used.id).toBe(passkey.id);
    expect((await store.passkeys(PLACE.rpId))[0]).toMatchObject({
      here: true,
      lastUsedAt: expect.any(Number),
    });
  });

  it('names a passkey from an unknown maker after the device it was made on', async () => {
    const { store, ceremonies } = await setup();
    const { passkey } = await addOne(
      store,
      ceremonies,
      new PretendAuthenticator({ aaguid: '00000000-0000-0000-0000-000000000000' }),
    );
    expect(passkey.name).toBe('Passkey on Safari on Mac');
  });

  it('refuses an answer used twice', async () => {
    const { store, ceremonies } = await setup();
    const { authenticator } = await addOne(store, ceremonies);
    const options = await ceremonies.authenticationOptions({ place: PLACE, purpose: 'sign-in' });
    const answer = authenticator.get(options, PLACE.origin);
    await ceremonies.verifyAuthentication({ response: answer, place: PLACE, purpose: 'sign-in' });
    await expect(
      ceremonies.verifyAuthentication({ response: answer, place: PLACE, purpose: 'sign-in' }),
    ).rejects.toThrow(PasskeyError);
  });

  it('refuses an answer made for another site', async () => {
    const { store, ceremonies } = await setup();
    const { authenticator } = await addOne(store, ceremonies);
    const options = await ceremonies.authenticationOptions({ place: PLACE, purpose: 'sign-in' });
    await expect(
      ceremonies.verifyAuthentication({
        response: authenticator.get(options, 'https://conch.example.com.evil.test'),
        place: PLACE,
        purpose: 'sign-in',
      }),
    ).rejects.toThrow(PasskeyError);
  });

  it('refuses a passkey made for another address', async () => {
    const { store, ceremonies } = await setup();
    const { authenticator } = await addOne(store, ceremonies);
    const elsewhere = { rpId: 'localhost', origin: 'http://localhost:4317' };
    const options = await ceremonies.authenticationOptions({
      place: elsewhere,
      purpose: 'sign-in',
    });
    await expect(
      ceremonies.verifyAuthentication({
        response: authenticator.get(options, elsewhere.origin, { rpId: PLACE.rpId }),
        place: elsewhere,
        purpose: 'sign-in',
      }),
    ).rejects.toThrow(PasskeyError);
  });

  it('only answers what the challenge was made for', async () => {
    const { store, ceremonies } = await setup();
    const { authenticator } = await addOne(store, ceremonies);
    const signIn = await ceremonies.authenticationOptions({ place: PLACE, purpose: 'sign-in' });
    await expect(
      ceremonies.verifyAuthentication({
        response: authenticator.get(signIn, PLACE.origin),
        place: PLACE,
        purpose: 'verify',
        sessionId: 's_1',
      }),
    ).rejects.toThrow(PasskeyError);
    // Confirming it's you is bound to the session that asked.
    const verify = await ceremonies.authenticationOptions({
      place: PLACE,
      purpose: 'verify',
      sessionId: 's_1',
    });
    expect(verify.allowCredentials).toHaveLength(1);
    await expect(
      ceremonies.verifyAuthentication({
        response: authenticator.get(verify, PLACE.origin),
        place: PLACE,
        purpose: 'verify',
        sessionId: 's_2',
      }),
    ).rejects.toThrow(PasskeyError);
  });

  it('refuses a passkey used without the person’s face, finger or PIN', async () => {
    const { store, ceremonies } = await setup();
    const { authenticator } = await addOne(store, ceremonies);
    const options = await ceremonies.authenticationOptions({ place: PLACE, purpose: 'sign-in' });
    const lazy = new PretendAuthenticator({ verifies: false });
    lazy.passkeys.push(...authenticator.passkeys);
    await expect(
      ceremonies.verifyAuthentication({
        response: lazy.get(options, PLACE.origin),
        place: PLACE,
        purpose: 'sign-in',
      }),
    ).rejects.toThrow(PasskeyError);
  });

  it('refuses to make a passkey without the person’s face, finger or PIN', async () => {
    const { ceremonies } = await setup();
    const options = await ceremonies.registrationOptions({
      place: PLACE,
      purpose: 'add',
      sessionId: 's_1',
      userName: 'george',
    });
    await expect(
      ceremonies.verifyRegistration({
        response: new PretendAuthenticator({ verifies: false }).create(options, PLACE.origin),
        place: PLACE,
        purpose: 'add',
        sessionId: 's_1',
        deviceName: 'Chrome on Windows',
      }),
    ).rejects.toThrow(PasskeyError);
  });

  it('refuses a copied authenticator whose counter went backwards', async () => {
    const { store, ceremonies } = await setup();
    const { authenticator } = await addOne(
      store,
      ceremonies,
      new PretendAuthenticator({ synced: false }),
    );
    const first = await ceremonies.authenticationOptions({ place: PLACE, purpose: 'sign-in' });
    await ceremonies.verifyAuthentication({
      response: authenticator.get(first, PLACE.origin, { counter: 5 }),
      place: PLACE,
      purpose: 'sign-in',
    });
    const second = await ceremonies.authenticationOptions({ place: PLACE, purpose: 'sign-in' });
    await expect(
      ceremonies.verifyAuthentication({
        response: authenticator.get(second, PLACE.origin, { counter: 3 }),
        place: PLACE,
        purpose: 'sign-in',
      }),
    ).rejects.toThrow(PasskeyError);
  });

  it('lets a challenge run out', async () => {
    let now = Date.now();
    const { store, ceremonies } = await setup(() => now);
    const { authenticator } = await addOne(store, ceremonies);
    const options = await ceremonies.authenticationOptions({ place: PLACE, purpose: 'sign-in' });
    now += CHALLENGE_TTL_MS + 1;
    await expect(
      ceremonies.verifyAuthentication({
        response: authenticator.get(options, PLACE.origin),
        place: PLACE,
        purpose: 'sign-in',
      }),
    ).rejects.toThrow('too long');
  });

  it('never keeps more than a hundred challenges', async () => {
    const { store, ceremonies } = await setup();
    const { authenticator } = await addOne(store, ceremonies);
    const first = await ceremonies.authenticationOptions({ place: PLACE, purpose: 'sign-in' });
    for (let i = 0; i < 100; i++)
      await ceremonies.authenticationOptions({ place: PLACE, purpose: 'sign-in' });
    await expect(
      ceremonies.verifyAuthentication({
        response: authenticator.get(first, PLACE.origin),
        place: PLACE,
        purpose: 'sign-in',
      }),
    ).rejects.toThrow(PasskeyError);
  });
});

describe('a flood of challenges (review)', () => {
  it('can’t push out a hello, or another kind, by asking to sign in over and over', async () => {
    const { store, ceremonies } = await setup();
    const { code } = await store.createHello();
    const hello = await ceremonies.registrationOptions({
      place: PLACE,
      purpose: 'hello',
      helloCode: code,
      userName: 'george',
      client: '203.0.113.10',
    });
    for (let i = 0; i < 300; i++)
      await ceremonies.authenticationOptions({
        place: PLACE,
        purpose: 'sign-in',
        client: `198.51.100.${i % 250}`,
      });
    const made = await ceremonies.verifyRegistration({
      response: new PretendAuthenticator().create(hello, PLACE.origin),
      place: PLACE,
      purpose: 'hello',
      helloCode: code,
      deviceName: 'Safari on Mac',
    });
    expect(made.passkey.id).toBeTruthy();
  });

  it('keeps only a few sign-in challenges per client, so one can’t crowd out the rest', async () => {
    const { store, ceremonies } = await setup();
    const { authenticator } = await addOne(store, ceremonies);
    const mine = await ceremonies.authenticationOptions({
      place: PLACE,
      purpose: 'sign-in',
      client: '203.0.113.10',
    });
    for (let i = 0; i < 50; i++)
      await ceremonies.authenticationOptions({
        place: PLACE,
        purpose: 'sign-in',
        client: '198.51.100.66',
      });
    // Someone else asking fifty times left the owner's challenge alone.
    await ceremonies.verifyAuthentication({
      response: authenticator.get(mine, PLACE.origin),
      place: PLACE,
      purpose: 'sign-in',
    });
  });
});

describe('keeping passkeys', () => {
  it('won’t remove the last way in', async () => {
    const { store, ceremonies } = await setup();
    const { passkey } = await addOne(store, ceremonies);
    await expect(store.removePasskey(passkey.id)).rejects.toThrow(AccessError);
    await store.setPassword('george', 'purple otters juggle at dawn');
    await store.removePasskey(passkey.id);
    expect(await store.passkeyRecords()).toEqual([]);
    expect(await store.method()).toBe('password');
  });

  it('keeps passkeys beside a password, and falls back to them when the last key goes', async () => {
    const { store, ceremonies } = await setup();
    await addOne(store, ceremonies);
    const { info } = await store.addKey('Laptop');
    expect(await store.method()).toBe('key');
    await store.revokeKey(info.id);
    expect(await store.method()).toBe('passkey');
  });

  it('won’t remove the last passkey for the address it’s asked from, when passkeys are the only way', async () => {
    const { store, ceremonies } = await setup();
    const { passkey } = await addOne(store, ceremonies);
    // Another passkey, for this computer only.
    await store.addPasskey({ ...passkey, id: 'local-only-passkey-id-0001', rpId: 'localhost' });
    await expect(store.removePasskey(passkey.id, PLACE.rpId)).rejects.toThrow(
      'only passkey for conch.example.com',
    );
    // From this computer (localhost), the public one can go: localhost keeps its own.
    await store.removePasskey(passkey.id, 'localhost');
    expect((await store.passkeyRecords()).map((p) => p.rpId)).toEqual(['localhost']);
  });

  it('forgets every passkey on reset', async () => {
    const { store, ceremonies } = await setup();
    await addOne(store, ceremonies);
    await store.disable();
    expect(await store.passkeyRecords()).toEqual([]);
    expect((await store.get()).ownerId).toBeUndefined();
  });
});

describe('the hello link (ADR 0064)', () => {
  it('makes Conch yours with a passkey, once', async () => {
    const { store, ceremonies } = await setup();
    const { code } = await store.createHello();
    expect(await store.checkHello(code)).toMatchObject({ ok: true });
    const options = await ceremonies.registrationOptions({
      place: PLACE,
      purpose: 'hello',
      helloCode: code,
      userName: 'george',
    });
    const made = await ceremonies.verifyRegistration({
      response: new PretendAuthenticator().create(options, PLACE.origin),
      place: PLACE,
      purpose: 'hello',
      helloCode: code,
      deviceName: 'Safari on Mac',
    });
    expect(made.ownerId).toBeTruthy();
    await store.claim(code, {
      kind: 'passkey',
      passkey: made.passkey,
      ownerId: made.ownerId ?? '',
    });
    const file = await store.get();
    expect(file).toMatchObject({ method: 'passkey', approval: true, ownerId: made.ownerId });
    expect(file.hellos).toEqual([]);
    expect(await store.checkHello(code)).toEqual({ ok: false, reason: 'claimed' });
    await expect(
      store.claim(code, {
        kind: 'password',
        username: 'x',
        password: 'purple otters juggle at dawn',
      }),
    ).rejects.toThrow(AccessError);
    await expect(store.createHello()).rejects.toThrow('already someone’s');
  });

  it('makes Conch yours with a password, and refuses a weak one without using the link', async () => {
    const { store } = await setup();
    const { code } = await store.createHello();
    await expect(
      store.claim(code, { kind: 'password', username: 'george', password: 'password1234567' }),
    ).rejects.toMatchObject({ code: 'weak-password' });
    expect(await store.checkHello(code)).toMatchObject({ ok: true });
    await store.claim(code, {
      kind: 'password',
      username: 'george',
      password: 'purple otters juggle at dawn',
    });
    expect(await store.get()).toMatchObject({
      method: 'password',
      username: 'george',
      approval: true,
    });
  });

  it('won’t take a code that doesn’t match, or one bound to another hello', async () => {
    const { store, ceremonies } = await setup();
    const { code } = await store.createHello();
    const other = await store.createHello();
    expect(await store.checkHello('nope')).toEqual({ ok: false, reason: 'expired' });
    const options = await ceremonies.registrationOptions({
      place: PLACE,
      purpose: 'hello',
      helloCode: code,
      userName: 'george',
    });
    await expect(
      ceremonies.verifyRegistration({
        response: new PretendAuthenticator().create(options, PLACE.origin),
        place: PLACE,
        purpose: 'hello',
        helloCode: other.code,
        deviceName: 'Safari on Mac',
      }),
    ).rejects.toThrow(PasskeyError);
  });

  it('keeps only the five newest links', async () => {
    const { store } = await setup();
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await store.createHello()).code);
    expect((await store.get()).hellos).toHaveLength(5);
    expect(await store.checkHello(codes[6] ?? '')).toMatchObject({ ok: true });
  });
});
