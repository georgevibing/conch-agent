/**
 * For the address module's tests: certificates made on the spot, and a
 * pretend ACME server (RFC 8555) that checks every signed request and asks
 * for the `http-01` answer the way Let's Encrypt does.
 */
import { createHash, randomBytes, webcrypto } from 'node:crypto';

// @peculiar/x509 needs the Reflect metadata API before it loads.
import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import { base64url, calculateJwkThumbprint, flattenedVerify, importJWK, type JWK } from 'jose';

x509.cryptoProvider.set(webcrypto as never);

const ALG = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;

function pem(label: string, der: ArrayBuffer): string {
  const lines =
    Buffer.from(der)
      .toString('base64')
      .match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

export interface TestCa {
  cert: x509.X509Certificate;
  keys: webcrypto.CryptoKeyPair;
}

export async function testCa(): Promise<TestCa> {
  const keys = (await webcrypto.subtle.generateKey(ALG, true, [
    'sign',
    'verify',
  ])) as webcrypto.CryptoKeyPair;
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    name: 'C=US, O=Pretend Encrypt, CN=P1',
    keys: keys as never,
    signingAlgorithm: ALG,
    notBefore: new Date(Date.now() - 86_400_000),
    notAfter: new Date(Date.now() + 365 * 86_400_000),
    extensions: [new x509.BasicConstraintsExtension(true, undefined, true)],
  });
  return { cert, keys };
}

/** A leaf for `name` signed by `ca` (or by itself), with its key, as PEM. */
export async function leafFor(
  name: string,
  options: { ca?: TestCa; notBefore?: Date; notAfter?: Date; publicKey?: x509.PublicKey } = {},
): Promise<{ certPem: string; keyPem: string }> {
  const keys = (await webcrypto.subtle.generateKey(ALG, true, [
    'sign',
    'verify',
  ])) as webcrypto.CryptoKeyPair;
  const ca = options.ca;
  const params = {
    serialNumber: `${(0x80 + ((randomBytes(1)[0] ?? 0) % 0x7f)).toString(16)}${randomBytes(15).toString('hex')}`,
    subject: `CN=${name}`,
    issuer: ca ? ca.cert.subject : `CN=${name}`,
    notBefore: options.notBefore ?? new Date(Date.now() - 60_000),
    notAfter: options.notAfter ?? new Date(Date.now() + 90 * 86_400_000),
    signingAlgorithm: ALG,
    publicKey: options.publicKey ?? (keys.publicKey as never),
    signingKey: (ca ? ca.keys.privateKey : keys.privateKey) as never,
    extensions: [
      new x509.SubjectAlternativeNameExtension([{ type: 'dns', value: name }]),
      ...(ca
        ? [await x509.AuthorityKeyIdentifierExtension.create(ca.cert.publicKey as never)]
        : []),
    ],
  };
  const cert = await x509.X509CertificateGenerator.create(params);
  return {
    certPem: cert.toString('pem') + (ca ? `\n${ca.cert.toString('pem')}` : ''),
    keyPem: pem('PRIVATE KEY', await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)),
  };
}

export interface FakeAcmeOptions {
  /** Fetch the `http-01` answer for a token (the test points it at the responder). */
  answer: (token: string) => Promise<string | undefined>;
  /** Answer newOrder with this problem instead. */
  orderProblem?: { status: number; type: string; detail: string; retryAfter?: string };
  /** The first N signed requests get a badNonce. */
  badNonces?: number;
  renewalInfo?: { start: string; end: string };
  /** The leaf's lifetime. */
  days?: number;
}

