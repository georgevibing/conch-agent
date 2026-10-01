/** Small, pure helpers for reading Markdown as text: front matter, headings, anchors. */

/** A heading's anchor, the way GitHub makes one, so links written for GitHub land here too. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/**
 * Anchors for one page: the second "Setup" becomes `setup-1`, as on GitHub.
 * `seen` carries on from headings counted earlier on the page.
 */
export function createSlugger(seen = new Map<string, number>()): (text: string) => string {
  return (text) => {
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  };
}

export interface FrontMatter {
  meta: Record<string, string>;
  body: string;
}

/** `key: value` lines between two `---` at the top of a file. */
export function frontMatter(source: string): FrontMatter {
  // Some editors start a file with a byte-order mark; it isn't part of the words.
  const start = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const text = source.slice(start).replaceAll('\r\n', '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const at = line.indexOf(':');
    if (at < 1) continue;
    meta[line.slice(0, at).trim()] = line
      .slice(at + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  }
  return { meta, body: text.slice(match[0].length) };
}

/** Markdown's marks taken off, for titles, the table of contents and search. */
export function plain(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/[*_`~]/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A page's top heading and the rest of it. */
export function splitTitle(body: string): { title?: string; rest: string } {
  const match = /^\s*# +(.+?)\s*\n/.exec(body);
  if (!match) return { rest: body };
  return { title: plain(match[1] ?? ''), rest: body.slice(match[0].length) };
}

export interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

/** Lines outside fenced code. */
function proseLines(body: string): string[] {
  const lines: string[] = [];
  let fence: string | undefined;
  for (const line of body.split('\n')) {
    const mark = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (mark) {
      if (!fence) fence = mark[0];
      else if (mark[0] === fence) fence = undefined;
      continue;
    }
    if (!fence) lines.push(line);
  }
  return lines;
}

/**
 * The second- and third-level headings of some Markdown, with the anchors the
 * page gives them. `seen` carries on from headings earlier on the page.
 */
export function headings(body: string, seen: [string, number][] = []): Heading[] {
  const slug = createSlugger(new Map(seen));
  const found: Heading[] = [];
  for (const line of proseLines(body)) {
    const match = /^(#{1,6}) +(.+?)\s*#*$/.exec(line);
    if (!match) continue;
    const text = plain(match[2] ?? '');
    // Every heading takes an anchor, so the numbering matches the page; only two levels are listed.
    const id = slug(text);
    const level = (match[1] ?? '').length;
    if (level === 2 || level === 3) found.push({ id, text, level });
  }
  return found;
}

/** The first paragraph of a page, for a description nobody wrote. */
export function firstParagraph(body: string): string {
  for (const block of proseLines(body)
    .join('\n')
    .split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text || /^(#|[-*] |\d+\. |>|\||<!--)/.test(text)) continue;
    return plain(text);
  }
  return '';
}

/** Every link in a page: where it points, as written. */
export function links(body: string): string[] {
  const found: string[] = [];
  const text = proseLines(body)
    .join('\n')
    .replace(/`[^`\n]*`/g, '');
  for (const match of text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g))
    if (match[1]) found.push(match[1]);
  return found;
}

/** Every generated part a page asks for: a `<!-- conch:name args -->` on a line of its own. */
export function embeds(body: string): { name: string; args: string[] }[] {
  return segments(body).flatMap((part) =>
    part.kind === 'embed' ? [{ name: part.name, args: part.args }] : [],
  );
}

export const EMBED = /<!--\s*conch:([a-z][a-z0-9-]*)((?:\s+[^\s>-][^\s]*)*)\s*-->/g;

export function parseEmbed(comment: string): { name: string; args: string[] } {
  const match = new RegExp(EMBED.source).exec(comment);
  return {
    name: match?.[1] ?? '',
    args: (match?.[2] ?? '').trim().split(/\s+/).filter(Boolean),
  };
}

/** A line that is nothing but one generated part. */
const EMBED_LINE = new RegExp(`^\\s*${EMBED.source}\\s*$`);

export type Segment =
  | {
      kind: 'text';
      text: string;
      /** Anchors already taken by the headings above this part of the page. */
      seen: [string, number][];
    }
  | { kind: 'embed'; name: string; args: string[] };

/**
 * A page as its parts, in order: stretches of Markdown, and the generated
 * parts between them (a line that is only `<!-- conch:name args -->`).
 */
export function segments(body: string): Segment[] {
  const parts: Segment[] = [];
  const seen = new Map<string, number>();
  const slug = createSlugger(seen);
  let text: string[] = [];
  let from: [string, number][] = [];
  let fence: string | undefined;

  const flush = () => {
    if (text.join('').trim()) parts.push({ kind: 'text', text: text.join('\n'), seen: from });
    text = [];
    from = [...seen];
  };

  for (const line of body.replaceAll('\r\n', '\n').split('\n')) {
    const mark = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (mark) {
      if (!fence) fence = mark[0];
      else if (mark[0] === fence) fence = undefined;
    }
    if (!fence && EMBED_LINE.test(line)) {
      flush();
      parts.push({ kind: 'embed', ...parseEmbed(line) });
      continue;
    }
    if (!fence && !mark) {
      const heading = /^#{1,6} +(.+?)\s*#*$/.exec(line);
      if (heading) slug(plain(heading[1] ?? ''));
    }
    text.push(line);
  }
  flush();
  return parts;
}
