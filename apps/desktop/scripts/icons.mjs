// The pearl as Windows icons, drawn from the web app's own picture:
//
//   node apps/desktop/scripts/icons.mjs
//
// apps/web/public/icons/conch.ico       the app: its window, the taskbar, Start and the installer
// apps/web/public/icons/conch-tray.ico  the tray, edge to edge
//
// Each holds the pearl drawn at every size Windows asks for (16 px at 100 %
// up to 256 px), so nothing is shrunk from a big picture into a blur. Run it
// again when conch-tray.svg changes, and commit what it writes. Uses the
// Google Chrome already installed, so nothing is downloaded.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const icons = join(here, '..', 'web', 'public', 'icons');
const pearl = readFileSync(join(icons, 'conch-tray.svg'), 'utf8');

/** The app's pearl keeps a little air around it, as Windows' own icons do. */
const padded = pearl.replace('viewBox="0 0 256 256"', 'viewBox="-14 -14 284 284"');

const SETS = [
  { file: 'conch.ico', svg: padded, sizes: [16, 20, 24, 32, 40, 48, 64, 96, 128, 256] },
  { file: 'conch-tray.ico', svg: pearl, sizes: [16, 20, 24, 32, 40, 48, 64] },
];

/** An `.ico` of PNG images, largest last (Windows Vista and later read PNG icons). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt8(0, at + 2);
    header.writeUInt8(0, at + 3);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.byteLength, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.byteLength;
  });
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const tab = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { file, svg, sizes } of SETS) {
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    const images = [];
    for (const size of sizes) {
      await tab.setViewportSize({ width: size, height: size });
      await tab.setContent(
        `<style>html,body{margin:0;background:transparent}img{display:block}</style>` +
          `<img src="${src}" width="${size}" height="${size}">`,
      );
      await tab.locator('img').evaluate((img) => img.decode());
      images.push({
        size,
        png: await tab.screenshot({ omitBackground: true, type: 'png' }),
      });
    }
    writeFileSync(join(icons, file), ico(images));
    console.warn(`  🐚  ${file}: ${sizes.join(', ')} px`);
  }
} finally {
  await browser.close();
}
