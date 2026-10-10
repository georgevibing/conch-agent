// One artifact, checked before Pages sees it. No credentials in either build.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const folder = resolve('.site');
const output = resolve(folder, 'output');
const selection = JSON.parse(readFileSync(resolve(folder, 'selection.json'), 'utf8'));
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(resolve(folder, 'production/apps/docs/dist'), output, { recursive: true });
cpSync(resolve(folder, 'next/apps/docs/dist'), resolve(output, 'docs/next'), { recursive: true });
for (const name of ['CNAME', 'robots.txt', 'sitemap.xml', '404.html'])
  rmSync(resolve(output, 'docs/next', name), { force: true });
writeFileSync(resolve(output, '.nojekyll'), '');
for (const name of [
  'index.html',
  'docs/index.html',
  'releases/index.html',
  'docs/next/index.html',
  'docs/next/start/install/index.html',
  'start/install/index.html',
  'install.sh',
  'install.ps1',
  '404.html',
  'sitemap.xml',
  'robots.txt',
  'llms.txt',
  'llms-full.txt',
  'releases/feed.xml',
])
  if (!existsSync(resolve(output, name))) throw new Error(`Missing public file: ${name}`);
const html = (name) => readFileSync(resolve(output, name), 'utf8');
if (!html('docs/next/start/install/index.html').includes('content="noindex"'))
  throw new Error('Development documentation must stay out of search.');
if (html('sitemap.xml').includes('/docs/next/'))
  throw new Error('The public sitemap includes development pages.');
if (html('llms.txt').includes('/docs/next/'))
  throw new Error('llms.txt points AI assistants at development pages.');
for (const [path, commit] of [
  ['index.html', selection.production.commit],
  ['docs/next/index.html', selection.next.commit],
])
  if (!html(path).includes(commit))
    throw new Error(`${path} does not identify its content commit.`);
console.log('Production and development are ready as one checked Pages artifact.');
