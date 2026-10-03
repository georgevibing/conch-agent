#!/usr/bin/env node
/**
 * The picture a link to the site shows in a chat or a feed (`og:image`):
 *
 *   node apps/docs/scripts/social.mjs
 *
 * Writes `apps/docs/public/social.png`, 1200 × 630: the pearl, the name and
 * one line, in Nacre's own colours and type. Run it again when the line on the
 * front page changes, and commit what it writes. Uses the Google Chrome
 * already installed, so nothing is downloaded.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = join(here, '..', '..');
const fonts = join(repo, 'packages', 'nacre', 'node_modules');
// Inline, as the page has no address of its own to load files from.
const font = (path) =>
  `data:font/woff2;base64,${readFileSync(join(fonts, path)).toString('base64')}`;
// The pearl without the ring that keeps it visible on a dark taskbar.
const pearl = readFileSync(join(repo, 'apps', 'web', 'public', 'icons', 'conch-tray.svg'), 'utf8')
  .split('\n')
  .filter((line) => !line.includes('stroke='))
  .join('\n');

const page = `<!doctype html>
<style>
  @font-face {
    font-family: 'Instrument Serif';
    src: url('${font('@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2')}');
  }
  @font-face {
    font-family: 'Geist';
    font-weight: 100 900;
    src: url('${font('@fontsource-variable/geist/files/geist-latin-wght-normal.woff2')}');
  }
  html, body { margin: 0; }
  body {
    width: 1200px;
    height: 630px;
    box-sizing: border-box;
    padding: 0 104px;
    display: flex;
    align-items: center;
    gap: 72px;
    background:
      radial-gradient(900px 520px at 18% 30%, #f6e4da 0%, transparent 60%),
      radial-gradient(800px 600px at 92% 100%, #e6e0f3 0%, transparent 55%),
      #fbf9f7;
    color: #2a211c;
    font-family: 'Geist', sans-serif;
  }
  .pearl { width: 300px; height: 300px; flex: none; filter: drop-shadow(0 28px 36px rgb(138 111 122 / 0.28)); }
  .pearl svg { width: 100%; height: 100%; display: block; }
  h1 { font: 400 156px/0.9 'Instrument Serif', serif; letter-spacing: -0.02em; margin: 0 0 28px; }
  p { font-size: 40px; line-height: 1.25; margin: 0; color: #5d5049; max-width: 640px; }
  .site { margin-top: 36px; font-size: 26px; font-weight: 500; color: #8a6f7a; letter-spacing: 0.01em; }
</style>
<div class="pearl">${pearl}</div>
<div>
  <h1>Conch</h1>
  <p>A calm home for your AI agents, on your own computer.</p>
  <div class="site">conchagent.com · open source</div>
</div>`;

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await tab.setContent(page);
  await tab.evaluate(() => document.fonts.ready);
  const out = join(here, 'public', 'social.png');
  await tab.screenshot({ path: out, type: 'png' });
  console.warn(`  🐚  ${out}`);
} finally {
  await browser.close();
}
