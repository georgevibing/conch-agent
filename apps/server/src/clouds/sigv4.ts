/**
 * AWS Signature Version 4, for the two Bedrock requests Conch makes with an
 * AWS sign-in: the Messages API at `bedrock-mantle` and the model list at
 * `bedrock`. Built on `node:crypto`'s SHA-256 and HMAC only — the algorithm is
 * AWS's documented canonical request and signing-key chain, checked against
 * AWS's own published test vectors (`sigv4.test.ts`), not a cipher of our own.
 *
 * Source: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
 */
import { createHash, createHmac } from 'node:crypto';

/** Credentials for one signature. Held in memory only, never logged. */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** When they stop working, if they do. */
  expiresAt?: number;
}

export interface SignInput {
  method: string;
  url: string;
  /** The exact bytes that will be sent. */
  body?: string;
  headers?: Record<string, string>;
  region: string;
  service: string;
  credentials: AwsCredentials;
  /** Now, for tests. */
  now?: Date;
}

const sha256 = (data: string) => createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key: Buffer | string, data: string) =>
  createHmac('sha256', key).update(data, 'utf8').digest();

/** RFC 3986 encoding, as SigV4 wants it: everything but unreserved characters. */
function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `20150830T123600Z` and `20150830`. */
export function amzDate(now: Date): { stamp: string; day: string } {
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { stamp, day: stamp.slice(0, 8) };
}

/** The signing key: `AWS4` + secret, then the day, region, service and `aws4_request`. */
export function signingKey(secret: string, day: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), 'aws4_request');
}

/** Every service but S3 encodes each path segment twice in the canonical request. */
function canonicalPath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname
    .split('/')
    .map((segment) => encode(encode(decodeURIComponent(segment))))
    .join('/');
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/**
 * The headers to send with the request: the ones given, plus `x-amz-date`,
 * the session token when there is one, and `authorization`.
 */
export function signRequest(input: SignInput): Record<string, string> {
  const url = new URL(input.url);
  const { stamp, day } = amzDate(input.now ?? new Date());
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {}))
    headers[name.toLowerCase()] = value;
  headers['x-amz-date'] = stamp;
  if (input.credentials.sessionToken)
    headers['x-amz-security-token'] = input.credentials.sessionToken;
  const signed: Record<string, string> = { ...headers, host: url.host };
  const names = Object.keys(signed).sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${(signed[name] ?? '').trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = names.join(';');
  const canonical = [
    input.method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    sha256(input.body ?? ''),
  ].join('\n');
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const signature = createHmac(
    'sha256',
    signingKey(input.credentials.secretAccessKey, day, input.region, input.service),
  )
    .update(toSign, 'utf8')
    .digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
