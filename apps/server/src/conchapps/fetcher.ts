/**
 * `app.fetch` (ADR 0061 §2): the only way a Conch app reaches the web. The
 * sealed process asks over its IPC channel, and Conch makes the request on
 * these terms, on the same guard as live data (ADR 0046, `artifacts/live.ts`):
 *
 * - **Only the hosts on its card.** `https://` to a host in the manifest's
 *   `reaches`, exactly, and every redirect again (at most three).
 * - **Never inward.** Every address a name resolves to is checked as it
 *   connects (the address checked is the address dialled): never this
 *   computer, your network, link-local or cloud metadata, and never Conch's
 *   own port anywhere.
 * - **The app's own request, not yours.** Its method, headers and body —
 *   but no cookies, no `host`, no proxy or hop-by-hop headers, and nothing
 *   of Conch's. A redirect to another host drops `authorization`.
 * - **Little and seldom.** At most 1 MB out, 5 MB back, 20 seconds, and 600
 *   requests an hour per app.
 *
 * Every refusal is one sentence the tool can pass on to the model.
 */
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import { APP_LIMITS } from '@conch/protocol';

import { guardedLookup, placeOf, systemResolve, type Place, type Resolve } from '../artifacts/live';
import type { AppFetcher, AppFetchRequest, AppFetchResponse } from './types';

export interface FetcherDeps {
  resolve?: Resolve;
  /** Conch's own port: never dialled, on any address. */
  gatewayPort?: number;
  now?: () => number;
  /** Where an address is (`placeOf`); tests point a name at a server on this computer. */
  place?: (address: string) => Place;
  /** Extra certificates to trust, for a test server. */
  ca?: string | Buffer;
  timeoutMs?: number;
}

/** Headers an app may not set: the connection's, the proxy's, and anyone's cookies. */
const DROPPED = new Set([
  'host',
  'cookie',
  'cookie2',
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-authenticate',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'expect',
  'accept-encoding',
  'forwarded',
  'via',
  'http2-settings',
]);
const DROPPED_PREFIX = /^(?:proxy-|x-forwarded-|sec-)/i;
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const TEXT =
  /^(?:text\/[a-z0-9.+-]+|application\/(?:json|xml|javascript|ecmascript|x-www-form-urlencoded|csv|ld\+json|geo\+json|problem\+json|[a-z0-9.-]+\+(?:json|xml)))$/i;

const refuse = (message: string): AppFetchResponse => ({
  ok: false,
  status: 0,
  headers: {},
  body: '',
  refused: message,
});

const portOf = (url: URL) => Number(url.port) || 443;
const bare = (hostname: string) => hostname.replace(/^\[|\]$/g, '').toLowerCase();

function headersFor(given: Record<string, string>, appId: string): Record<string, string> | string {
  const out: Record<string, string> = {};
  const names = Object.keys(given);
  if (names.length > 50) return 'That request has too many headers: send at most 50.';
  for (const [rawName, value] of Object.entries(given)) {
    const name = rawName.toLowerCase();
    if (!TOKEN.test(name)) return `“${rawName.slice(0, 40)}” isn’t a header name.`;
    if (DROPPED.has(name) || DROPPED_PREFIX.test(name)) continue;
    if (/[\r\n\0]/.test(value))
      return `The “${name}” header has a line break in it, which isn’t allowed.`;
    if (/[^\t\x20-\x7e]/.test(value))
      return `The “${name}” header has characters a header can’t carry: encode it first (for example with encodeURIComponent).`;
    if (value.length > 8192) return `The “${name}” header is too long.`;
    out[name] = value;
  }
  out['user-agent'] ??= `Conch app (${appId})`;
  out['accept-encoding'] = 'gzip, deflate, br';
  return out;
}

