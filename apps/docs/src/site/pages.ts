/**
 * Every page of the documentation, worked out from the files:
 *
 * - a Markdown file in `content/<section>/` is a page in that section;
 * - one that names a `source` shows that file from the repository instead
 *   (`docs/SECURITY.md` stays where the code and the CLI point to it);
 * - one that names a `provider` or a `channel` takes its title and facts from
 *   the code, and a provider or channel nobody has written about yet still
 *   gets its page;
 * - every decision record in `docs/adr/` is a page.
 *
 * So adding a page is adding a file, and nothing is listed twice.
 */
import reference from 'virtual:conch-reference';

import { REPO_BRANCH, REPO_URL, SECTIONS } from './config';
import { embedHeadings } from '../embeds/words';
import { articleHead, type Head } from './head';
import {
  firstParagraph,
  frontMatter,
  headings,
  plain,
  segments,
  splitTitle,
  type Heading,
} from './text';

export interface Page {
  /** Its address: `/start/install`. */
  path: string;
  /** The section it's listed under, or `decisions` for a decision record. */
  section: string;
  title: string;
  /** A shorter name for the sidebar, when the title is long. */
  nav: string;
  description: string;
  order: number;
  /** The Markdown, without front matter or its top heading. */
  body: string;
  headings: Heading[];
  /** The file the words live in, from the top of the repository. */
  file: string;
  /** Shown in the sidebar. */
  listed: boolean;
  /** The provider or channel this page is about, as the code names it. */
  provider?: string;
  channel?: string;
}

const CONTENT = 'apps/docs/content/';

/**
 * `content/legal/<name>.md` is a page at `/<name>` (`/privacy`): not in the
 * sidebar, linked from the footers instead.
 */
export const LEGAL = 'legal';

const authored = import.meta.glob<string>('../../content/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const repository = import.meta.glob<string>(
  ['../../../../docs/**/*.md', '../../../../ARCHITECTURE.md'],
  { query: '?raw', import: 'default', eager: true },
);

/** Every Markdown file a page can be made of, by its path from the top of the repository. */
const FILES = new Map<string, string>([
  ...Object.entries(authored).map(
    ([key, raw]) => [key.replace('../../content/', CONTENT), raw] as const,
  ),
  ...Object.entries(repository).map(
    ([key, raw]) => [key.replace('../../../../', ''), raw] as const,
  ),
]);

/** Where a provider or channel comes in the code's own list. */
function place(meta: { provider?: string; channel?: string }): number {
  const at = meta.provider
    ? reference.providers.findIndex((p) => p.id === meta.provider)
    : reference.channels.findIndex((c) => c.id === meta.channel);
  return Math.max(0, at);
}

/** A page's headings in order: its own, and those its generated parts add. */
function pageHeadings(body: string): Heading[] {
  return segments(body).flatMap((part) =>
    part.kind === 'text' ? headings(part.text, part.seen) : embedHeadings(part.name),
  );
}