/** A pretend ACME server, as a `fetch`. */
export async function fakeAcme(options: FakeAcmeOptions) {
  const base = 'https://acme.test';
  const ca = await testCa();
  const nonces = new Set<string>();
  const accounts = new Map<string, JWK>();
  const seen: { url: string; payload: unknown; kid?: string }[] = [];
  let badNonces = options.badNonces ?? 0;
  let orders = 0;
  const state = {
    authz: 'pending' as 'pending' | 'valid' | 'invalid',
    order: 'pending' as string,
    name: '',
    token: base64url.encode(randomBytes(16)),
    cert: '',
    replaces: undefined as string | undefined,
  };
  const nonce = () => {
    const n = base64url.encode(randomBytes(12));
    nonces.add(n);
    return n;
  };
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'replay-nonce': nonce(), ...headers },
    });
  const problem = (status: number, type: string, detail: string, headers = {}) =>
    new Response(JSON.stringify({ type: `urn:ietf:params:acme:error:${type}`, detail }), {
      status,
      headers: { 'content-type': 'application/problem+json', 'replay-nonce': nonce(), ...headers },
    });

  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const path = url.slice(base.length);
    if (path === '/dir')
      return json(200, {
        newNonce: `${base}/nonce`,
        newAccount: `${base}/account`,
        newOrder: `${base}/order`,
        ...(options.renewalInfo && { renewalInfo: `${base}/ari` }),
      });
    if (path === '/nonce')
      return new Response(null, { status: 200, headers: { 'replay-nonce': nonce() } });
    if (path.startsWith('/ari/'))
      return json(200, { suggestedWindow: options.renewalInfo }, { 'retry-after': '21600' });

    const jws = JSON.parse(String(init?.body)) as {
      protected: string;
      payload: string;
      signature: string;
    };
    const header = JSON.parse(Buffer.from(jws.protected, 'base64url').toString()) as {
      alg: string;
      nonce: string;
      url: string;
      jwk?: JWK;
      kid?: string;
    };
    if (header.url !== url) return problem(400, 'unauthorized', 'url mismatch');
    if (!nonces.delete(header.nonce)) return problem(400, 'badNonce', 'unknown nonce');
    if (badNonces > 0) {
      badNonces--;
      return problem(400, 'badNonce', 'try again');
    }
    const jwk = header.jwk ?? (header.kid ? accounts.get(header.kid) : undefined);
    if (!jwk) return problem(400, 'accountDoesNotExist', 'no account');
    await flattenedVerify(jws, await importJWK(jwk, header.alg));
    const payload = jws.payload
      ? (JSON.parse(Buffer.from(jws.payload, 'base64url').toString()) as Record<string, unknown>)
      : undefined;
    seen.push({ url, payload, ...(header.kid && { kid: header.kid }) });

    if (path === '/account') {
      if (payload?.termsOfServiceAgreed !== true) return problem(400, 'malformed', 'agree');
      const kid = `${base}/acct/${createHash('sha256').update(JSON.stringify(jwk)).digest('hex').slice(0, 8)}`;
      accounts.set(kid, jwk);
      return json(201, { status: 'valid' }, { location: kid });
    }
    if (path === '/order') {
      if (options.orderProblem) {
        const p = options.orderProblem;
        return problem(
          p.status,
          p.type,
          p.detail,
          p.retryAfter ? { 'retry-after': p.retryAfter } : {},
        );
      }
      orders++;
      const identifiers = payload?.identifiers as { value: string }[];
      state.name = identifiers[0]?.value ?? '';
      state.replaces = payload?.replaces as string | undefined;
      state.order = 'pending';
      state.authz = 'pending';
      return json(201, orderBody(), { location: `${base}/o/1` });
    }
    if (path === '/o/1') return json(200, orderBody());
    if (path === '/authz/1')
      return json(200, {
        status: state.authz,
        identifier: { type: 'dns', value: state.name },
        challenges: [
          {
            type: 'http-01',
            url: `${base}/chall/1`,
            token: state.token,
            status: state.authz === 'pending' ? 'pending' : state.authz,
            ...(state.authz === 'invalid' && {
              error: {
                type: 'urn:ietf:params:acme:error:connection',
                detail: 'Timeout during connect',
              },
            }),
          },
        ],
      });
    if (path === '/chall/1') {
      const want = `${state.token}.${await calculateJwkThumbprint(jwk)}`;
      const got = await options.answer(state.token);
      state.authz = got === want ? 'valid' : 'invalid';
      if (state.authz === 'valid') state.order = 'ready';
      else state.order = 'invalid';
      return json(200, { status: 'processing' });
    }
    if (path === '/finalize') {
      const csr = new x509.Pkcs10CertificateRequest(Buffer.from(String(payload?.csr), 'base64url'));
      const raw = csr.extensions.find((e) => e.type === '2.5.29.17');
      const san = raw && new x509.SubjectAlternativeNameExtension(raw.rawData);
      const names = san?.names.toJSON().map((n) => n.value) ?? [];
      if (!names.includes(state.name))
        return problem(400, 'badCSR', `wrong names ${JSON.stringify(names)} for ${state.name}`);
      const issued = await leafFor(state.name, {
        ca,
        publicKey: csr.publicKey,
        notAfter: new Date(Date.now() + (options.days ?? 90) * 86_400_000),
      });
      state.cert = issued.certPem;
      state.order = 'valid';
      return json(200, orderBody());
    }
    if (path === '/cert/1')
      return new Response(state.cert, {
        status: 200,
        headers: { 'content-type': 'application/pem-certificate-chain', 'replay-nonce': nonce() },
      });
    return problem(404, 'malformed', `no ${path}`);
  };

  function orderBody() {
    return {
      status: state.order,
      identifiers: [{ type: 'dns', value: state.name }],
      authorizations: [`${base}/authz/1`],
      finalize: `${base}/finalize`,
      ...(state.order === 'valid' && { certificate: `${base}/cert/1` }),
      ...(state.order === 'invalid' && {
        error: { type: 'urn:ietf:params:acme:error:connection', detail: 'Timeout during connect' },
      }),
    };
  }

  return {
    directoryUrl: `${base}/dir`,
    fetch: fetcher as typeof fetch,
    ca,
    seen,
    state,
    orders: () => orders,
  };
}
