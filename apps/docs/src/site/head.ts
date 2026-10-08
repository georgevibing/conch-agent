/**
 * What a page tells search engines and link previews about itself: its title,
 * one sentence, its one true address, and what kind of thing it is.
 *
 * The same description is written into each page's HTML when the site is
 * built (`src/prerender.tsx`), and kept true in the browser as people move
 * between pages (`useHead`).
 */
import { useEffect } from 'react';
import publication from 'virtual:conch-publication';

import { AUTHOR, DEVELOPMENT, DOWNLOADS, REPO_URL, SITE_URL } from './config';

export interface Head {
  title: string;
  description: string;
  /** Its address on the site: `/start/install`. */
  path: string;
  type?: 'website' | 'article';
  /** Kept out of search (the page for an address with nothing behind it). */
  noindex?: boolean;
  /** schema.org facts about the page, as JSON-LD. */
  data?: readonly object[];
}

export const SITE_NAME = 'Conch';

/** The picture a link to the site shows (`scripts/social.mjs`). */
export const SOCIAL_IMAGE = {
  path: '/social.png',
  width: 1200,
  height: 630,
  alt: 'Conch: the AI agent that just works. Let it solve your problems.',
} as const;

/** A page's full address. */
export const absolute = (path: string): string =>
  `${SITE_URL}${DEVELOPMENT ? '/docs/next' : ''}${path === '/' || /\.[a-z0-9]+$/i.test(path) ? path : `${path.replace(/\/$/, '')}/`}`;

/** One sentence, short enough for a search result: whole words, then an ellipsis. */
export function sentence(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:.·-]+$/, '')}…`;
}

const PERSON = { '@type': 'Person', name: AUTHOR.name, url: AUTHOR.url } as const;

const SITE = {
  '@type': 'WebSite',
  '@id': `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: absolute('/'),
  inLanguage: 'en',
} as const;

const DESCRIPTION =
  'Conch is an open-source AI agent that sets itself up and fixes what breaks. Use the AI subscriptions and API keys you already have, on your own computer.';

export const LANDING_HEAD: Head = {
  title: 'Conch · the AI agent that just works',
  description: DESCRIPTION,
  path: '/',
  data: [
    SITE,
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE_URL}/#app`,
      name: SITE_NAME,
      description: DESCRIPTION,
      url: absolute('/'),
      image: absolute(SOCIAL_IMAGE.path),
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'macOS, Windows, Linux',
      softwareVersion: publication.tag?.slice(1) ?? `development-${publication.commit.slice(0, 8)}`,
      downloadUrl: DOWNLOADS,
      license: 'https://opensource.org/licenses/MIT',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      author: PERSON,
      sameAs: [REPO_URL],
    },
  ],
};

export const DOCS_HEAD: Head = {
  title: 'Conch documentation',
  description:
    'How to install Conch, connect the assistants and models you use, talk to it from your phone, and everything it does on your own computer.',
  path: '/docs',
  data: [
    SITE,
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: SITE_NAME, item: absolute('/') },
        { '@type': 'ListItem', position: 2, name: 'Documentation', item: absolute('/docs') },
      ],
    },
  ],
};

export const RELEASES_HEAD: Head = {
  title: 'Conch release notes',
  description:
    'What changed in Conch: published stable, beta and alpha releases, with their notes and source versions.',
  path: '/releases',
};

export const NOT_FOUND_HEAD: Head = {
  title: 'Not here · Conch',
  description: 'There’s no page at this address. Search finds every page by name.',
  path: '/404',
  noindex: true,
};

/** A guide or a decision record: an article, under the documentation. */
export function articleHead(page: {
  path: string;
  title: string;
  description: string;
  section: string;
}): Head {
  const description = sentence(page.description || `${page.title}, in Conch’s documentation.`);
  return {
    title: `${page.title} · Conch`,
    description,
    path: page.path,
    type: 'article',
    data: [
      {
        '@type': 'TechArticle',
        headline: page.title,
        description,
        url: absolute(page.path),
        inLanguage: 'en',
        isPartOf: { '@id': SITE['@id'] },
        author: PERSON,
        publisher: PERSON,
        image: absolute(SOCIAL_IMAGE.path),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: SITE_NAME, item: absolute('/') },
          { '@type': 'ListItem', position: 2, name: 'Documentation', item: absolute('/docs') },
          { '@type': 'ListItem', position: 3, name: page.title, item: absolute(page.path) },
        ],
      },
    ],
  };
}