function build(): { pages: Page[]; byFile: Map<string, Page> } {
  const pages: Page[] = [];
  const byFile = new Map<string, Page>();
  const sections = new Set(SECTIONS.map((section) => section.id));

  for (const [file, raw] of FILES) {
    if (!file.startsWith(CONTENT)) continue;
    const [section = '', name = ''] = file.slice(CONTENT.length).split('/');
    const legal = section === LEGAL;
    if ((!sections.has(section) && !legal) || !name.endsWith('.md')) continue;
    const slug = name.replace(/\.md$/, '');
    const { meta, body: own } = frontMatter(raw);

    const source = meta.source ? FILES.get(meta.source) : undefined;
    const { title: heading, rest } = splitTitle(source ?? own);
    const provider = reference.providers.find((p) => p.id === meta.provider);
    const channel = reference.channels.find((c) => c.id === meta.channel);
    const title = meta.title ?? provider?.name ?? channel?.name ?? heading ?? slug;
    const body = rest.trim();

    const page: Page = {
      path: legal ? `/${slug}` : slug === 'index' ? `/${section}` : `/${section}/${slug}`,
      section,
      title,
      nav: meta.nav ?? title,
      description:
        meta.description ?? provider?.tagline ?? channel?.tagline ?? firstParagraph(body),
      // A provider or channel keeps the place the code gives it, unless the page says otherwise;
      // `after: lm-studio` puts a page straight after that provider's.
      order: meta.after
        ? 100.5 + place({ provider: meta.after })
        : Number(meta.order ?? (provider || channel ? 100 + place(meta) : 100)),
      body,
      headings: pageHeadings(body),
      file: meta.source ?? file,
      listed: !legal,
      ...(provider && { provider: provider.id }),
      ...(channel && { channel: channel.id }),
    };
    pages.push(page);
    byFile.set(file, page);
    if (meta.source) byFile.set(meta.source, page);
  }

  // A provider or channel in the code always has its page, written about or not.
  const about = (key: 'provider' | 'channel') => new Set(pages.map((page) => page[key]));
  const described = { provider: about('provider'), channel: about('channel') };
  const generated = [
    ...reference.providers.map((p) => ({ ...p, key: 'provider' as const, section: 'providers' })),
    ...reference.channels
      .filter((c) => c.available)
      .map((c) => ({ ...c, key: 'channel' as const, section: 'channels' })),
  ];
  for (const thing of generated) {
    if (described[thing.key].has(thing.id)) continue;
    pages.push({
      path: `/${thing.section}/${thing.id}`,
      section: thing.section,
      title: thing.name,
      nav: thing.name,
      description: thing.tagline,
      order: 100 + place(thing.key === 'provider' ? { provider: thing.id } : { channel: thing.id }),
      body: '',
      headings: [],
      file: `${CONTENT}${thing.section}/${thing.id}.md`,
      listed: true,
      [thing.key]: thing.id,
    });
  }

  for (const [file, raw] of FILES) {
    const name = /^docs\/adr\/(\d{4}-[a-z0-9-]+)\.md$/.exec(file)?.[1];
    if (!name) continue;
    const { title, rest } = splitTitle(raw.replaceAll('\r\n', '\n'));
    const status = /^- Status: *(.+)$/m.exec(rest)?.[1];
    const date = /^- Date: *(.+)$/m.exec(rest)?.[1];
    const page: Page = {
      path: `/decisions/${name}`,
      section: 'decisions',
      title: title ?? name,
      nav: title ?? name,
      description: [status && `Status: ${status}`, date].filter(Boolean).join(' · '),
      order: Number(name.slice(0, 4)),
      body: rest.trim(),
      headings: pageHeadings(rest),
      file,
      listed: false,
    };
    pages.push(page);
    byFile.set(file, page);
  }

  const rank = new Map<string, number>([
    ...SECTIONS.map((section, i) => [section.id, i] as const),
    ['decisions', SECTIONS.length],
  ]);
  pages.sort(
    (a, b) =>
      (rank.get(a.section) ?? 0) - (rank.get(b.section) ?? 0) ||
      a.order - b.order ||
      a.title.localeCompare(b.title),
  );
  return { pages, byFile };
}

const built = build();

/** Every page, in reading order. */
export const PAGES: readonly Page[] = built.pages;

const BY_PATH = new Map(PAGES.map((page) => [page.path, page]));

export function pageAt(path: string): Page | undefined {
  return BY_PATH.get(path.length > 1 ? path.replace(/\/+$/, '') : path);
}

export function pagesIn(section: string): Page[] {
  return PAGES.filter((page) => page.section === section);
}

/** What search engines and link previews are told about a page. */
export function headOf(page: Page): Head {
  // A decision record's own line is its status; what it decided starts its first paragraph.
  const description =
    page.section === 'decisions' ? firstParagraph(page.body) || page.description : page.description;
  return articleHead({ ...page, description: plain(description) });
}

/** The decision records, oldest first. */
export const DECISIONS: readonly Page[] = pagesIn('decisions');

/** The pages before and after this one, as someone reading straight through meets them. */
export function neighbours(page: Page): { previous?: Page; next?: Page } {
  const list = page.listed ? PAGES.filter((p) => p.listed) : pagesIn(page.section);
  const at = list.indexOf(page);
  return { previous: list[at - 1], next: list[at + 1] };
}

/** A file in the repository, on the web. */
export function fileUrl(file: string): string {
  const kind = /\.[a-z0-9]+$/i.test(file) ? 'blob' : 'tree';
  return `${REPO_URL}/${kind}/${REPO_BRANCH}/${file}`;
}

/** Folders above a file, with `..` and `.` worked out. */
function join(from: string, relative: string): string {
  const parts = from.split('/').slice(0, -1);
  for (const part of relative.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

export type ResolvedLink =
  | { kind: 'page'; to: string; page?: Page }
  | { kind: 'anchor'; to: string }
  | { kind: 'external'; href: string; file?: string };

/**
 * Where a link written in a Markdown file leads. Links are written the way
 * GitHub reads them (relative to the file), so a guide reads the same there
 * and here: one to another page's file opens that page, one to any other file
 * in the repository opens it on GitHub.
 */
export function resolveLink(fromFile: string, href: string): ResolvedLink {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return { kind: 'external', href };
  if (href.startsWith('#')) return { kind: 'anchor', to: href };
  const [target = '', hash] = href.split('#');
  const suffix = hash ? `#${hash}` : '';
  if (target.startsWith('/'))
    return { kind: 'page', to: `${target}${suffix}`, page: pageAt(target) };
  const file = join(fromFile, target);
  const page = built.byFile.get(file);
  if (page) return { kind: 'page', to: `${page.path}${suffix}`, page };
  return { kind: 'external', href: `${fileUrl(file)}${suffix}`, file };
}

/** Whether a path from the top of the repository is a Markdown file the site knows. */
export function knownFile(file: string): boolean {
  return FILES.has(file);
}
