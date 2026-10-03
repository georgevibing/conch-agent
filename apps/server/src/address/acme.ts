/**
 * Conch's own ACME client (RFC 8555), for one name over `http-01` (ADR 0064).
 *
 * Small on purpose: a directory, an account, an order, its authorizations, a
 * certificate request and the chain. The cryptography is `jose` (the signed
 * requests, ES256) and `@peculiar/x509` (the certificate request) over
 * Node's own WebCrypto; nothing here signs or parses on its own. ACME
 * Renewal Information (RFC 9773) says when to renew when the authority
 * offers it.
 */
import { webcrypto } from 'node:crypto';

// @peculiar/x509 needs the Reflect metadata API before it loads.
import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import {
  FlattenedSign,
  base64url,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  type JWK,
} from 'jose';

import { AddressProblemError, FIREWALL_HINT, type AddressProblem } from './problems';

x509.cryptoProvider.set(webcrypto as never);

export const LETS_ENCRYPT = 'https://acme-v02.api.letsencrypt.org/directory';
export const LETS_ENCRYPT_TERMS = 'https://letsencrypt.org/repository/';

const PROBLEM = 'urn:ietf:params:acme:error:';
const USER_AGENT = 'Conch (+https://conchagent.com)';
/** How long one certificate may take, all steps together, before Conch gives up this try. */
const POLL_TRIES = 60;

interface Directory {
  newNonce: string;
  newAccount: string;
  newOrder: string;
  renewalInfo?: string;
  meta?: { termsOfService?: string };
}

interface Order {
  status: 'pending' | 'ready' | 'processing' | 'valid' | 'invalid';
  authorizations: string[];
  finalize: string;
  certificate?: string;
  error?: AcmeProblemBody;
}

interface Challenge {
  type: string;
  url: string;
  token: string;
  status: string;
  error?: AcmeProblemBody;
}

interface Authorization {
  status: 'pending' | 'valid' | 'invalid' | 'deactivated' | 'expired' | 'revoked';
  identifier: { type: string; value: string };
  challenges: Challenge[];
}

interface AcmeProblemBody {
  type?: string;
  detail?: string;
  subproblems?: AcmeProblemBody[];
}

/** Where `http-01` answers live while a challenge is out (the port 80 listener reads them). */
export interface ChallengeResponder {
  put(token: string, keyAuthorization: string): void;
  remove(token: string): void;
}

export interface AcmeOptions {
  directoryUrl: string;
  /** The account's private key, as a JWK (ES256). Make one with `newAccountKey`. */
  accountKey: JWK;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface IssuedCertificate {
  /** The leaf first, then the chain, as PEM. */
  certPem: string;
  /** The certificate's own key, PKCS#8 PEM. */
  keyPem: string;
}

/** A fresh account key (ECDSA P-256), as a JWK to keep. */
export async function newAccountKey(): Promise<JWK> {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  return exportJWK(privateKey);
}

/** An ACME error, with the authority's own words and the plain ones. */
export class AcmeError extends AddressProblemError {
  constructor(
    problem: AddressProblem,
    readonly acmeType?: string,
    readonly status?: number,
  ) {
    super(problem);
  }
}

/** The authority's problem in a person's words, with the one thing to do next. */
export function explain(
  body: AcmeProblemBody | undefined,
  name: string,
  retryAfter?: number,
): AddressProblem {
  const type = body?.type?.startsWith(PROBLEM) ? body.type.slice(PROBLEM.length) : body?.type;
  // A failed authorization names its cause in a subproblem.
  const sub = body?.subproblems?.[0];
  const inner = sub?.type?.startsWith(PROBLEM) ? sub.type.slice(PROBLEM.length) : undefined;
  const kind = inner ?? type;
  switch (kind) {
    case 'rateLimited':
      return {
        kind: 'rate-limited',
        message: `Let’s Encrypt has given ${name} as many certificates as it allows for now. Conch tries again by itself${retryAfter ? ` after ${new Date(retryAfter).toLocaleString()}` : ' later'}.`,
        ...(retryAfter && { retryAt: retryAfter }),
      };
    case 'connection':
    case 'unauthorized':
    case 'incorrectResponse':
      return {
        kind: 'unreachable',
        message: `Let’s Encrypt couldn’t reach this server at ${name} on port 80. ${FIREWALL_HINT}`,
      };
    case 'dns':
      return {
        kind: 'dns',
        message: `Let’s Encrypt couldn’t look up ${name}. Check its record at your domain provider: it should point at this server.`,
      };
    case 'caa':
      return {
        kind: 'caa',
        message: `Your domain’s CAA records don’t allow Let’s Encrypt. At your domain provider, add a CAA record for letsencrypt.org (or remove the ones there), then try again.`,
      };
    case 'rejectedIdentifier':
      return {
        kind: 'rejected',
        message: `Let’s Encrypt won’t give a certificate for ${name}. Try another name.`,
      };
    case 'serverInternal':
      return {
        kind: 'ca-unavailable',
        message: 'Let’s Encrypt is having trouble right now. Conch tries again by itself.',
      };
    default:
      return {
        kind: 'other',
        message: `Let’s Encrypt said: ${body?.detail ?? sub?.detail ?? 'no reason given'}. Conch tries again by itself.`,
      };
  }
}

function retryAfterMs(response: Response, now = Date.now()): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return now + seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : date;
}