/** Every tag a page's description becomes, in the order they're written into `<head>`. */
function tags(head: Head): { tag: 'meta' | 'link'; key: string; attrs: Record<string, string> }[] {
  const url = absolute(head.path);
  const image = absolute(SOCIAL_IMAGE.path);
  const meta = (key: 'name' | 'property', name: string, content: string) => ({
    tag: 'meta' as const,
    key: `${key}=${name}`,
    attrs: { [key]: name, content },
  });
  return [
    meta('name', 'description', head.description),
    meta('name', 'robots', head.noindex || DEVELOPMENT ? 'noindex' : 'index, follow'),
    ...(head.noindex || DEVELOPMENT
      ? []
      : [{ tag: 'link' as const, key: 'rel=canonical', attrs: { rel: 'canonical', href: url } }]),
    meta('property', 'og:type', head.type ?? 'website'),
    meta('property', 'og:site_name', SITE_NAME),
    meta('property', 'og:title', head.title),
    meta('property', 'og:description', head.description),
    meta('property', 'og:url', url),
    meta('property', 'og:image', image),
    meta('property', 'og:image:width', String(SOCIAL_IMAGE.width)),
    meta('property', 'og:image:height', String(SOCIAL_IMAGE.height)),
    meta('property', 'og:image:alt', SOCIAL_IMAGE.alt),
    meta('property', 'og:locale', 'en_US'),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', head.title),
    meta('name', 'twitter:description', head.description),
    meta('name', 'twitter:image', image),
    meta('name', 'twitter:image:alt', SOCIAL_IMAGE.alt),
    // The commit the page was built from, whatever the page shows (the Website check reads it).
    meta('name', 'conch-commit', publication.commit),
  ];
}

/** JSON-LD, safe inside a `<script>`: nothing in it can close the tag. */
function jsonLd(head: Head): string | undefined {
  if (!head.data?.length) return undefined;
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': head.data }).replace(
    /</g,
    '\\u003c',
  );
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The `<head>` part of a page built ahead of time. */
export function headHtml(head: Head): string {
  const lines = [`<title>${escape(head.title)}</title>`];
  for (const { tag, attrs } of tags(head)) {
    const pairs = Object.entries(attrs).map(([name, value]) => `${name}="${escape(value)}"`);
    lines.push(`<${tag} ${pairs.join(' ')} />`);
  }
  const data = jsonLd(head);
  if (data) lines.push(`<script type="application/ld+json" id="conch-ld">${data}</script>`);
  return lines.join('\n    ');
}

/** Makes `<head>` say what this page is: what was written at build time, kept true as people move on. */
export function applyHead(head: Head, doc: Document = document): void {
  doc.title = head.title;
  // A missing page has no address of its own to give.
  if (head.noindex || DEVELOPMENT) doc.head.querySelector('link[rel="canonical"]')?.remove();
  for (const { tag, key, attrs } of tags(head)) {
    const [attr = '', name = ''] = key.split('=');
    let element = doc.head.querySelector(`${tag}[${attr}="${name}"]`);
    if (!element) {
      element = doc.createElement(tag);
      doc.head.append(element);
    }
    for (const [k, v] of Object.entries(attrs)) element.setAttribute(k, v);
  }
  const data = jsonLd(head);
  let script = doc.getElementById('conch-ld');
  if (!data) script?.remove();
  else {
    if (!script) {
      script = doc.createElement('script');
      script.id = 'conch-ld';
      script.setAttribute('type', 'application/ld+json');
      doc.head.append(script);
    }
    script.textContent = data;
  }
}

/** The page's own description, in `<head>` while it's showing. */
export function useHead(head: Head): void {
  useEffect(() => {
    applyHead(head);
  }, [head]);
}
