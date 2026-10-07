/**
 * Site icons for the chips in a chat (ADR 0103), from the gateway itself.
 *
 * A third-party favicon service would learn every site the assistant visits,
 * so Conch asks each site for its own icon instead: the gateway has already
 * talked to the site, so nobody new learns anything. It goes through the same
 * public-web reader as `web_fetch` (`createFetcher`): https only, every
 * address checked as it is dialled (never this computer, your network,
 * link-local or cloud metadata, never Conch's own port), every redirect
 * checked again, no cookies.
 *
 * - `https://host/favicon.ico` first, then the icons the home page names
 *   (`<link rel~=icon>`, `apple-touch-icon` and the largest first).
 * - Only raster images, by their declared type *and* their first bytes:
 *   PNG, ICO, JPEG, WebP, GIF, at most 100 KB. No SVG: it's a document that
 *   can carry script, and a monogram is a fine stand-in.
 * - Kept in memory (500 sites, a day; a site with none, an hour), and fresh
 *   lookups are budgeted so a page can't make the gateway crawl the web.
 */
import { createFetcher } from '../conchapps/fetcher';
import type { AppFetcher, AppFetchResponse } from '../conchapps/types';

export interface Icon {
  type: IconType;
  bytes: Buffer;
}

export type IconType = 'image/png' | 'image/x-icon' | 'image/jpeg' | 'image/webp' | 'image/gif';

export interface FaviconDeps {
  /** The public-web reader (`publicWebFetcher`), or a stand-in in tests. */
  fetcher: AppFetcher;
  now?: () => number;
  /** Sites kept (default 500). */
  size?: number;
  /** Fresh lookups an hour (default 120: at most 4 requests each, under the reader's 600). */
  lookupsPerHour?: number;
  /** One lookup, all its requests (default 10 s). */
  lookupMs?: number;
}

/** The first bytes of a page we read for its icons. */
export const PAGE_BYTES = 256 * 1024;
/** The largest icon we keep. */
export const ICON_BYTES = 100 * 1024;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const APP = { id: 'conch-favicons' } as const;
const USER_AGENT = 'Mozilla/5.0 (compatible; Conch site icons)';

/** What a site may say its icon is. SVG is not on the list. */
const DECLARED = new Set([
  'image/png',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/ico',
  'image/icon',
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/webp',
  'image/gif',
]);

/** Names that never belong to a public site. */
const SPECIAL = new Set([
  'localhost',
  'local',
  'internal',
  'arpa',
  'onion',
  'invalid',
  'lan',
  'home',
]);
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * A public host name, lowercased, or undefined: letters, digits and hyphens
 * in dot-separated labels, at most 253 characters, at least two labels. No
 * addresses, no ports, no `localhost` and no special-use names.
 */
export function faviconHost(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 253) return undefined;
  const host = raw.toLowerCase();
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return undefined;
  const top = labels[labels.length - 1] ?? '';
  // An all-number last label is an IPv4 address (or would be read as one).
  if (/^\d+$/.test(top) || /^0x/i.test(top) || SPECIAL.has(top)) return undefined;
  return host;
}

/** What the bytes are, by their signature, or undefined when they aren't a raster image. */
export function sniff(bytes: Buffer): IconType | undefined {
  const at = (offset: number, ...values: number[]) =>
    values.every((value, i) => bytes[offset + i] === value);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (at(4, 0x37, 0x61) || at(4, 0x39, 0x61))) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return undefined;
}

const decode = (value: string) =>
  value
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#x0*2f;/gi, '/')
    .replace(/&amp;/gi, '&')
    .trim();

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = tag.replace(/^<link\b/i, '').replace(/\/?>$/, '');
  for (const m of body.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) {
    const name = m[1]?.toLowerCase();
    if (name && !(name in out)) out[name] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/** The largest edge in a `sizes` attribute ("16x16 32x32" → 32), 0 when it names none. */
function largest(sizes: string | undefined): number {
  let best = 0;
  for (const m of (sizes ?? '').matchAll(/(\d{1,4})\s*x\s*(\d{1,4})/gi))
    best = Math.max(best, Math.min(Number(m[1]), Number(m[2])));
  return best;
}

/**
 * The icons a page names, best first: `apple-touch-icon` (a large square,
 * 180 px unless it says), then the largest. Only https, never SVG.
 */
export function iconLinks(html: string, base: URL): URL[] {
  const ranked: { url: URL; score: number; order: number }[] = [];
  let order = 0;
  for (const m of html.slice(0, PAGE_BYTES).matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(m[0]);
    const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/);
    const apple = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed');
    if (!apple && !rel.includes('icon')) continue;
    if (!attrs.href || (attrs.type ?? '').toLowerCase().includes('svg')) continue;
    let url: URL;
    try {
      url = new URL(attrs.href, base);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || /\.svgz?$/i.test(url.pathname)) continue;
    const size = largest(attrs.sizes) || (apple ? 180 : 0);
    ranked.push({ url, score: (apple ? 10_000 : 0) + size, order: order++ });
  }
  const seen = new Set<string>();
  return ranked
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((r) => r.url)
    .filter((url) => !seen.has(url.href) && !!seen.add(url.href));
}