function pem(label: string, der: ArrayBuffer): string {
  const lines =
    Buffer.from(der)
      .toString('base64')
      .match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

/** The first certificate in a PEM chain. */
export function leaf(chainPem: string): x509.X509Certificate {
  const first = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(chainPem);
  if (!first) throw new Error('No certificate in that PEM.');
  return new x509.X509Certificate(first[0]);
}

/**
 * RFC 9773's certificate id: base64url(Authority Key Identifier) "."
 * base64url(serial number's DER bytes). Undefined without an AKI.
 */
export function renewalId(chainPem: string): string | undefined {
  const cert = leaf(chainPem);
  // By its OID: looking it up by class depends on which copy of the class registered it.
  const raw = cert.extensions.find((e) => e.type === '2.5.29.35');
  const aki = raw && new x509.AuthorityKeyIdentifierExtension(raw.rawData);
  if (!aki?.keyId) return undefined;
  let serial = cert.serialNumber.toLowerCase();
  if (serial.length % 2) serial = `0${serial}`;
  // DER keeps a positive INTEGER positive with a leading zero byte.
  if (/^[89a-f]/.test(serial)) serial = `00${serial}`;
  return `${base64url.encode(Buffer.from(aki.keyId, 'hex'))}.${base64url.encode(Buffer.from(serial, 'hex'))}`;
}

export interface RenewalWindow {
  start: number;
  end: number;
}

/**
 * When to renew: the middle of the authority's suggested window when it gave
 * one, otherwise when a third of the certificate's lifetime is left.
 */
export function renewAt(chainPem: string, window?: RenewalWindow): number {
  if (window) return Math.floor(window.start + (window.end - window.start) / 2);
  const cert = leaf(chainPem);
  const from = cert.notBefore.getTime();
  const to = cert.notAfter.getTime();
  return from + ((to - from) * 2) / 3;
}

export class AcmeClient {
  #directory?: Directory;
  #nonce?: string;
  #kid?: string;
  #key?: webcrypto.CryptoKey;
  #publicJwk?: JWK;
  /** The name being issued for, for the words of an error. */
  #current?: string;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: AcmeOptions) {
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async directory(): Promise<Directory> {
    if (this.#directory) return this.#directory;
    const response = await this.#request(this.options.directoryUrl, { method: 'GET' });
    if (!response.ok) throw this.#unavailable();
    this.#directory = (await response.json()) as Directory;
    return this.#directory;
  }

  /** Get a certificate for `name`, answering its `http-01` challenge through `responder`. */
  async issue(
    name: string,
    responder: ChallengeResponder,
    options: { replaces?: string } = {},
  ): Promise<IssuedCertificate> {
    this.#current = name;
    const directory = await this.directory();
    await this.#account();
    const identifiers = [{ type: 'dns', value: name }];
    let created: { body: Order; location: string };
    try {
      created = await this.#post<Order>(directory.newOrder, {
        identifiers,
        ...(options.replaces && directory.renewalInfo && { replaces: options.replaces }),
      });
    } catch (error) {
      // An authority that won't take `replaces` (or already saw it) still issues without it.
      if (!(options.replaces && error instanceof AcmeError && error.status === 400)) throw error;
      created = await this.#post<Order>(directory.newOrder, { identifiers });
    }
    let order = created.body;
    const orderUrl = created.location;

    for (const url of order.authorizations) await this.#authorize(url, name, responder);

    const keys = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as webcrypto.CryptoKeyPair;
    const csr = await x509.Pkcs10CertificateRequestGenerator.create({
      name: `CN=${name}`,
      keys: keys as never,
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
      extensions: [new x509.SubjectAlternativeNameExtension([{ type: 'dns', value: name }])],
    });
    order = await this.#waitForOrder(orderUrl, order, ['ready', 'valid'], name);
    if (order.status === 'ready')
      order = (
        await this.#post<Order>(order.finalize, {
          csr: base64url.encode(new Uint8Array(csr.rawData)),
        })
      ).body;
    order = await this.#waitForOrder(orderUrl, order, ['valid'], name);
    if (!order.certificate) throw this.#unavailable();
    const chain = await this.#post<string>(order.certificate, undefined, {
      accept: 'application/pem-certificate-chain',
    });
    const keyPem = pem('PRIVATE KEY', await webcrypto.subtle.exportKey('pkcs8', keys.privateKey));
    return { certPem: chain.body, keyPem };
  }

  /** The authority's suggested renewal window for this certificate, when it offers one (RFC 9773). */
  async renewalWindow(
    chainPem: string,
  ): Promise<(RenewalWindow & { retryAfter?: number }) | undefined> {
    const directory = await this.directory();
    const id = directory.renewalInfo && renewalId(chainPem);
    if (!directory.renewalInfo || !id) return undefined;
    const response = await this.#request(`${directory.renewalInfo.replace(/\/$/, '')}/${id}`, {
      method: 'GET',
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { suggestedWindow?: { start?: string; end?: string } };
    const start = Date.parse(body.suggestedWindow?.start ?? '');
    const end = Date.parse(body.suggestedWindow?.end ?? '');
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;
    const retryAfter = retryAfterMs(response);
    return { start, end, ...(retryAfter && { retryAfter }) };
  }

  async #authorize(url: string, name: string, responder: ChallengeResponder): Promise<void> {
    let authz = (await this.#post<Authorization>(url)).body;
    if (authz.status === 'valid') return;
    const challenge = authz.challenges.find((c) => c.type === 'http-01');
    if (!challenge)
      throw new AcmeError({
        kind: 'other',
        message:
          'Let’s Encrypt didn’t offer a way to check this server over port 80. Conch tries again by itself.',
      });
    const thumbprint = await calculateJwkThumbprint(await this.#jwk());
    responder.put(challenge.token, `${challenge.token}.${thumbprint}`);
    try {
      if (challenge.status === 'pending') await this.#post(challenge.url, {});
      for (let i = 0; i < POLL_TRIES; i++) {
        const polled = await this.#post<Authorization>(url);
        authz = polled.body;
        if (authz.status === 'valid') return;
        if (authz.status !== 'pending') {
          const failed = authz.challenges.find((c) => c.type === 'http-01');
          throw new AcmeError(explain(failed?.error, name), failed?.error?.type);
        }
        await this.#sleep(Math.max(1000, Math.min(polled.retryAfter ?? 2000, 10_000)));
      }
      throw this.#slow();
    } finally {
      responder.remove(challenge.token);
    }
  }

  async #waitForOrder(
    url: string,
    order: Order,
    wanted: Order['status'][],
    name: string,
  ): Promise<Order> {
    let current = order;
    for (let i = 0; i < POLL_TRIES; i++) {
      if (wanted.includes(current.status)) return current;
      if (current.status === 'invalid')
        throw new AcmeError(explain(current.error, name), current.error?.type);
      const polled = await this.#post<Order>(url);
      current = polled.body;
      if (wanted.includes(current.status)) return current;
      await this.#sleep(Math.max(1000, Math.min(polled.retryAfter ?? 2000, 10_000)));
    }
    throw this.#slow();
  }

  async #account(): Promise<string> {
    if (this.#kid) return this.#kid;
    const directory = await this.directory();
    const { location } = await this.#post(
      directory.newAccount,
      { termsOfServiceAgreed: true },
      { jwk: true },
    );
    if (!location) throw this.#unavailable();
    this.#kid = location;
    return location;
  }

  async #privateKey(): Promise<webcrypto.CryptoKey> {
    this.#key ??= (await importJWK(this.options.accountKey, 'ES256')) as webcrypto.CryptoKey;
    return this.#key;
  }

  async #jwk(): Promise<JWK> {
    if (!this.#publicJwk) {
      const { kty, crv, x, y } = this.options.accountKey;
      this.#publicJwk = { kty, crv, x, y } as JWK;
    }
    return this.#publicJwk;
  }

  async #newNonce(): Promise<string> {
    const directory = await this.directory();
    const response = await this.#request(directory.newNonce, { method: 'HEAD' });
    const nonce = response.headers.get('replay-nonce');
    if (!nonce) throw this.#unavailable();
    return nonce;
  }

  /** A signed POST (or POST-as-GET without a payload), with the nonce dance and its one retry rule. */
  async #post<T = unknown>(
    url: string,
    payload?: unknown,
    options: { jwk?: boolean; accept?: string } = {},
  ): Promise<{ body: T; location: string; retryAfter?: number }> {
    for (let attempt = 0; ; attempt++) {
      const nonce = this.#nonce ?? (await this.#newNonce());
      this.#nonce = undefined;
      const header = {
        alg: 'ES256',
        nonce,
        url,
        ...(options.jwk ? { jwk: await this.#jwk() } : { kid: await this.#account() }),
      };
      const bytes =
        payload === undefined
          ? new Uint8Array(0)
          : new TextEncoder().encode(JSON.stringify(payload));
      const jws = await new FlattenedSign(bytes)
        .setProtectedHeader(header)
        .sign(await this.#privateKey());
      const response = await this.#request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/jose+json',
          ...(options.accept && { accept: options.accept }),
        },
        body: JSON.stringify(jws),
      });
      const next = response.headers.get('replay-nonce');
      if (next) this.#nonce = next;
      const retryAfter = retryAfterMs(response);
      if (response.ok) {
        const type = response.headers.get('content-type') ?? '';
        const body = (type.includes('json') ? await response.json() : await response.text()) as T;
        return {
          body,
          location: response.headers.get('location') ?? '',
          ...(retryAfter && { retryAfter: retryAfter - Date.now() }),
        };
      }
      const problem = (await response.json().catch(() => ({}))) as AcmeProblemBody;
      if (problem.type === `${PROBLEM}badNonce` && attempt < 3) continue;
      throw new AcmeError(
        explain(problem, this.#current ?? 'this address', retryAfter),
        problem.type,
        response.status,
      );
    }
  }

  async #request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(url, {
        ...init,
        // RFC 8555 §6.1: every request names the client.
        headers: { ...(init.headers as Record<string, string>), 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw this.#unavailable();
    }
  }

  #unavailable(): AcmeError {
    return new AcmeError({
      kind: 'ca-unavailable',
      message: 'Conch couldn’t reach Let’s Encrypt just now. It tries again by itself.',
    });
  }

  #slow(): AcmeError {
    return new AcmeError({
      kind: 'ca-unavailable',
      message: 'Let’s Encrypt is taking a long time to answer. Conch tries again by itself.',
    });
  }
}
