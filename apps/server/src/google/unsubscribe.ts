/**
 * Leaving a mailing list the way the list itself offers (RFC 2369, RFC 8058):
 * only from the email's own `List-Unsubscribe` header, never a link in its
 * body, which anyone can write. A one-click address (`List-Unsubscribe-Post`)
 * gets one fixed POST over https to the public internet, no redirects; a
 * `mailto:` is an email Gmail sends; a plain web page is only named, for the
 * person or the browser to open.
 */
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

import { z } from 'zod';

import { guardedLookup, placeOf, systemResolve, type Resolve } from '../artifacts/live';

export type Unsubscribe =
  | { kind: 'post'; url: string }
  | { kind: 'mail'; to: string; subject: string; body: string }
  | { kind: 'page'; url: string }
  | { kind: 'none' };

/** The addresses in a `List-Unsubscribe` header: each in angle brackets, a few at most. */
function entries(header: string): string[] {
  return [...header.matchAll(/<([^<>\s]{1,2000})>/g)].slice(0, 4).map((m) => m[1] as string);
}

/** The one way to leave this list, best first: one click, then an email, then its page. */
export function unsubscribeWay(
  listUnsubscribe?: string,
  listUnsubscribePost?: string,
): Unsubscribe {
  const found = entries(listUnsubscribe ?? '');
  const https = found.find((u) => /^https:\/\//i.test(u));
  const oneClick = /^\s*List-Unsubscribe=One-Click\s*$/i.test(listUnsubscribePost ?? '');
  if (https && oneClick && publicHttps(https)) return { kind: 'post', url: https };
  for (const entry of found) {
    if (!/^mailto:/i.test(entry)) continue;
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      continue;
    }
    const to = decodeURIComponent(url.pathname);
    if (!z.email().max(254).safeParse(to).success) continue;
    const words = (key: string, fallback: string) =>
      (url.searchParams.get(key) ?? fallback).replace(/[\r\n]+/g, ' ').slice(0, 500);
    return {
      kind: 'mail',
      to,
      subject: words('subject', 'unsubscribe'),
      body: words('body', 'unsubscribe'),
    };
  }
  if (https && publicHttps(https)) return { kind: 'page', url: https };
  return { kind: 'none' };
}

/** https, no sign-in in it, and not an address on this computer or its network. */
function publicHttps(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  return !isIP(literal) || placeOf(literal) === 'public';
}

/** Sends the one-click POST and gives the status it got back. */
export type OneClick = (url: string, signal: AbortSignal) => Promise<number>;

/**
 * RFC 8058's request, exactly: POST `List-Unsubscribe=One-Click`, nothing of
 * the person's, no cookies, no redirect followed. Every address the name
 * resolves to is checked as it connects, so it can't be pointed inwards.
 */
export function oneClick(resolve: Resolve = systemResolve): OneClick {
  return (raw, signal) => {
    const url = new URL(raw);
    if (!publicHttps(raw))
      return Promise.reject(new Error(`${url.hostname} isn’t a public https address.`));
    const body = 'List-Unsubscribe=One-Click';
    let refused: string | undefined;
    const lookup = guardedLookup(
      resolve,
      (address) =>
        placeOf(address) === 'public' ? undefined : `${url.hostname} isn’t on the public internet.`,
      (why) => {
        refused = why;
      },
    );
    return new Promise<number>((done, failed) => {
      const req = httpsRequest(url, {
        method: 'POST',
        agent: false,
        lookup,
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': String(body.length),
          'user-agent': 'Conch',
        },
      });
      req.on('response', (response) => {
        response.resume();
        done(response.statusCode ?? 0);
      });
      req.on('error', (error) => failed(refused ? new Error(refused) : error));
      req.end(body);
    });
  };
}
