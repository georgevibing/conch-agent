#!/usr/bin/env node
/**
 * Visual QA helper: screenshots Storybook stories with a real browser.
 *
 *   node scripts/snap.mjs <story-id> [--mode=dark] [--accent=iris] [--hover=selector]
 *                        [--width=900] [--height=600] [--out=path.png] [--full]
 *
 * Requires Storybook running on http://localhost:6006 (pnpm storybook).
 * Uses the locally installed Google Chrome, so no browser download is needed.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

const [, , storyId, ...rest] = process.argv;
if (!storyId) {
  console.error(
    'usage: snap.mjs <story-id> [--mode=dark] [--accent=x] [--hover=css] [--click=css]',
  );
  process.exit(1);
}
const opts = Object.fromEntries(
  rest.map((a) => {
    const body = a.replace(/^--/, '');
    const i = body.indexOf('=');
    return i === -1 ? [body, 'true'] : [body.slice(0, i), body.slice(i + 1)];
  }),
);
const globals = [
  opts.mode && `mode:${opts.mode}`,
  opts.accent && `accent:${opts.accent}`,
  opts.lustre && `lustre:${opts.lustre}`,
]
  .filter(Boolean)
  .join(';');
const url = `http://localhost:${opts.port ?? 6006}/iframe.html?id=${storyId}&viewMode=story${globals ? `&globals=${globals}` : ''}`;
const out = opts.out ?? `.artifacts/snaps/${storyId}${opts.mode ? `-${opts.mode}` : ''}.png`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({
  viewport: { width: Number(opts.width ?? 900), height: Number(opts.height ?? 600) },
  deviceScaleFactor: 2,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on(
  'console',
  (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()),
);
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('#storybook-root > *', { timeout: 15000 });
await page.evaluate(() => document.fonts.ready);
if (opts.hover) {
  const el = page.locator(opts.hover).first();
  const box = await el.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35, { steps: 8 });
  }
}
if (opts.click) await page.locator(opts.click).first().click();
if (opts.focus) await page.locator(opts.focus).first().focus();
if (opts.tab) for (let i = 0; i < Number(opts.tab); i++) await page.keyboard.press('Tab');
await page.waitForTimeout(Number(opts.wait ?? 700));
mkdirSync(dirname(out), { recursive: true });
let clip;
if (opts.clip) {
  const box = await page.locator(opts.clip).first().boundingBox();
  const pad = Number(opts.pad ?? 24);
  if (box)
    clip = {
      x: box.x - pad,
      y: box.y - pad,
      width: box.width + pad * 2,
      height: box.height + pad * 2,
    };
}
await page.screenshot({ path: out, fullPage: opts.full === 'true', clip });
await browser.close();
if (errors.length) console.error('Page errors:\n' + errors.join('\n'));
console.log(out);
