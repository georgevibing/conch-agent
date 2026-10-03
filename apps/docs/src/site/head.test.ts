import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SITE_URL } from './config';
import { applyHead, articleHead, headHtml, LANDING_HEAD, NOT_FOUND_HEAD, sentence } from './head';
import { headOf, PAGES } from './pages';

const docs = resolve(import.meta.dirname, '..', '..');
const indexHtml = readFileSync(resolve(docs, 'index.html'), 'utf8');

describe('the page every address starts from', () => {
  it('names Nacre’s layers in Nacre’s order before any stylesheet', () => {
    const nacre = readFileSync(
      resolve(docs, '..', '..', 'packages', 'nacre', 'src', 'styles', 'index.css'),
      'utf8',
    );
    const order = (css: string) => /@layer\s+([\w.,\s]+);/.exec(css)?.[1]?.replace(/\s+/g, ' ');
    expect(order(indexHtml)).toBe(order(nacre));
    expect(indexHtml.indexOf('@layer')).toBeLessThan(indexHtml.indexOf('<link'));
  });

  it('has the part scripts/prerender.mjs fills in, and an empty #root', () => {
    expect(indexHtml).toMatch(/<!--head-->[\s\S]*<title>[\s\S]*<!--\/head-->/);
    expect(indexHtml).toContain('<div id="root"></div>');
  });
});

describe('what each page tells search engines', () => {
  it('a sentence is cut at a word, never in one', () => {
    expect(sentence('Short and sweet.')).toBe('Short and sweet.');
    const long = sentence('word '.repeat(60));
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long).toMatch(/word…$/);
  });

  it('every page has its own title and a description that fits a search result', () => {
    const titles = new Map<string, string>();
    for (const page of PAGES) {
      const head = headOf(page);
      expect(head.description, page.path).not.toBe('');
      expect(head.description.length, page.path).toBeLessThanOrEqual(160);
      expect(head.description, page.path).not.toMatch(/[*`[\]]|^Status:/);
      expect(titles.get(head.title), `${page.path} has the title of another page`).toBeUndefined();
      titles.set(head.title, page.path);
    }
  });

  it('writes tags nothing in a page can break out of', () => {
    const html = headHtml(
      articleHead({
        path: '/x',
        title: 'A "quoted" <title>',
        description: '</script><script>alert(1)</script>',
        section: 'start',
      }),
    );
    expect(html).toContain('<title>A &quot;quoted&quot; &lt;title&gt; · Conch</title>');
    expect(html).not.toContain('</script><script>');
    expect(html).toContain(`<link rel="canonical" href="${SITE_URL}/x" />`);
  });

  it('keeps <head> true as people move between pages', () => {
    applyHead(LANDING_HEAD);
    expect(document.title).toBe(LANDING_HEAD.title);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', `${SITE_URL}/`);
    expect(document.querySelector('meta[property="og:type"]')).toHaveAttribute(
      'content',
      'website',
    );

    const install = PAGES.find((page) => page.path === '/start/install');
    if (!install) throw new Error('No install page');
    applyHead(headOf(install));
    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${SITE_URL}/start/install`,
    );
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      'content',
      install.description,
    );
    expect(JSON.parse(document.getElementById('conch-ld')?.textContent ?? '{}')).toMatchObject({
      '@graph': [{ '@type': 'TechArticle', headline: 'Install' }, { '@type': 'BreadcrumbList' }],
    });

    // A missing page has no address of its own, and stays out of search.
    applyHead(NOT_FOUND_HEAD);
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    expect(document.getElementById('conch-ld')).toBeNull();
  });
});
