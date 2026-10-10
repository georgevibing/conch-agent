/**
 * What the site offers besides its pages, for whatever comes looking
 * (`scripts/prerender.mjs` writes them):
 *
 * - `llms.txt` (llmstxt.org): the documentation as a short index an AI
 *   assistant or AI search can read in one go, each page with its line;
 *   `llms-full.txt`, every guide's words in one file.
 * - `releases/feed.xml`: an Atom feed of published releases, so a feed
 *   reader, or a person, can follow new versions of Conch.
 */
import type { PublishedRelease } from '../../publishing/schema';
import type { Page } from './pages';

interface Section {
  id: string;
  title: string;
  about: string;
}

const url = (siteUrl: string, path: string) => `${siteUrl}${path === '/' ? '/' : `${path}/`}`;

/** One line of Markdown: no line breaks a link's text or its description can't take. */
const line = (text: string) => text.replace(/\s+/g, ' ').trim();

export function llmsTxt({
  siteUrl,
  summary,
  sections,
  pages,
}: {
  siteUrl: string;
  /** What Conch is, in a sentence or two. */
  summary: string;
  sections: readonly Section[];
  pages: readonly Page[];
}): string {
  const out = [
    '# Conch',
    '',
    `> ${line(summary)}`,
    '',
    `Conch is open source (${siteUrl}). Every guide below is also in one file: ${siteUrl}/llms-full.txt. Releases: ${siteUrl}/releases/ (feed: ${siteUrl}/releases/feed.xml).`,
  ];
  const listed = (section: string) =>
    pages.filter((p) => p.section === section).sort((a, b) => a.order - b.order);
  for (const section of sections) {
    const its = listed(section.id);
    if (!its.length) continue;
    out.push('', `## ${section.title}`, '', `${line(section.about)}`, '');
    for (const page of its)
      out.push(`- [${line(page.title)}](${url(siteUrl, page.path)}): ${line(page.description)}`);
  }
  // llms.txt's "Optional": what a reader in a hurry can leave out.
  const decisions = listed('decisions');
  if (decisions.length) {
    out.push('', '## Optional', '');
    for (const page of decisions)
      out.push(`- [${line(page.title)}](${url(siteUrl, page.path)}): ${line(page.description)}`);
  }
  return `${out.join('\n')}\n`;
}

/** Every guide's words, in the sections' order: decision records stay in `llms.txt` alone. */
export function llmsFullTxt({
  siteUrl,
  summary,
  sections,
  pages,
}: {
  siteUrl: string;
  summary: string;
  sections: readonly Section[];
  pages: readonly Page[];
}): string {
  const out = ['# Conch', '', `> ${line(summary)}`];
  for (const section of sections)
    for (const page of pages
      .filter((p) => p.section === section.id)
      .sort((a, b) => a.order - b.order))
      out.push(
        '',
        '---',
        '',
        `# ${line(page.title)}`,
        '',
        `Source: ${url(siteUrl, page.path)}`,
        '',
        page.body.trim(),
      );
  return `${out.join('\n')}\n`;
}

const xml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters XML 1.0 can't carry at all.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const CHANNEL: Record<PublishedRelease['channel'], string> = {
  stable: 'Stable',
  beta: 'Beta',
  alpha: 'Alpha',
};

/** An Atom feed of published releases, newest first. Drafts never reach `releases`. */
export function releasesFeed({
  siteUrl,
  repository,
  releases,
}: {
  siteUrl: string;
  /** `https://github.com/owner/name` */
  repository: string;
  releases: readonly PublishedRelease[];
}): string {
  const newest = [...releases].sort((a, b) => b.published.localeCompare(a.published));
  const self = `${siteUrl}/releases/feed.xml`;
  const page = `${siteUrl}/releases/`;
  const out = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    '  <title>Conch releases</title>',
    '  <subtitle>Every published release of Conch, from early alphas to stable versions.</subtitle>',
    `  <id>${xml(page)}</id>`,
    `  <link rel="self" type="application/atom+xml" href="${xml(self)}"/>`,
    `  <link rel="alternate" type="text/html" href="${xml(page)}"/>`,
    // A feed with nothing in it yet still says when, as Atom asks.
    `  <updated>${newest[0]?.published ?? '1970-01-01T00:00:00Z'}</updated>`,
    '  <author><name>Conch</name></author>',
    `  <icon>${xml(`${siteUrl}/apple-touch-icon.png`)}</icon>`,
  ];
  for (const release of newest) {
    const link = `${repository}/releases/tag/${encodeURIComponent(release.tag)}`;
    out.push(
      '  <entry>',
      `    <title>${xml(`Conch ${release.version}${release.channel === 'stable' ? '' : ` (${CHANNEL[release.channel].toLowerCase()})`}`)}</title>`,
      `    <id>${xml(link)}</id>`,
      `    <link rel="alternate" type="text/html" href="${xml(link)}"/>`,
      `    <updated>${release.published}</updated>`,
      `    <published>${release.published}</published>`,
      `    <category term="${release.channel}" label="${CHANNEL[release.channel]}"/>`,
      `    <content type="text">${xml(release.notes.trim() || `Conch ${release.version}.`)}</content>`,
      '  </entry>',
    );
  }
  out.push('</feed>', '');
  return out.join('\n');
}
