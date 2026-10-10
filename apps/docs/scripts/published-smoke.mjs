// Exercise the actual static files, including direct loads without JavaScript.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';

import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const root = resolve('.site/output');
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!path.startsWith(`${root}${sep}`) && path !== root) {
      response.writeHead(403).end();
      return;
    }
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    response.setHeader('Content-Type', mime[extname(path)] ?? 'text/plain');
    response.end(await readFile(path));
  } catch {
    response
      .writeHead(404, { 'Content-Type': 'text/html' })
      .end(await readFile(resolve(root, '404.html')));
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
let browser;
try {
  browser = await chromium.launch(
    process.env.CONCH_TEST_BROWSER ? { executablePath: process.env.CONCH_TEST_BROWSER } : {},
  );
  const nojs = await browser.newContext({ javaScriptEnabled: false });
  const page = await nojs.newPage();
  for (const path of [
    '/',
    '/docs/',
    '/start/install/',
    '/releases/',
    '/docs/next/',
    '/docs/next/start/install/',
  ]) {
    const response = await page.goto(`${origin}${path}`);
    assert.equal(response.status(), 200, path);
    assert.equal(
      await page.locator('h1').count(),
      1,
      `${path} has its full page without JavaScript`,
    );
    assert.ok(await page.locator('body').innerText());
    if (path.startsWith('/docs/next/'))
      assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex');
  }
  assert.equal((await page.goto(`${origin}/nothing-here/`)).status(), 404);
  await nojs.close();
  const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  mkdirSync('.artifacts/site', { recursive: true });
  for (const mode of ['light', 'dark']) {
    const context = await browser.newContext({
      colorScheme: mode,
      reducedMotion: 'reduce',
      viewport: { width: 1280, height: 900 },
    });
    const tab = await context.newPage();
    const errors = [];
    tab.on('pageerror', (error) => errors.push(error.message));
    for (const path of [
      '/',
      '/docs/',
      '/start/install/',
      '/releases/',
      '/docs/next/',
      '/docs/next/start/install/',
    ]) {
      await tab.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
      await tab.locator('#content').waitFor();
      assert.equal(await tab.locator('h1').count(), 1, path);
      await tab.addScriptTag({ content: axe });
      const violations = await tab.evaluate(async () =>
        (await window.axe.run(document)).violations.map(
          (item) => `${item.id}: ${item.nodes.map((node) => node.target).join(', ')}`,
        ),
      );
      assert.deepEqual(violations, [], `${path} in ${mode}`);
      await tab.screenshot({ path: `.artifacts/site/${path.replaceAll('/', '_')}-${mode}.png` });
    }
    await tab.goto(`${origin}/docs/`, { waitUntil: 'networkidle' });
    await tab.getByRole('banner').getByRole('link', { name: 'Releases', exact: true }).click();
    await tab.waitForURL(`${origin}/releases/`);
    await tab.getByRole('tab', { name: 'Beta', exact: true }).click();
    assert.equal(
      await tab.getByRole('tab', { name: 'Beta', exact: true }).getAttribute('aria-selected'),
      'true',
    );
    await tab.getByRole('button', { name: 'Search', exact: true }).click();
    await tab.getByRole('combobox').fill('install');
    assert.ok(await tab.getByRole('option').count());
    await tab.keyboard.press('Escape');
    await tab.setViewportSize({ width: 390, height: 844 });
    await tab.goto(`${origin}/releases/`, { waitUntil: 'networkidle' });
    assert.equal(
      await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      'No horizontal overflow on a phone',
    );
    await tab.screenshot({ path: `.artifacts/site/mobile-${mode}.png` });
    assert.deepEqual(errors, [], 'No browser errors or hydration failures');
    await context.close();
  }
  for (const file of [
    'install.sh',
    'install.ps1',
    'docs/next/install.sh',
    'docs/next/install.ps1',
    'sitemap.xml',
    'robots.txt',
  ]) {
    const response = await fetch(`${origin}/${file}`);
    assert.equal(response.status, 200, file);
    assert.ok((await response.text()).length > 20);
  }
  console.log(
    'Static site passed: direct/no-JS loads, both versions, search, filters, installers, phone layout and light/dark axe checks.',
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
