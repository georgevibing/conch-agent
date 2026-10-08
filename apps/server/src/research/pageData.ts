/**
 * What a public page says about itself, read without running it: its
 * schema.org JSON-LD blocks (a Product, a Recipe, a MusicRecording…) and its
 * Open Graph / Twitter card tags. Rich chat views (products, recipes, media,
 * link previews) are built from these.
 *
 * Everything here came from outside: it's data, never instructions, and every
 * string a view keeps is plain text the chat draws as text.
 */

/** A schema.org node, as parsed from JSON-LD. Untyped: callers read what they need. */
export type LdNode = Record<string, unknown>;

export interface PageData {
  /** Every JSON-LD node on the page, `@graph`s and arrays flattened. */
  ld: LdNode[];
  /** `og:*`, `twitter:*`, `product:*` and a few plain `<meta>` tags, by property name (lower case). */
  meta: Record<string, string>;
  /** The page's `<title>`. */
  title?: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** HTML entities in an attribute or a title, decoded. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Whitespace folded and tags taken out: a string safe to show as one line of text. */
export function plain(value: unknown, max = 300): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = decodeEntities(String(value).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, max) : undefined;
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-z_:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    out[m[1]!.toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  }
  return out;
}

function flatten(value: unknown, into: LdNode[], depth = 0): void {
  if (depth > 6 || into.length > 200) return;
  if (Array.isArray(value)) {
    for (const v of value) flatten(v, into, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const node = value as LdNode;
  if (Array.isArray(node['@graph'])) flatten(node['@graph'], into, depth + 1);
  if (node['@type']) into.push(node);
}

/** Reads a page's JSON-LD and card tags. Malformed blocks are skipped, never thrown. */
export function pageData(html: string): PageData {
  const source = html.slice(0, 3_000_000);
  const ld: LdNode[] = [];
  for (const m of source.matchAll(
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      flatten(JSON.parse(m[1]!.trim().replace(/^<!--|-->$/g, '')), ld);
    } catch {
      // A site's broken JSON-LD is its own business.
    }
  }
  const meta: Record<string, string> = {};
  for (const m of source.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    const key = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase();
    if (!key || a.content === undefined) continue;
    if (/^(og|twitter|product|music|video|article|book):/.test(key) || key === 'description') {
      meta[key] ??= a.content.slice(0, 2000);
    }
  }
  const title = plain(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1]);
  return { ld, meta, ...(title && { title }) };
}

/** The `@type`s of a node, lower case, without a schema.org prefix. */
export function ldTypes(node: LdNode): string[] {
  const raw = node['@type'];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.replace(/^https?:\/\/schema\.org\//i, '').toLowerCase());
}

/** The first node of one of these types (lower case: `product`, `recipe`). */
export function findLd(data: PageData, ...types: string[]): LdNode | undefined {
  return data.ld.find((node) => ldTypes(node).some((t) => types.includes(t)));
}

/**
 * An image address from a schema.org `image` (a string, an ImageObject, or a
 * list of either), resolved against the page. Only `https:` survives.
 */
export function ldImage(value: unknown, base: string): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const raw =
    typeof first === 'string'
      ? first
      : first && typeof first === 'object'
        ? ((first as LdNode).url ?? (first as LdNode).contentUrl)
        : undefined;
  return typeof raw === 'string' ? httpsUrl(raw, base) : undefined;
}

/** An absolute `https:` address with no sign-in in it, or nothing. */
export function httpsUrl(raw: string, base?: string): string | undefined {
  try {
    const url = new URL(raw.trim(), base);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** An ISO 8601 duration (`PT1H20M`) in seconds, or nothing. */
export function isoDuration(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(value.trim());
  if (!m || !m.slice(1).some(Boolean)) return undefined;
  const [d, h, min, s] = m.slice(1).map((v) => Number(v ?? 0));
  return Math.round(d! * 86400 + h! * 3600 + min! * 60 + s!);
}
