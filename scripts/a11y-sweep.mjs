#!/usr/bin/env node
/**
 * Runs axe-core (including colour contrast) against every Storybook story in
 * light and dark mode using the system Chrome. Storybook must be running.
 *
 *   node scripts/a11y-sweep.mjs [--port=6006] [--filter=substring]
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const opts = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);
const port = opts.port ?? 6006;
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const index = await (await fetch(`http://localhost:${port}/index.json`)).json();
const stories = Object.values(index.entries).filter(
  (e) => e.type === 'story' && (!opts.filter || e.id.includes(opts.filter)),
);

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
let failures = 0;
for (const story of stories) {
  for (const mode of ['light', 'dark']) {
    await page.goto(
      `http://localhost:${port}/iframe.html?id=${story.id}&viewMode=story&globals=mode:${mode}`,
      { waitUntil: 'networkidle' },
    );
    await page.waitForTimeout(600);
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => {
      // @ts-expect-error injected
      const r = await window.axe.run(document, {
        rules: {
          region: { enabled: false },
          'page-has-heading-one': { enabled: false },
          'landmark-one-main': { enabled: false },
        },
      });
      return r.violations.map(
        (v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')}`,
      );
    });
    if (violations.length) {
      failures += 1;
      console.log(`✗ ${story.id} [${mode}]\n  ${violations.join('\n  ')}`);
    }
  }
}
await browser.close();
console.log(`\n${stories.length} stories × 2 modes, ${failures} with violations`);
process.exit(failures ? 1 : 0);
