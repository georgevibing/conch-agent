/**
 * Every page of the site, drawn ahead of time (`scripts/prerender.mjs`): what
 * search engines, link previews and a browser without JavaScript read, before
 * the live page takes over in the browser.
 */
import { prerender } from 'react-dom/static';
import { StaticRouter } from 'react-router';

import { BASE, preloadPage, Site, SiteRoutes } from './app/App';
import { DOCS_HEAD, headHtml, LANDING_HEAD, NOT_FOUND_HEAD, type Head } from './site/head';
import { headOf, pageAt, PAGES } from './site/pages';

export { headHtml };
export { SITE_URL } from './site/config';

/** The address the page for a missing one is drawn at (written as `404.html`). */
export const MISSING = '/404';

/** Every address with a page, front page first. */
export const PATHS: readonly string[] = ['/', '/docs', ...PAGES.map((page) => page.path)];

export function headFor(path: string): Head {
  if (path === '/') return LANDING_HEAD;
  if (path === '/docs') return DOCS_HEAD;
  const page = pageAt(path);
  return page ? headOf(page) : NOT_FOUND_HEAD;
}

/** The file whose code draws the page (as Vite's manifest names it), to fetch it early. */
export function codeFor(path: string): string | undefined {
  if (path === '/') return undefined;
  return path === '/docs' ? 'src/home/Home.tsx' : 'src/pages/DocPage.tsx';
}

/** The file in the repository a page's words live in, for when it last changed. */
export function sourceOf(path: string): string | undefined {
  if (path === '/') return 'apps/docs/src/landing/Landing.tsx';
  if (path === '/docs') return 'apps/docs/src/home/Home.tsx';
  return pageAt(path)?.file;
}

/** The page at `path`, as HTML for inside `#root`. */
export async function render(path: string): Promise<string> {
  // Its code first, as in the browser: the page is drawn whole, never "Opening the page".
  await preloadPage(`${BASE}${path}`);
  const { prelude } = await prerender(
    <Site>
      <StaticRouter basename={BASE} location={`${BASE}${path}`}>
        <SiteRoutes />
      </StaticRouter>
    </Site>,
    // Nothing held back to stream in later: a crawler without JavaScript reads it all in place.
    { progressiveChunkSize: Number.POSITIVE_INFINITY },
  );
  return new Response(prelude).text();
}
