/**
 * The only way a provider a Conch app declares reaches its company (ADR
 * 0122): a `fetch` the chat adapters (`openai.ts`, `anthropic.ts`) use as
 * they use the global one, streaming, on the terms an app's `app.fetch` has:
 *
 * - **Only the hosts on its card.** `https://` to a host in the manifest's
 *   `reaches`, exactly. Redirects are never followed (no provider redirects,
 *   and `send` refuses them anyway).
 * - **Never inward.** Every address a name resolves to is checked as it
 *   connects (`guardedLookup`, the address checked is the address dialled):
 *   never this computer, your network, link-local or cloud metadata, and
 *   never Conch's own port.
 * - **Its key, and only its key, the way it declared.** The adapters put the
 *   key in `Authorization: Bearer`; a provider whose key goes in a header of
 *   its own (`auth: 'header'`) gets it moved there, and one with none
 *   (`auth: 'none'`) never sends one. Nothing of Conch's rides along: no
 *   cookies, no proxy or forwarding headers.
 *
 * A model's answer streams, so nothing here buffers or caps what comes back
 * beyond what the adapters already do; what goes out is at most 16 MB.
 */
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import type { AppProviderPart } from '@conch/protocol';

import { guardedLookup, placeOf, systemResolve, type Place, type Resolve } from '../artifacts/live';
import type { FetchLike } from '../engines/api/types';

/** A request out, at most: a long chat with pictures in it. */
const MAX_OUT = 16 * 1024 * 1024;

/** Headers a provider's request never carries, whatever the adapter set. */
const DROPPED = new Set([
  'host',
  'cookie',
  'cookie2',
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'expect',
  'forwarded',
  'via',
]);
const DROPPED_PREFIX = /^(?:proxy-|x-forwarded-|sec-)/i;

export interface PartFetchOptions {
  /** The app, for the user agent and the words. */
  app: { id: string; name: string; reaches: readonly string[] };
  provider: Pick<AppProviderPart, 'auth' | 'header'>;
  /** Conch's own port: never dialled, on any address. */
  gatewayPort?: number;
  resolve?: Resolve;
  /** Where an address is (`placeOf`); tests point a name at a server on this computer. */
  place?: (address: string) => Place;
  /** Extra certificates to trust, for a test server. */
  ca?: string | Buffer;
  /**
   * The mock engine's pretend world (`pnpm dev:mock`, e2e): a pretend company's
   * exact host answered by a server on this computer. Never set otherwise.
   */
  pretend?: (url: URL) => string | undefined;
}

/** A refusal, said the way a failed `fetch` says it: the adapters turn it into a sentence. */
class Refused extends TypeError {}

/** The adapter's headers, held to what a provider's request may carry, with the key where it goes. */
export function headersFor(
  given: Headers,
  provider: Pick<AppProviderPart, 'auth' | 'header'>,
  appId: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  given.forEach((value, rawName) => {
    const name = rawName.toLowerCase();
    if (DROPPED.has(name) || DROPPED_PREFIX.test(name)) return;
    out[name] = value;
  });
  const bearer = /^Bearer\s+(.+)$/i.exec(out.authorization ?? '')?.[1];
  if (provider.auth === 'none') {
    delete out.authorization;
    delete out['x-api-key'];
  } else if (provider.auth === 'header' && provider.header) {
    delete out.authorization;
    if (bearer) out[provider.header] = bearer;
  }
  out['user-agent'] = `Conch (app ${appId})`;
  out['accept-encoding'] = 'gzip, deflate, br';
  return out;
}

/** A `fetch` for one provider a Conch app declares, only to its own hosts. */
export function partFetch(options: PartFetchOptions): FetchLike {
  const resolve = options.resolve ?? systemResolve;
  const place = options.place ?? placeOf;
  const reaches = new Set(options.app.reaches.map((h) => h.toLowerCase()));
  const portOf = (url: URL) => Number(url.port) || 443;

  const refusal = (address: string, url: URL): string | undefined => {
    const where = place(address);
    if (where === 'never') return `${url.hostname} points somewhere Conch never connects to.`;
    if (where === 'your-network')
      return `${url.hostname} is on your own network, which a provider from an app can’t reach.`;
    if (where === 'this-computer')
      return `${url.hostname} is on this computer, which a provider from an app can’t reach.`;
    if (options.gatewayPort !== undefined && portOf(url) === options.gatewayPort)
      return 'A provider from an app can’t reach Conch itself.';
    return undefined;
  };

  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.protocol !== 'https:')
      throw new Refused(`${options.app.name} only reaches its company over https.`);
    if (url.username || url.password)
      throw new Refused('Addresses with a sign-in in them aren’t used.');
    if (!reaches.has(url.hostname.toLowerCase()))
      throw new Refused(
        `${options.app.name} may only reach ${[...reaches].join(', ') || 'no websites'}, not ${url.hostname}.`,
      );
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'POST')
      throw new Refused(`${options.app.name} only asks with GET and POST.`);
    const body = method === 'POST' ? Buffer.from(await request.arrayBuffer()) : undefined;
    if (body && body.length > MAX_OUT)
      throw new Refused('That request is bigger than Conch sends to a provider.');
    const headers = headersFor(request.headers, options.provider, options.app.id);
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(literal)) {
      const no = refusal(literal, url);
      if (no) throw new Refused(no);
    }
    let refused: string | undefined;
    const lookup = guardedLookup(
      resolve,
      (address) => refusal(address, url),
      (why) => {
        refused = why;
      },
    );
    // The pretend world (mock engine only): the same request, to the pretend company here.
    const pretend = options.pretend?.(url);
    const signal = init.signal ?? request.signal;
    const response = await new Promise<IncomingMessage>((done, failed) => {
      const req = pretend
        ? httpRequest(pretend, {
            method,
            agent: false,
            signal,
            headers: { ...headers, ...(body && { 'content-length': String(body.length) }) },
          })
        : httpsRequest(url, {
            method,
            agent: false,
            lookup,
            signal,
            headers: { ...headers, ...(body && { 'content-length': String(body.length) }) },
            ...(options.ca && { ca: options.ca }),
          });
      req.on('response', done);
      req.on('error', (error) => failed(refused ? new Refused(refused) : error));
      req.end(body);
    });
    const status = response.statusCode ?? 0;
    const out = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (value === undefined || name === 'set-cookie') continue;
      out.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    const encoding = (out.get('content-encoding') ?? '').toLowerCase();
    const decoded =
      encoding === 'gzip'
        ? response.pipe(createGunzip())
        : encoding === 'deflate'
          ? response.pipe(createInflate())
          : encoding === 'br'
            ? response.pipe(createBrotliDecompress())
            : response;
    out.delete('content-encoding');
    out.delete('content-length');
    // A redirect is a status like any other: `send` asked for none, and none is followed.
    const nobody = status === 204 || status === 304;
    if (nobody) response.resume();
    return new Response(
      nobody ? null : (Readable.toWeb(decoded) as unknown as ReadableStream<Uint8Array>),
      { status: status < 200 || status > 599 ? 502 : status, headers: out },
    );
  };
  return fetchImpl as FetchLike;
}
