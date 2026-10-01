import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  allowedEndpoint,
  encrypt,
  generateVapidKeys,
  sendPush,
  vapidAuthorization,
  vapidKeysValid,
} from './webpush';

const b = (text: string) => Buffer.from(text, 'base64url');

/** RFC 8291 §5: the worked example, every byte. */
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** What a browser does with the body (RFC 8291 §3.4 and RFC 8188), written apart from `encrypt`. */
function decrypt(body: Buffer, uaPrivate: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, auth, info, 32));
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  );
  const record = body.subarray(21 + idlen);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(record.subarray(-16));
  const padded = Buffer.concat([decipher.update(record.subarray(0, -16)), decipher.final()]);
  // The last record ends with 0x02, then any padding of zeros.
  const end = padded.lastIndexOf(0x02);
  return padded.subarray(0, end).toString('utf8');
}

describe('RFC 8291 encryption', () => {
  it('matches the RFC’s worked example byte for byte', () => {
    const body = encrypt(
      Buffer.from(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      { senderPrivate: b(RFC.asPrivate), salt: b(RFC.salt) },
    );
    expect(body.toString('base64url')).toBe(RFC.body);
  });

  it('is read back by the browser’s side, with a fresh key and salt each time', () => {
    const browser = createECDH('prime256v1');
    browser.generateKeys();
    const auth = Buffer.alloc(16, 7);
    const subscriber = {
      p256dh: browser.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
    };
    const one = encrypt(Buffer.from('{"title":"Conch needs your OK"}'), subscriber);
    const two = encrypt(Buffer.from('{"title":"Conch needs your OK"}'), subscriber);
    expect(one.equals(two)).toBe(false);
    expect(decrypt(one, browser.getPrivateKey(), auth)).toBe('{"title":"Conch needs your OK"}');
  });

  it('refuses keys that aren’t a browser’s', () => {
    expect(() => encrypt(Buffer.from('x'), { p256dh: 'AAAA', auth: RFC.auth })).toThrow(/P-256/);
    expect(() => encrypt(Buffer.from('x'), { p256dh: RFC.uaPublic, auth: 'AAAA' })).toThrow(
      /16 bytes/,
    );
  });
});

describe('RFC 8292 VAPID', () => {
  it('signs a JWT for the push service’s origin that the public key verifies', () => {
    const keys = generateVapidKeys();
    expect(vapidKeysValid(keys)).toBe(true);
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, {
      subject: 'https://github.com/giotiskl/conch-agent',
      now: 1_790_000_000_000,
    });
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).toBeTruthy();
    const [, h, c, s, k] = match ?? [];
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(b(h ?? '').toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(b(c ?? '').toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 1_790_000_000 + 12 * 3600,
      sub: 'https://github.com/giotiskl/conch-agent',
    });
    const point = b(keys.publicKey);
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${h}.${c}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        b(s ?? ''),
      ),
    ).toBe(true);
  });

  it('notices a damaged key', () => {
    const keys = generateVapidKeys();
    expect(vapidKeysValid({ ...keys, publicKey: generateVapidKeys().publicKey })).toBe(false);
    expect(vapidKeysValid({ ...keys, privateKey: 'nope' })).toBe(false);
  });
});

describe('push endpoints', () => {
  it('allows the push services browsers use', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc:def',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
      'https://web.push.apple.com/QGs1',
      'https://wns2-db5p.notify.windows.com/w/?token=x',
    ])
      expect(allowedEndpoint(ok), ok).toBe(true);
  });

  it('refuses anything Conch could be tricked into calling', () => {
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost:4317/api/state',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evil.example/?fcm.googleapis.com',
      'https://user:pass@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'file:///etc/passwd',
      'not a url',
    ])
      expect(allowedEndpoint(bad), bad).toBe(false);
  });
});

describe('sending', () => {
  const vapid = generateVapidKeys();
  const browser = createECDH('prime256v1');
  browser.generateKeys();
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: {
      p256dh: browser.getPublicKey().toString('base64url'),
      auth: Buffer.alloc(16, 1).toString('base64url'),
    },
  };
  const send = (status: number, headers: Record<string, string> = {}) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const outcome = sendPush(subscription, '{"title":"Hi"}', {
      vapid,
      subject: 'https://github.com/giotiskl/conch-agent',
      urgency: 'high',
      topic: 'perm:abc.def',
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response('nope', { status, headers });
      },
    });
    return { outcome, calls };
  };

  it('posts the encrypted body with the headers push services want', async () => {
    const { outcome, calls } = send(201);
    expect(await outcome).toEqual({ kind: 'sent' });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['content-encoding']).toBe('aes128gcm');
    expect(headers.urgency).toBe('high');
    expect(headers.topic).toBe('permabcdef');
    expect(headers.authorization).toMatch(/^vapid t=/);
    expect(calls[0]?.init.redirect).toBe('error');
    expect(
      decrypt(
        Buffer.from(calls[0]?.init.body as Buffer),
        browser.getPrivateKey(),
        Buffer.alloc(16, 1),
      ),
    ).toBe('{"title":"Hi"}');
  });

  it('forgets a subscription the service says is gone, and waits out a busy one', async () => {
    expect(await send(410).outcome).toEqual({ kind: 'gone' });
    expect(await send(404).outcome).toEqual({ kind: 'gone' });
    expect(await send(429, { 'retry-after': '120' }).outcome).toEqual({
      kind: 'retry',
      afterMs: 120_000,
    });
    expect(await send(503).outcome).toEqual({ kind: 'retry', afterMs: 30_000 });
    expect((await send(400).outcome).kind).toBe('failed');
  });

  it('never calls an endpoint that isn’t a push service', async () => {
    let called = false;
    const outcome = await sendPush({ ...subscription, endpoint: 'https://127.0.0.1/x' }, '{}', {
      vapid,
      subject: 'https://x',
      fetch: async () => {
        called = true;
        return new Response();
      },
    });
    expect(outcome.kind).toBe('failed');
    expect(called).toBe(false);
  });
});
