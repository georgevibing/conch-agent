// The site's pages as HTML, after `vite build` (the browser's code) and
// `vite build --ssr src/prerender.tsx` (the same pages, for Node):
//
//   dist/index.html              the front page
//   dist/docs/index.html               the documentation's home
//   dist/<section>/<page>/index.html   every guide and decision, at its own address
//   dist/404.html                what an address with nothing behind it shows
//   dist/sitemap.xml, robots.txt, CNAME, install.sh, install.ps1, favicon.ico
//   dist/llms.txt, llms-full.txt, releases/feed.xml   (site/discovery.ts)
//
// Directory indexes support both /start/install and /start/install/ on Pages.
// Every page answers with its own
// words, its own title and a 200, and the live page takes over in the browser.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = resolve(here, '..', '..');
const dist = join(here, 'dist');
const built = join(dist, '.prerender');
const base = process.env.CONCH_DOCS_BASE ?? '/';

const site = await import(pathToFileURL(join(built, 'prerender.js')).href);
const siteUrl = site.SITE_URL;
const development = base === '/docs/next/';

const originalTemplate = readFileSync(join(dist, 'index.html'), 'utf8');
const template = development
  ? originalTemplate
      .replace(/<link rel="sitemap"[^>]*>/, '')
      .replace(/<link\s+rel="alternate"\s+type="application\/atom\+xml"[^>]*>\s*/, '')
  : originalTemplate;
const HEAD = /<!--head-->[\s\S]*?<!--\/head-->/;
const ROOT = '<div id="root"></div>';
if (!HEAD.test(template) || !template.includes(ROOT))
  throw new Error('index.html needs its <!--head--> … <!--/head--> part and an empty #root.');

/** @type {Record<string, { file: string; css?: string[]; imports?: string[] }>} */
const manifest = JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf8'));

/**
 * The page's own code and styles, asked for with the page instead of after it.
 * Styles come in the order the browser's code would add them, after the site's
 * own (a chunk's imports before the chunk), and never twice: a rule's place
 * decides which one wins.
 */
function early(source) {
  if (!source) return [];
  const files = new Set();
  const styles = new Set();
  const visit = (key) => {
    const chunk = manifest[key];
    if (!chunk || files.has(chunk.file)) return;
    files.add(chunk.file);
    for (const next of chunk.imports ?? []) visit(next);
    for (const css of chunk.css ?? []) styles.add(css);
  };
  visit(source);
  const fresh = (file) => !template.includes(`${base}${file}"`);
  return [
    ...[...styles]
      .filter(fresh)
      .map((css) => `<link rel="stylesheet" crossorigin href="${base}${css}" />`),
    ...[...files]
      .filter(fresh)
      .map((file) => `<link rel="modulepreload" crossorigin href="${base}${file}" />`),
  ];
}

/** When a file last changed, from Git (`YYYY-MM-DD`), or nothing when Git doesn't know. */
function changed(file) {
  if (!file) return undefined;
  try {
    const date = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  } catch {
    return undefined;
  }
}

const write = (name, text) => {
  const out = join(dist, name);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
};

const entries = [];
for (const path of [...site.PATHS, site.MISSING]) {
  const head = site.headFor(path);
  const body = await site.render(path);
  const page = template
    .replace(HEAD, site.headHtml(head))
    .replace('</head>', `${early(site.codeFor(path)).join('\n    ')}\n  </head>`)
    .replace(ROOT, `<div id="root">${body}</div>`);
  const name =
    path === '/'
      ? 'index.html'
      : path === site.MISSING
        ? '404.html'
        : `${path.slice(1)}/index.html`;
  write(name, page);
  if (!head.noindex && !development) entries.push({ path, lastmod: changed(site.sourceOf(path)) });
}

const url = (path) => `${siteUrl}${path === '/' ? '/' : `${path}/`}`;
write(
  'sitemap.xml',
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(
      ({ path, lastmod }) =>
        `  <url><loc>${url(path)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`,
    ),
    '</urlset>',
    '',
  ].join('\n'),
);
// For AI assistants and feed readers; the development pages have neither.
if (!development) for (const [name, text] of Object.entries(site.discovery())) write(name, text);
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
write('.nojekyll', '');
// Pages custom-domain settings own routing; CNAME also documents it in the artifact.
write('CNAME', `${new URL(siteUrl).host}\n`);

// The one-line installers, at the site's own address (README § Install).
for (const name of ['install.sh', 'install.ps1'])
  copyFileSync(join(repo, 'scripts', name), join(dist, name));
// The pearl, where browsers and search engines look for a site's icon.
const icons = join(repo, 'apps', 'web', 'public', 'icons');
copyFileSync(join(icons, 'conch-tray.ico'), join(dist, 'favicon.ico'));
copyFileSync(join(icons, 'apple-touch-icon.png'), join(dist, 'apple-touch-icon.png'));

rmSync(built, { recursive: true, force: true });
rmSync(join(dist, '.vite'), { recursive: true, force: true });
console.warn(
  `  🐚  ${entries.length} pages drawn ahead of time, with the sitemap, llms.txt and the releases' feed for ${siteUrl}`,
);
