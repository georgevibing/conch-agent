#!/usr/bin/env node
/**
 * Screenshot the running web app for visual QA (system Chrome).
 *   node apps/web/scripts/shot.mjs <path> <out.png> [--mode=dark] [--width=1280] [--height=820]
 *        [--click=text] [--type=text] [--enter] [--wait=ms] [--steps=json]
 * `--steps` is a JSON array of {click|fill|press|wait|hover} actions run in order.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

const [, , path = '/', out = '.artifacts/web/shot.png', ...rest] = process.argv;
const opts = Object.fromEntries(
  rest.map((a) => {
    const body = a.replace(/^--/, '');
    const i = body.indexOf('=');
    return i === -1 ? [body, 'true'] : [body.slice(0, i), body.slice(i + 1)];
  }),
);
const base = opts.base ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: Number(opts.width ?? 1280), height: Number(opts.height ?? 820) },
  deviceScaleFactor: 2,
  colorScheme: opts.mode === 'dark' ? 'dark' : 'light',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.addInitScript((mode) => {
  localStorage.setItem('conch.theme', JSON.stringify({ mode }));
}, opts.mode ?? 'light');
await page.goto(base + path, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const steps = opts.steps ? JSON.parse(opts.steps) : [];
for (const s of steps) {
  if (s.click)
    await page
      .getByRole(s.role ?? 'button', { name: s.click, exact: s.exact ?? false })
      .first()
      .click();
  if (s.text) await page.getByText(s.text, { exact: false }).first().click();
  if (s.fill)
    await page
      .getByRole(s.role ?? 'textbox', { name: s.fill })
      .first()
      .fill(s.value);
  if (s.press) await page.keyboard.press(s.press);
  if (s.hover) await page.getByText(s.hover).first().hover();
  if (s.wait) await page.waitForTimeout(s.wait);
}
await page.waitForTimeout(Number(opts.wait ?? 800));
mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out, fullPage: opts.full === 'true' });
await browser.close();
if (errors.length) console.error('Page errors:\n' + errors.join('\n'));
console.log(out);
