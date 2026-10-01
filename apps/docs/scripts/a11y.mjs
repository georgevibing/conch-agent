#!/usr/bin/env node
/**
 * Runs axe-core (colour contrast included) on every page of the documentation,
 * in light and dark, in the Google Chrome already installed.
 *
 *   node apps/docs/scripts/a11y.mjs [--port=4400] [--filter=substring]
 *
 * Needs the documentation running (`pnpm docs:dev`).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const opts = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
    return [key, value];
  }),
);
const origin = `http://localhost:${opts.port ?? 4400}`;
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const browser = await chromium.launch({ channel: 'chrome' });

/** The home page, and every page the contents list. */
async function pages() {
  const tab = await browser.newPage();
  await tab.goto(`${origin}/start/install`, { waitUntil: 'networkidle' });
  const listed = await tab
    .locator('nav[aria-label="Documentation"] a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  await tab.close();
  return ['/', ...listed].filter((path) => path && (!opts.filter || path.includes(opts.filter)));
}

let failures = 0;
const paths = await pages();
for (const mode of ['light', 'dark']) {
  // Still, so nothing is caught half way through arriving.
  const tab = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    colorScheme: mode,
    reducedMotion: 'reduce',
  });
  for (const path of paths) {
    await tab.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
    await tab.waitForSelector('#content');
    await tab.evaluate(() => document.fonts.ready);
    await tab.waitForTimeout(300);
    await tab.addScriptTag({ content: axe });
    const violations = await tab.evaluate(async () => {
      const result = await window.axe.run(document);
      return result.violations.map(
        (violation) =>
          `${violation.id} (${violation.nodes.length}): ${violation.nodes[0]?.target.join(' ')}`,
      );
    });
    if (violations.length) {
      failures += 1;
      console.log(`✗ ${path} [${mode}]\n  ${violations.join('\n  ')}`);
    }
  }
  await tab.close();
}
await browser.close();

console.log(`\n${paths.length} pages × 2 modes, ${failures} with violations`);
process.exit(failures ? 1 : 0);
