import { isIP } from 'node:net';
import { domainToUnicode } from 'node:url';

import { getDomain, getPublicSuffix } from 'tldts';

import { skeleton } from '../memory/guard';

/**
 * Which saved item belongs on a page, and which page only pretends to be
 * one of yours (ADR 0130). Pure: names in, names out, never a value.
 *
 * How close a saved site is to the page's host, best first:
 * - `exact`: the same host (`www.` aside);
 * - `within`: the page is under the saved site (`login.example.com` for
 *   `example.com`), the rule ADR 0025 began with;
 * - `related`: another part of the same site, by the Public Suffix List with
 *   its private part (`accounts.google.com` for `mail.google.com`), as Chrome,
 *   1Password and Bitwarden match. `alice.github.io` and `bob.github.io` are
 *   never related, and a saved public suffix (`co.uk`) matches only itself.
 */
export type SiteMatch = 'exact' | 'within' | 'related';

const RANK: Record<SiteMatch, number> = { exact: 0, within: 1, related: 2 };

/** A hostname as it's compared: lowercase, no `www.`, no trailing dot, no brackets. */
export function normalHost(raw: string): string {
  let host = raw.trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch {
      return '';
    }
  }
  return host
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .replace(/^www\./, '');
}

/** An address with no registrable domain: an IP, `localhost`, a one-word name. */
function bare(host: string): boolean {
  return isIP(host) !== 0 || !host.includes('.');
}

/** The registrable domain (eTLD+1, private suffixes included), or undefined for a suffix or a bare name. */
export function registrable(host: string): string | undefined {
  const h = normalHost(host);
  if (!h || bare(h)) return undefined;
  return getDomain(h, { allowPrivateDomains: true }) ?? undefined;
}

/** How a saved site matches the page's host, if it does. */
export function matchSite(saved: string, host: string): SiteMatch | undefined {
  const s = normalHost(saved);
  const h = normalHost(host);
  if (!s || !h) return undefined;
  if (s === h) return 'exact';
  if (bare(s) || bare(h)) return undefined;
  const site = registrable(s);
  // A saved public suffix ("co.uk", "github.io") is nobody's site.
  if (!site) return undefined;
  if (h.endsWith(`.${s}`)) return 'within';
  return registrable(h) === site ? 'related' : undefined;
}

/** The best way any of an item's sites matches the page. */
export function bestMatch(sites: readonly string[], host: string): SiteMatch | undefined {
  let best: SiteMatch | undefined;
  for (const site of sites) {
    const match = matchSite(site, host);
    if (match && (!best || RANK[match] < RANK[best])) best = match;
  }
  return best;
}

/** Items in the order to offer them: the closest match, then the one used last, then by name. */
export function byMatch<T extends { match: SiteMatch; usedAt?: number; title: string }>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      RANK[a.match] - RANK[b.match] ||
      (b.usedAt ?? 0) - (a.usedAt ?? 0) ||
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
  );
}

/** The name part of a registrable domain: `paypal` of `paypal.co.uk`. */
function nameOf(domain: string): string {
  const suffix = getPublicSuffix(domain, { allowPrivateDomains: true }) ?? '';
  return suffix && domain.endsWith(`.${suffix}`) ? domain.slice(0, -(suffix.length + 1)) : domain;
}

/** Letters that pass for others in an address: `paypa1`, `rnicrosoft`, `g00gle`, Cyrillic `а`. */
function looks(name: string): string {
  return skeleton(name.normalize('NFKC'))
    .toLowerCase()
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/cl/g, 'd')
    .replace(/[1i|!]/g, 'l')
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/5/g, 's')
    .replace(/[-_]/g, '');
}

/**
 * One slip of the keyboard apart: a letter left out, added or doubled, or
 * two swapped. Not a letter changed (`notion`/`motion` are both real).
 */
function oneSlip(a: string, b: string): boolean {
  if (a === b) return false;
  if (a.length === b.length) {
    const at = [...a].findIndex((ch, i) => ch !== b[i]);
    return (
      at >= 0 &&
      at < a.length - 1 &&
      a[at] === b[at + 1] &&
      a[at + 1] === b[at] &&
      a.slice(at + 2) === b.slice(at + 2)
    );
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (long.length - short.length !== 1) return false;
  for (let i = 0; i < long.length; i++)
    if (long.slice(0, i) + long.slice(i + 1) === short) return true;
  return false;
}

/**
 * The saved site a page is dressed up as, if it is (ADR 0130 § Look-alikes):
 * a host that isn't that site but carries its name in front
 * (`paypal.com.account-check.io`), wears it in other letters (`paypa1.com`,
 * `xn--pypal-4ve.com`), is one slip away from it (`netfllix.com`), or wraps
 * it in words (`netflix-login.com`). Only names of four letters or more, so
 * short ones don't cry wolf. A related or matching host is never a look-alike.
 */
export function lookalikeOf(host: string, saved: readonly string[]): string | undefined {
  const h = normalHost(host);
  if (!h || bare(h)) return undefined;
  const page = registrable(h) ?? h;
  const pageName = domainToUnicode(nameOf(page)) || nameOf(page);
  for (const site of new Set(saved.map((s) => registrable(s)).filter(Boolean) as string[])) {
    if (site === page) continue;
    const name = nameOf(site);
    if (name.length < 4) continue;
    // Its whole address at the front of another one: paypal.com.evil.io, paypal.com-help.net.
    if (h.startsWith(`${site}.`) || h.startsWith(`${site}-`) || h.includes(`.${site}.`))
      return site;
    if (h.includes(`.${site}-`)) return site;
    // The same name in other letters.
    if (pageName !== name && looks(pageName) === looks(name)) return site;
    // A slip of the keyboard, on a name long enough to have one by accident.
    if (name.length >= 6 && oneSlip(looks(pageName), looks(name))) return site;
    // Wrapped in words: netflix-login, secure-paypal, paypal-support.
    if (pageName !== name && pageName.split(/[-_.]/).includes(name)) return site;
  }
  return undefined;
}