export function createFetcher(deps: FetcherDeps = {}): AppFetcher {
  const resolve = deps.resolve ?? systemResolve;
  const place = deps.place ?? placeOf;
  const now = deps.now ?? Date.now;
  /** Per app: when each of its requests in the last hour was made. */
  const made = new Map<string, number[]>();

  /** Why an app may not connect to `address` for `url`, or nothing when it may. */
  const refusal = (address: string, url: URL): string | undefined => {
    const where = place(address);
    if (where === 'never') return `${url.hostname} points somewhere Conch never connects to.`;
    if (where === 'your-network')
      return `${url.hostname} is on your own network, which apps can’t reach.`;
    if (where === 'this-computer')
      return `${url.hostname} is on this computer, which apps can’t reach.`;
    if (deps.gatewayPort !== undefined && portOf(url) === deps.gatewayPort)
      return 'An app can’t reach Conch itself.';
    return undefined;
  };

  const budget = (appId: string): boolean => {
    const at = now();
    const recent = (made.get(appId) ?? []).filter((t) => at - t < 3_600_000);
    if (recent.length >= APP_LIMITS.fetchPerHour) {
      made.set(appId, recent);
      return false;
    }
    recent.push(at);
    made.set(appId, recent);
    return true;
  };

  return async (app, request, signal) => {
    const method = request.method;
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method))
      return refuse(`Apps can’t send ${String(method).slice(0, 20)} requests.`);
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return refuse(`“${request.url.slice(0, 100)}” isn’t a web address.`);
    }
    const headers = headersFor(request.headers ?? {}, app.id);
    if (typeof headers === 'string') return refuse(headers);
    let body: Buffer | undefined;
    if (request.body !== undefined) {
      if (method === 'GET' || method === 'HEAD')
        return refuse(`A ${method} request can’t carry a body.`);
      body = Buffer.from(request.body, request.bodyBase64 ? 'base64' : 'utf8');
      if (body.length > APP_LIMITS.fetchOut)
        return refuse(
          `That’s too much to send: at most ${APP_LIMITS.fetchOut / 1024 / 1024} MB in one request.`,
        );
    }
    const reaches = new Set(app.reaches.map((h) => h.toLowerCase()));
    /** Why a hop may not go to `target`, before anything is looked up. */
    const whyNot = (target: URL, hop: number): string | undefined => {
      if (target.protocol !== 'https:')
        return `${target.host} isn’t a secure (https) address; apps only use https.`;
      if (target.username || target.password)
        return 'Addresses with a sign-in in them aren’t used: send it in a header.';
      if (!reaches.has(target.hostname.toLowerCase()))
        return hop === 0
          ? `This app may only reach ${[...reaches].join(', ') || 'no websites'}, not ${target.hostname}. Add it to “reaches” in conch-app.json.`
          : `${target.hostname} isn’t one of the sites this app may reach, and the request was sent on to it.`;
      return undefined;
    };
    const first = whyNot(url, 0);
    if (first) return refuse(first);
    if (!budget(app.id))
      return refuse(
        `This app has made ${APP_LIMITS.fetchPerHour} requests in the last hour, so Conch is holding off for a while.`,
      );

    const timeout = AbortSignal.timeout(deps.timeoutMs ?? APP_LIMITS.fetchMs);
    const stop = AbortSignal.any([signal, timeout]);
    let current = { url, method, body, headers };
    for (let hop = 0; hop <= 3; hop++) {
      const target = current.url;
      const why = whyNot(target, hop);
      if (why) return refuse(why);
      // Node doesn't look up an address that is one already: check it here.
      const literal = bare(target.hostname);
      if (isIP(literal)) {
        const no = refusal(literal, target);
        if (no) return refuse(no);
      }
      let refused: string | undefined;
      const lookup = guardedLookup(
        resolve,
        (address) => refusal(address, target),
        (why) => {
          refused = why;
        },
      );
      let response: IncomingMessage;
      try {
        response = await new Promise<IncomingMessage>((done, failed) => {
          const req = httpsRequest(target, {
            method: current.method,
            agent: false,
            lookup,
            signal: stop,
            headers: {
              ...current.headers,
              ...(current.body && { 'content-length': String(current.body.length) }),
            },
            ...(deps.ca && { ca: deps.ca }),
          });
          req.on('response', done);
          req.on('error', failed);
          req.end(current.body);
        });
      } catch (error) {
        if (refused) return refuse(refused);
        if (timeout.aborted) return refuse(`${target.host} took too long to answer.`);
        if (signal.aborted) return refuse('The request was stopped.');
        return refuse(
          error instanceof Error && /Couldn’t find/.test(error.message)
            ? error.message
            : `Couldn’t reach ${target.host}.`,
        );
      }
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        response.resume();
        if (hop === 3) return refuse(`${target.host} sent the request on too many times.`);
        let next: URL;
        try {
          next = new URL(location, target);
        } catch {
          return refuse(`${target.host} sent the request on to an address that isn’t one.`);
        }
        // 307 and 308 keep the method and body; 303 (and a POST's 301/302) become GET.
        const keep =
          status === 307 ||
          status === 308 ||
          ((status === 301 || status === 302) && current.method !== 'POST');
        const nextMethod = keep ? current.method : current.method === 'HEAD' ? 'HEAD' : 'GET';
        const nextHeaders = { ...current.headers };
        if (!keep) {
          delete nextHeaders['content-type'];
        }
        // Credentials meant for one site never go to another.
        if (next.host.toLowerCase() !== target.host.toLowerCase()) delete nextHeaders.authorization;
        current = {
          url: next,
          method: nextMethod,
          body: keep ? current.body : undefined,
          headers: nextHeaders,
        };
        continue;
      }
      return read(response, target, current.method, timeout, signal);
    }
    return refuse('The request was sent on too many times.');
  };
}

async function read(
  response: IncomingMessage,
  target: URL,
  method: AppFetchRequest['method'],
  timeout: AbortSignal,
  signal: AbortSignal,
): Promise<AppFetchResponse> {
  const status = response.statusCode ?? 0;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  const max = APP_LIMITS.fetchBack;
  const tooBig = `${target.host} sent more than an app can take (${max / 1024 / 1024} MB).`;
  if (method === 'HEAD') {
    response.resume();
    return { ok: status >= 200 && status < 300, status, headers, body: '' };
  }
  if (Number(response.headers['content-length'] ?? 0) > max) {
    response.destroy();
    return refuse(tooBig);
  }
  const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase();
  const stream =
    encoding === 'gzip'
      ? response.pipe(createGunzip())
      : encoding === 'deflate'
        ? response.pipe(createInflate())
        : encoding === 'br'
          ? response.pipe(createBrotliDecompress())
          : response;
  const got = await new Promise<Buffer | 'too-big' | 'failed'>((done) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        response.destroy();
        stream.destroy();
        done('too-big');
      } else chunks.push(chunk);
    });
    stream.on('end', () => done(Buffer.concat(chunks)));
    stream.on('error', () => done('failed'));
    response.on('error', () => done('failed'));
  });
  if (got === 'too-big') return refuse(tooBig);
  if (got === 'failed')
    return refuse(
      timeout.aborted
        ? `${target.host} took too long to answer.`
        : signal.aborted
          ? 'The request was stopped.'
          : `${target.host} stopped answering halfway.`,
    );
  // It's decoded now: the length and encoding it came with no longer apply.
  delete headers['content-encoding'];
  delete headers['content-length'];
  const type = (headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
  const text = type === '' ? looksLikeText(got) : TEXT.test(type);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    ...(text ? { body: got.toString('utf8') } : { body: got.toString('base64'), bodyBase64: true }),
  };
}

/** No type given: text when it reads as UTF-8 with no NULs. */
function looksLikeText(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
