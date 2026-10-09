/**
 * The page as a picture for the model (ADR 0070): one picture pixel per CSS
 * pixel, so a screen at twice the density (a Mac's, in your own Chrome) costs
 * a quarter, and no bigger than the model reads (`pictureLimit`), so the
 * provider never scales it behind Conch's back. The size it went at is the
 * space `browser_click_at`'s x,y are read in.
 */
import type { Locator, Page } from 'playwright-core';

import { loadSharp } from '../attachments/fit';
import { fitPictureTo, pictureLimit } from '../engines/api/sight';

export interface PageShot {
  jpeg: Buffer;
  /** The picture's size: x,y read off it are in these pixels. */
  width: number;
  height: number;
}

const QUALITY = 70;

/** A picture of the visible page, `viewport` CSS pixels, sized for `model`. */
export async function shootPage(
  page: Page,
  options: {
    viewport: { width: number; height: number };
    model?: string | undefined;
    mask?: Locator[];
    maskColor?: string;
  },
): Promise<PageShot> {
  const jpeg = await page.screenshot({
    type: 'jpeg',
    quality: QUALITY,
    scale: 'css',
    ...(options.mask && { mask: options.mask }),
    ...(options.maskColor && { maskColor: options.maskColor }),
  });
  const { width, height } = options.viewport;
  const fit = fitPictureTo(width, height, pictureLimit(options.model));
  if (fit.width === width && fit.height === height) return { jpeg, width, height };
  const sharp = await loadSharp();
  // Without sharp it goes as it is: the provider scales it, as it always did.
  if (!sharp) return { jpeg, width, height };
  const smaller = await sharp(jpeg)
    .resize({ width: fit.width, height: fit.height, fit: 'fill' })
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toBuffer()
    .catch(() => undefined);
  return smaller ? { jpeg: smaller, ...fit } : { jpeg, width, height };
}
