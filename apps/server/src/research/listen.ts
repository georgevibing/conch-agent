/**
 * `GET /api/listen?chat=…&src=…`: what a music card plays, streamed through
 * Conch (ADR 0060 §7).
 *
 * The page never loads audio from another site (security.ts: `media-src
 * 'self' blob:`), so a reply can't leak anything through an audio address.
 * Instead the page asks Conch for one item a card carries, and Conch fetches
 * it on these terms:
 *
 * - **Only what a card in that chat carries.** `src` must be the `preview` of
 *   an item in an `audio` view that `music_search` put in that same chat's
 *   log. Nothing the model writes can name an address here.
 * - **A song's preview only from Apple.** A 30-second preview must come from
 *   Apple's preview servers (`isPreviewHost`), every redirect included. A
 *   podcast episode lives on its own host, so it may come from any public
 *   https address the episode names — but only that one, from the card.
 * - **Never inward.** The same guard as `web_fetch` and `app.fetch`: every
 *   address a name resolves to is checked as it connects, never this
 *   computer, your network or Conch's own port; https only, five redirects.
 * - **Only audio, and only so much.** Anything that isn't audio is refused;
 *   a preview stops at 8 MB, an episode at 600 MB per request; no answer in
 *   15 seconds, or nothing for 60, ends it; and closing the page stops it.
 * - **Nobody's cookies, nothing of Conch's.** A plain GET with the browser's
 *   `Range` (so scrubbing works), and nothing else of the person's.
 */
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Transform } from 'node:stream';

import { Id, type ConversationEvent } from '@conch/protocol';
import type { FastifyInstance } from 'fastify';

import { guardedLookup, placeOf, systemResolve, type Place, type Resolve } from '../artifacts/live';
import { isPreviewHost } from './music';

export const LISTEN_LIMITS = {
  previewBytes: 8 * 1024 * 1024,
  episodeBytes: 600 * 1024 * 1024,
  /** Until the other site answers. */
  answerMs: 15_000,
  /** With nothing arriving. */
  idleMs: 60_000,
  redirects: 5,
};

/** What a card carries at `src`: a preview, or a whole episode. Nothing when no card does. */
export type Carried = { whole: boolean } | undefined;

export interface ListenDeps {
  /** Whether a music card in this chat carries `src`, and as what. */
  carried: (chat: string, src: string) => Promise<Carried>;
  gatewayPort?: number;
  resolve?: Resolve;
  place?: (address: string) => Place;
  /** Extra certificates to trust, for a test server. */
  ca?: string | Buffer;
  /** Where a song's preview may come from (default: Apple's preview servers). */
  previewHost?: (hostname: string) => boolean;
  limits?: Partial<typeof LISTEN_LIMITS>;
}

/** The music card's tools, under either name a provider calls them. */
const MUSIC_TOOL = /^(?:mcp__conch__)?music_search$/;

/**
 * Whether a chat's log carries `src` in a `music_search` card of its own:
 * the one source of truth for what `/api/listen` may play.
 */
export function carriedIn(
  events: readonly ConversationEvent[],
  chat: string,
  src: string,
): Carried {
  const names = new Map<string, string>();
  for (const e of events) {
    if (e.type === 'tool.started') names.set(e.toolUseId, e.name);
    if (e.type !== 'tool.finished' || e.view?.kind !== 'audio' || e.view.chat !== chat) continue;
    if (!MUSIC_TOOL.test(names.get(e.toolUseId) ?? '')) continue;
    const item = e.view.items.find((i) => i.preview?.url === src);
    if (item?.preview) return { whole: item.preview.whole };
  }
  return undefined;
}

/** The type the browser is told: audio only, from the answer or the file's name. */
export function audioType(contentType: string | undefined, url: URL): string | undefined {
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (/^audio\/[a-z0-9.+-]+$/.test(type))
    return type === 'audio/x-m4a' || type === 'audio/x-m4p' ? 'audio/mp4' : type;
  if (type && !/^(?:application|binary)\/octet-stream$/.test(type) && type !== 'video/mp4')
    return undefined;
  const ext = /\.([a-z0-9]{2,4})$/i.exec(url.pathname)?.[1]?.toLowerCase();
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'm4a' || ext === 'aac' || ext === 'mp4') return 'audio/mp4';
  if (ext === 'ogg' || ext === 'oga' || ext === 'opus') return 'audio/ogg';
  return undefined;
}

type Opened =
  | { ok: true; response: IncomingMessage; type: string; url: URL }
  | { ok: false; status: number; message: string };

