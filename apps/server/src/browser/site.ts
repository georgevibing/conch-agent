import { isIP } from 'node:net';

import { getDomain } from 'tldts';

/**
 * The "site" a browser permission is granted to: the registrable domain
 * (eTLD+1) by the Public Suffix List, private suffixes included, so
 * `alice.github.io` and `bob.github.io` are different sites while
 * `www.booking.com` and `secure.booking.com` are one. Addresses without a
 * domain (an IP, `localhost`) are their own site.
 */
export function siteOf(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return undefined;
  if (isIP(host) || !host.includes('.')) return host;
  return getDomain(host, { allowPrivateDomains: true }) ?? host;
}

/** What people call a page's address in a sentence: its host without `www.`. */
export function displayHost(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return raw;
  }
}
