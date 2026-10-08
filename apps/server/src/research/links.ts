/**
 * Previews of the pages being shared: each page as it describes itself (its
 * Open Graph and Twitter card tags, its JSON-LD), with its picture kept as
 * the chat's attachment. Opening the pages is the only thing that leaves the
 * computer, the same way `web_fetch` would.
 */
import type { LinkPreview, LinkPreviewKind } from '@conch/protocol';

import { findLd, httpsUrl, ldTypes, ldImage, pageData, plain, type PageData } from './pageData';
import { capturePictures } from './pictures';
import { getOutside, rec, strOf, type OutsideDeps } from './outside';

/** Pages read at once. */
const PARALLEL = 4;

/** A shareable https address with no sign-in in it and no fragment, or nothing. */
export function previewUrl(raw: string): string | undefined {
  const href = httpsUrl(raw);
  if (!href) return undefined;
  const url = new URL(href);
  url.hash = '';
  return url.href;
}

const host = (url: string) => new URL(url).hostname.replace(/^www\./, '');

/** What kind of page it is, from what it says and where it lives. */
export function linkKind(url: string, data: PageData): LinkPreviewKind {
  const { hostname, pathname } = new URL(url);
  const types = data.ld.flatMap(ldTypes);
  const og = (data.meta['og:type'] ?? '').toLowerCase();
  if (
    /^(?:www\.)?(?:github\.com|gitlab\.com|codeberg\.org)$/i.test(hostname) &&
    /^\/[^/]+\/[^/]+\/?$/.test(pathname)
  )
    return 'repo';
  if (og.startsWith('video') || types.includes('videoobject')) return 'video';
  if (og === 'product' || og.startsWith('product') || types.includes('product')) return 'product';
  if (
    og === 'article' ||
    types.some((t) => ['article', 'newsarticle', 'blogposting', 'reportagenewsarticle'].includes(t))
  )
    return 'article';
  return 'other';
}

/** A JSON-LD author (a name, a Person, a list of them) as one line. */
function authorOf(value: unknown): string | undefined {
  const list = Array.isArray(value) ? value : [value];
  const names = list
    .slice(0, 3)
    .flatMap((a) => (typeof a === 'string' ? a : (strOf(rec(a).name) ?? [])))
    .filter((name) => !/^https?:/i.test(name));
  return plain(names.join(', '), 160);
}

/** A date the page says it was published, as an ISO-ish string the protocol keeps. */
function publishedOf(value: unknown): string | undefined {
  const text = strOf(value);
  return text && text.length >= 4 && text.length <= 40 && !Number.isNaN(Date.parse(text))
    ? text
    : undefined;
}

/** A page's preview from its HTML, and the picture it names (not fetched yet). */
export function previewOf(url: string, html: string): { preview: LinkPreview; picture?: string } {
  const data = pageData(html);
  const meta = data.meta;
  const article = findLd(
    data,
    'article',
    'newsarticle',
    'blogposting',
    'reportagenewsarticle',
    'videoobject',
    'product',
    'webpage',
  );
  const title =
    plain(meta['og:title'], 300) ??
    plain(meta['twitter:title'], 300) ??
    plain(article?.headline ?? article?.name, 300) ??
    data.title ??
    host(url);
  const description =
    plain(meta['og:description'], 600) ??
    plain(meta['twitter:description'], 600) ??
    plain(meta.description, 600) ??
    plain(article?.description, 600);
  const site = plain(meta['og:site_name'], 120) ?? host(url);
  // An empty address would resolve to the page itself.
  const resolved = (raw: string | undefined) => (raw?.trim() ? httpsUrl(raw, url) : undefined);
  const picture =
    resolved(meta['og:image:secure_url']) ??
    resolved(meta['og:image']) ??
    resolved(meta['twitter:image'] ?? meta['twitter:image:src']) ??
    ldImage(article?.image ?? article?.thumbnailUrl, url);
  const published =
    publishedOf(meta['article:published_time']) ??
    publishedOf(article?.datePublished ?? article?.uploadDate);
  const author =
    authorOf(article?.author) ??
    (meta['article:author'] && !/^https?:/i.test(meta['article:author'])
      ? plain(meta['article:author'], 160)
      : undefined);
  return {
    preview: {
      url,
      title,
      site,
      ...(description && { description }),
      ...(published && { published }),
      ...(author && { author }),
      kind: linkKind(url, data),
    },
    ...(picture && { picture }),
  };
}

export interface LinksFound {
  items: LinkPreview[];
  /** Links that couldn't be previewed, and why, for the model. */
  failed: { url: string; reason: string }[];
}

/** Previews for up to eight links; a page that can't be read is left out and said why. */
export async function previewLinks(
  deps: OutsideDeps,
  conversationId: string,
  urls: readonly string[],
  signal: AbortSignal,
): Promise<LinksFound> {
  const asked = [...new Set(urls)].slice(0, 8);
  const results: ({ preview: LinkPreview; picture?: string } | { failed: string })[] = new Array(
    asked.length,
  );
  let next = 0;
  const worker = async () => {
    while (next < asked.length && !signal.aborted) {
      const i = next++;
      const url = previewUrl(asked[i] ?? '');
      if (!url) {
        results[i] = { failed: 'Only secure (https) web addresses without a sign-in.' };
        continue;
      }
      const response = await getOutside(
        deps,
        `web-${conversationId}`,
        url,
        signal,
        'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      );
      const type = response.headers['content-type'] ?? '';
      if (response.refused) results[i] = { failed: response.refused };
      else if (!response.ok) results[i] = { failed: `The site returned ${response.status}.` };
      else if (response.bodyBase64 || (type && !/html|xml/i.test(type)))
        results[i] = { failed: 'Not a web page (a download or a file).' };
      else results[i] = previewOf(previewUrl(response.url ?? url) ?? url, response.body);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, asked.length) }, worker));
  signal.throwIfAborted();
  const kept = results.flatMap((r) => ('preview' in r ? [r] : []));
  const pictures = await capturePictures(
    deps,
    conversationId,
    kept.map((r) => r.picture),
    signal,
    kept.map((r) => r.preview.title),
  );
  return {
    items: kept.map((r, i) => ({
      ...r.preview,
      ...(pictures[i] && { picture: pictures[i] }),
    })),
    failed: results.flatMap((r, i) =>
      'failed' in r ? [{ url: asked[i] ?? '', reason: r.failed }] : [],
    ),
  };
}