/** The public-web reader, held shorter: 4 s and the first 256 KB of anything. */
export const faviconFetcher = (gatewayPort: number): AppFetcher =>
  createFetcher({
    gatewayPort,
    publicRedirects: true,
    timeoutMs: 4000,
    maxBytes: PAGE_BYTES,
    cut: true,
  });

interface Entry {
  icon: Icon | undefined;
  until: number;
}

export class Favicons {
  private readonly fetcher: AppFetcher;
  private readonly now: () => number;
  private readonly size: number;
  private readonly perHour: number;
  private readonly lookupMs: number;
  /** In order of use, oldest first. */
  private readonly cache = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<Icon | undefined>>();
  private lookups: number[] = [];

  constructor(deps: FaviconDeps) {
    this.fetcher = deps.fetcher;
    this.now = deps.now ?? Date.now;
    this.size = deps.size ?? 500;
    this.perHour = deps.lookupsPerHour ?? 120;
    this.lookupMs = deps.lookupMs ?? 10_000;
  }

  /**
   * The icon for a host (already checked with `faviconHost`), undefined when
   * it has none we'd show, or `'busy'` when too many sites were looked up
   * in the last hour.
   */
  async get(host: string): Promise<Icon | undefined | 'busy'> {
    const at = this.now();
    const kept = this.cache.get(host);
    if (kept && kept.until > at) {
      this.cache.delete(host);
      this.cache.set(host, kept);
      return kept.icon;
    }
    if (kept) this.cache.delete(host);
    const already = this.pending.get(host);
    if (already) return already;
    this.lookups = this.lookups.filter((t) => at - t < HOUR);
    if (this.lookups.length >= this.perHour) return 'busy';
    this.lookups.push(at);
    const lookup = this.find(host)
      .catch(() => undefined)
      .then((icon) => {
        this.keep(host, { icon, until: this.now() + (icon ? DAY : HOUR) });
        return icon;
      })
      .finally(() => this.pending.delete(host));
    this.pending.set(host, lookup);
    return lookup;
  }

  private keep(host: string, entry: Entry): void {
    this.cache.delete(host);
    this.cache.set(host, entry);
    while (this.cache.size > this.size) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private async find(host: string): Promise<Icon | undefined> {
    const signal = AbortSignal.timeout(this.lookupMs);
    const own = await this.icon(new URL(`https://${host}/favicon.ico`), signal);
    if (own) return own;
    const page = await this.request(new URL(`https://${host}/`), 'text/html', signal);
    if (!page?.ok || page.bodyBase64) return undefined;
    const type = (page.headers['content-type'] ?? '').toLowerCase();
    if (!/^(?:text\/html|application\/xhtml\+xml)\b/.test(type)) return undefined;
    // At most two of the icons it names: four requests a lookup in all.
    for (const href of iconLinks(page.body, new URL(page.url ?? `https://${host}/`)).slice(0, 2)) {
      const icon = await this.icon(href, signal);
      if (icon) return icon;
    }
    return undefined;
  }

  private async icon(url: URL, signal: AbortSignal): Promise<Icon | undefined> {
    const response = await this.request(
      url,
      'image/png,image/x-icon,image/webp,image/gif,image/jpeg;q=0.9,*/*;q=0.1',
      signal,
    );
    if (!response?.ok || !response.bodyBase64) return undefined;
    const declared = (response.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    if (!declared || !DECLARED.has(declared)) return undefined;
    const bytes = Buffer.from(response.body, 'base64');
    if (bytes.length === 0 || bytes.length > ICON_BYTES) return undefined;
    const type = sniff(bytes);
    return type ? { type, bytes } : undefined;
  }

  private async request(
    url: URL,
    accept: string,
    signal: AbortSignal,
  ): Promise<AppFetchResponse | undefined> {
    if (url.protocol !== 'https:' || signal.aborted) return undefined;
    const response = await this.fetcher(
      { ...APP, reaches: [url.hostname] },
      { url: url.href, method: 'GET', headers: { accept, 'user-agent': USER_AGENT } },
      signal,
    );
    return response.refused ? undefined : response;
  }
}
