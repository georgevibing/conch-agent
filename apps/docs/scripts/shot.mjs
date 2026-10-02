#!/usr/bin/env node
/**
 * Visual QA for the documentation: screenshots a page in a real browser.
 *
 *   node apps/docs/scripts/shot.mjs <page> [--mode=dark] [--width=1280] [--height=800]
 *                                   [--full] [--still] [--scroll=y] [--scale=2] [--wait=700]
 *                                   [--click=css] [--press=mod+k] [--type=text]
 *                                   [--out=file.png] [--port=4400]
 *
 * <page> is an address without its first slash (`start/install`, `docs`), or
 * `home` for the front page: Git Bash on Windows rewrites arguments that start
 * with a slash. `--still` asks for reduced motion. A very tall `--full` picture
 * needs `--scale=1`: Chrome can't draw one taller than 16,384 pixels.
 *
 * Needs the documentation running (`pnpm docs:dev`). Uses the Google Chrome
 * already installed, so nothing is downloaded.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { chromium } from 'playwright';

const [, , page = 'home', ...rest] = process.argv;
const path = page === 'home' ? '/' : `/${page.replace(/^\/+/, '')}`;
const opts = Object.fromEntries(
  rest.map((arg) => {
    const body = arg.replace(/^--/, '');
    const at = body.indexOf('=');
    return at === -1 ? [body, 'true'] : [body.slice(0, at), body.slice(at + 1)];
  }),
);

const name = page.replaceAll('/', '-');
const out = resolve(opts.out ?? `.artifacts/docs/${name}${opts.mode ? `-${opts.mode}` : ''}.png`);

const browser = await chromium.launch({ channel: 'chrome' });
const tab = await browser.newPage({
  viewport: { width: Number(opts.width ?? 1280), height: Number(opts.height ?? 800) },
  deviceScaleFactor: Number(opts.scale ?? 2),
  colorScheme: opts.mode === 'dark' ? 'dark' : 'light',
  reducedMotion: opts.still ? 'reduce' : 'no-preference',
});
const errors = [];
tab.on('pageerror', (error) => errors.push(error.message));
tab.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

await tab.goto(`http://localhost:${opts.port ?? 4400}${path}`, { waitUntil: 'networkidle' });
await tab.waitForSelector('#root > *', { timeout: 15_000 });
await tab.evaluate(() => document.fonts.ready);
if (opts.click) await tab.locator(opts.click).first().click();
if (opts.press) await tab.keyboard.press(opts.press.replace('mod', 'Control'));
if (opts.type) await tab.keyboard.type(opts.type);
if (opts.scroll) await tab.evaluate((y) => window.scrollTo(0, Number(y)), opts.scroll);
// The front page surfaces things as they scroll into view: walk the whole page
// first, the way a reader would, so a full picture isn't mostly empty.
if (opts.full) {
  await tab.evaluate(async () => {
    const step = window.innerHeight * 0.6;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((done) => setTimeout(done, 200));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
}
await tab.waitForTimeout(Number(opts.wait ?? 700));

mkdirSync(dirname(out), { recursive: true });
await tab.screenshot({ path: out, fullPage: Boolean(opts.full) });
await browser.close();

console.log(out);
if (errors.length) {
  console.error(`The page logged ${errors.length} error(s):\n${errors.join('\n')}`);
  process.exitCode = 1;
}