/** The audio at `start`, opened through the guard, redirects followed and checked. */
export async function openAudio(
  start: URL,
  options: { whole: boolean; range?: string; signal: AbortSignal },
  deps: Omit<ListenDeps, 'carried'>,
): Promise<Opened> {
  const resolve = deps.resolve ?? systemResolve;
  const place = deps.place ?? placeOf;
  const limits = { ...LISTEN_LIMITS, ...deps.limits };
  const previewHost = deps.previewHost ?? isPreviewHost;
  const refuse = (status: number, message: string): Opened => ({ ok: false, status, message });
  const why = (address: string, target: URL): string | undefined => {
    const where = place(address);
    if (where !== 'public') return `${target.hostname} isn’t on the public web.`;
    if (deps.gatewayPort !== undefined && (Number(target.port) || 443) === deps.gatewayPort)
      return 'Conch doesn’t play from itself.';
    return undefined;
  };
  let url = start;
  for (let hop = 0; hop <= limits.redirects; hop++) {
    if (url.protocol !== 'https:' || url.username || url.password)
      return refuse(403, 'Conch plays only from secure (https) addresses.');
    if (!options.whole && !previewHost(url.hostname))
      return refuse(403, `A song’s preview only comes from Apple, not ${url.hostname}.`);
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(literal)) {
      const no = why(literal, url);
      if (no) return refuse(403, no);
    }
    let refused: string | undefined;
    const target = url;
    const lookup = guardedLookup(
      resolve,
      (address) => why(address, target),
      (reason) => {
        refused = reason;
      },
    );
    let response: IncomingMessage;
    try {
      response = await new Promise<IncomingMessage>((done, failed) => {
        const req = httpsRequest(target, {
          method: 'GET',
          agent: false,
          lookup,
          signal: options.signal,
          headers: {
            accept: 'audio/*;q=1, */*;q=0.1',
            'accept-encoding': 'identity',
            'user-agent': 'Conch',
            ...(options.range && { range: options.range }),
          },
          ...(deps.ca && { ca: deps.ca }),
        });
        const answer = setTimeout(() => req.destroy(new Error('slow')), limits.answerMs);
        req.setTimeout(limits.idleMs, () => req.destroy(new Error('idle')));
        req.on('response', (r) => {
          clearTimeout(answer);
          done(r);
        });
        req.on('error', (error) => {
          clearTimeout(answer);
          failed(error);
        });
        req.end();
      });
    } catch (error) {
      if (refused) return refuse(403, refused);
      if (options.signal.aborted) return refuse(499, 'Stopped.');
      return refuse(
        502,
        error instanceof Error && error.message === 'slow'
          ? `${target.hostname} took too long to answer.`
          : `Couldn’t reach ${target.hostname}.`,
      );
    }
    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    if ([301, 302, 303, 307, 308].includes(status) && location) {
      response.resume();
      try {
        url = new URL(location, target);
      } catch {
        return refuse(502, `${target.hostname} sent it on to an address that isn’t one.`);
      }
      continue;
    }
    if (status === 416) {
      response.resume();
      return refuse(416, 'That part of it isn’t there.');
    }
    if (status !== 200 && status !== 206) {
      response.resume();
      return refuse(502, `${target.hostname} answered ${status}.`);
    }
    const type = audioType(response.headers['content-type'], target);
    if (!type) {
      response.destroy();
      return refuse(502, `${target.hostname} didn’t send audio.`);
    }
    return { ok: true, response, type, url: target };
  }
  return refuse(502, 'It was sent on too many times.');
}

/** Passes bytes on until `max`, then ends the stream: a request never brings back more. */
function capped(max: number, onCap: () => void): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      if (seen > max) {
        onCap();
        this.push(chunk.subarray(0, chunk.length - (seen - max)));
        this.push(null);
        return done();
      }
      done(null, chunk);
    },
  });
}

const RANGE = /^bytes=\d{0,15}-\d{0,15}$/;

export function registerListenRoutes(app: FastifyInstance, deps: ListenDeps): void {
  const limits = { ...LISTEN_LIMITS, ...deps.limits };
  /** Recent answers to "does a card carry this?", so scrubbing doesn't read the log each time. */
  const known = new Map<string, Carried>();
  const carried = async (chat: string, src: string) => {
    const key = `${chat}\u0000${src}`;
    if (known.has(key)) return known.get(key);
    const found = await deps.carried(chat, src);
    if (found) {
      const oldest = known.keys().next();
      if (known.size >= 200 && !oldest.done) known.delete(oldest.value);
      known.set(key, found);
    }
    return found;
  };

  app.get<{ Querystring: { chat?: unknown; src?: unknown } }>(
    '/api/listen',
    async (request, reply) => {
      const chat = Id.safeParse(request.query.chat);
      const src = typeof request.query.src === 'string' ? request.query.src : '';
      let url: URL | undefined;
      try {
        url = src.length <= 2000 ? new URL(src) : undefined;
      } catch {
        url = undefined;
      }
      if (!chat.success || !url || url.protocol !== 'https:')
        return reply
          .code(400)
          .send({ error: 'bad-request', message: 'Say which chat and which of its cards.' });
      const what = await carried(chat.data, src).catch(() => undefined);
      if (!what)
        return reply
          .code(404)
          .send({ error: 'not-found', message: 'No music card in this chat plays that.' });
      const range = typeof request.headers.range === 'string' ? request.headers.range : undefined;
      const stop = new AbortController();
      reply.raw.on('close', () => stop.abort());
      const opened = await openAudio(
        url,
        {
          whole: what.whole,
          range: range && RANGE.test(range) ? range : undefined,
          signal: stop.signal,
        },
        deps,
      );
      if (!opened.ok) {
        if (opened.status === 499) return reply.code(499).send();
        return reply.code(opened.status).send({ error: 'unavailable', message: opened.message });
      }
      const { response } = opened;
      const max = what.whole ? limits.episodeBytes : limits.previewBytes;
      const length = Number(response.headers['content-length']);
      const fits = Number.isFinite(length) && length > 0 && length <= max;
      reply.code(response.statusCode === 206 ? 206 : 200).headers({
        'content-type': opened.type,
        ...(fits && { 'content-length': String(length) }),
        ...(typeof response.headers['content-range'] === 'string' && {
          'content-range': response.headers['content-range'],
        }),
        'accept-ranges': response.headers['accept-ranges'] === 'bytes' ? 'bytes' : 'none',
        'content-security-policy': "sandbox; default-src 'none'",
        'cache-control': 'private, max-age=3600',
      });
      stop.signal.addEventListener('abort', () => response.destroy(), { once: true });
      return reply.send(response.pipe(capped(max, () => response.destroy())));
    },
  );
}
