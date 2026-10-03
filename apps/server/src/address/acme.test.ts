import { base64url } from 'jose';
import { describe, expect, it } from 'vitest';

import { AcmeClient, AcmeError, explain, leaf, newAccountKey, renewAt, renewalId } from './acme';
import { fakeAcme, leafFor, testCa } from './testing';

const instant = async () => undefined;

function responder() {
  const answers = new Map<string, string>();
  return {
    answers,
    put: (token: string, value: string) => void answers.set(token, value),
    remove: (token: string) => void answers.delete(token),
  };
}

describe('AcmeClient', () => {
  it('gets a certificate for one name, answering http-01 with the account’s thumbprint', async () => {
    const box = responder();
    const removed: string[] = [];
    const acme = await fakeAcme({ answer: async (token) => box.answers.get(token) });
    const client = new AcmeClient({
      directoryUrl: acme.directoryUrl,
      accountKey: await newAccountKey(),
      fetch: acme.fetch,
      sleep: instant,
    });
    const issued = await client.issue('conch.example.com', {
      put: box.put,
      remove: (token) => {
        removed.push(token);
        box.remove(token);
      },
    });
    const cert = leaf(issued.certPem);
    expect(cert.subject).toBe('CN=conch.example.com');
    expect(issued.keyPem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    // The answer is taken back once the challenge is done.
    expect(removed).toEqual([acme.state.token]);
    expect(box.answers.size).toBe(0);
    // The account agreed to the terms, without an email.
    expect(acme.seen[0]?.payload).toEqual({ termsOfServiceAgreed: true });
    // After the account, requests name it by its URL, never the key again.
    expect(acme.seen.slice(1).every((r) => r.kid?.startsWith('https://acme.test/acct/'))).toBe(
      true,
    );
  });

  it('tries again with a fresh nonce when one is refused', async () => {
    const box = responder();
    const acme = await fakeAcme({ answer: async (t) => box.answers.get(t), badNonces: 2 });
    const client = new AcmeClient({
      directoryUrl: acme.directoryUrl,
      accountKey: await newAccountKey(),
      fetch: acme.fetch,
      sleep: instant,
    });
    await expect(client.issue('conch.example.com', box)).resolves.toMatchObject({
      certPem: expect.stringContaining('BEGIN CERTIFICATE'),
    });
  });

  it('says port 80 couldn’t be reached when the answer never arrives', async () => {
    const acme = await fakeAcme({ answer: async () => undefined });
    const client = new AcmeClient({
      directoryUrl: acme.directoryUrl,
      accountKey: await newAccountKey(),
      fetch: acme.fetch,
      sleep: instant,
    });
    const error = await client.issue('conch.example.com', responder()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AcmeError);
    expect((error as AcmeError).problem).toMatchObject({
      kind: 'unreachable',
      message: expect.stringMatching(
        /couldn’t reach this server at conch\.example\.com on port 80/,
      ),
    });
  });

  it('turns a rate limit into a time to try again', async () => {
    const acme = await fakeAcme({
      answer: async () => undefined,
      orderProblem: { status: 429, type: 'rateLimited', detail: 'too many', retryAfter: '3600' },
    });
    const client = new AcmeClient({
      directoryUrl: acme.directoryUrl,
      accountKey: await newAccountKey(),
      fetch: acme.fetch,
      sleep: instant,
    });
    const error = (await client
      .issue('conch.example.com', responder())
      .catch((e: unknown) => e)) as AcmeError;
    expect(error.problem.kind).toBe('rate-limited');
    expect(error.problem.retryAt).toBeGreaterThan(Date.now() + 3_000_000);
  });

  it('says Let’s Encrypt couldn’t be reached when the network fails', async () => {
    const client = new AcmeClient({
      directoryUrl: 'https://acme.test/dir',
      accountKey: await newAccountKey(),
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
      sleep: instant,
    });
    const error = (await client
      .issue('conch.example.com', responder())
      .catch((e: unknown) => e)) as AcmeError;
    expect(error.problem.kind).toBe('ca-unavailable');
  });

  it('asks the authority when to renew, and says it replaces the old one', async () => {
    const box = responder();
    const window = {
      start: '2030-01-10T00:00:00.000Z',
      end: '2030-01-12T00:00:01.000Z',
    };
    const acme = await fakeAcme({ answer: async (t) => box.answers.get(t), renewalInfo: window });
    const client = new AcmeClient({
      directoryUrl: acme.directoryUrl,
      accountKey: await newAccountKey(),
      fetch: acme.fetch,
      sleep: instant,
    });
    const first = await client.issue('conch.example.com', box);
    const suggested = await client.renewalWindow(first.certPem);
    expect(suggested).toMatchObject({
      start: Date.parse(window.start),
      end: Date.parse(window.end),
    });
    expect(suggested?.retryAfter).toBeGreaterThan(Date.now());
    expect(renewAt(first.certPem, suggested)).toBe(Date.parse(window.start) + 86_400_500);
    const id = renewalId(first.certPem);
    await client.issue('conch.example.com', box, { replaces: id });
    expect(acme.state.replaces).toBe(id);
  });
});

describe('renewalId', () => {
  it('is the AKI and the serial’s DER bytes, base64url', async () => {
    const ca = await testCa();
    const { certPem } = await leafFor('conch.example.com', { ca });
    const id = renewalId(certPem) ?? '';
    const [aki, serial] = id.split('.');
    expect(aki).toMatch(/^[A-Za-z0-9_-]+$/);
    // The serial starts with 0x80 or more, so DER keeps it positive with a leading zero.
    expect(Buffer.from(base64url.decode(serial ?? ''))[0]).toBe(0);
  });

  it('is undefined for a certificate without an AKI', async () => {
    const { certPem } = await leafFor('conch.example.com');
    expect(renewalId(certPem)).toBeUndefined();
  });
});

describe('renewAt', () => {
  it('is when a third of the lifetime is left, without the authority’s advice', async () => {
    const notBefore = new Date('2026-01-01T00:00:00Z');
    const notAfter = new Date('2026-04-01T00:00:00Z');
    const { certPem } = await leafFor('conch.example.com', { notBefore, notAfter });
    const third = (notAfter.getTime() - notBefore.getTime()) / 3;
    expect(renewAt(certPem)).toBe(notAfter.getTime() - third);
  });
});

describe('explain', () => {
  it.each([
    ['caa', 'caa', /CAA record for letsencrypt\.org/],
    ['dns', 'dns', /couldn’t look up conch\.example\.com/],
    ['rejectedIdentifier', 'rejected', /won’t give a certificate/],
    ['serverInternal', 'ca-unavailable', /having trouble/],
    ['somethingNew', 'other', /Let’s Encrypt said: odd/],
  ])('%s', (type, kind, message) => {
    expect(
      explain({ type: `urn:ietf:params:acme:error:${type}`, detail: 'odd' }, 'conch.example.com'),
    ).toMatchObject({ kind, message: expect.stringMatching(message) });
  });

  it('reads the cause from a subproblem', () => {
    expect(
      explain(
        {
          type: 'urn:ietf:params:acme:error:malformed',
          subproblems: [{ type: 'urn:ietf:params:acme:error:caa' }],
        },
        'conch.example.com',
      ).kind,
    ).toBe('caa');
  });
});
