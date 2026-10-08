/**
 * Pictures the way every provider that sees takes them (ADR 0017).
 *
 * A phone photo is 12 to 48 megapixels and several megabytes, turned on its
 * side by an EXIF flag, and it carries where it was taken. No model needs
 * more than about 2000 pixels on its long edge (Claude scales anything past
 * 1568 down, and refuses past 2000 when a message has many pictures; OpenAI
 * reads at most 2048), Claude takes 5 MB of base64 at most, and nobody asked
 * to send their home's location with a picture of their cat. So before a
 * picture goes to any provider it's turned upright, scaled to fit, and sent
 * without its metadata; one that already fits, with none, goes as it is.
 *
 * Formats a model can't read (an iPhone's HEIC, TIFF, BMP, AVIF) become a
 * JPEG when the picture is saved (`toJpeg`), with sharp where it can, and
 * otherwise with the computer's own converter (macOS `sips`, libheif's
 * `heif-convert`, ImageMagick).
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type Sharp from 'sharp';

import { findExecutable, run } from '../lib/proc';
import type { ImageType } from './sniff';

/** What a picture sent to a model fits in. */
export interface FitLimits {
  /** Longest edge, in pixels. */
  edge: number;
  /** Most bytes of the file (Claude's 5 MB of base64 is 3.75 MB of picture). */
  bytes: number;
}

export const MODEL_FIT: FitLimits = { edge: 2000, bytes: 3_700_000 };

export interface Fitted {
  bytes: Buffer;
  mimeType: ImageType;
  width?: number;
  height?: number;
  /** It was made again (turned, scaled, its metadata dropped); otherwise it's the original. */
  changed: boolean;
}

type SharpModule = typeof Sharp;
let loading: Promise<SharpModule | undefined> | undefined;

/**
 * sharp, loaded when a picture first needs it. A computer whose copy can't
 * load (an unusual platform) still sends pictures, as they are.
 */
export function loadSharp(): Promise<SharpModule | undefined> {
  loading ??= import('sharp')
    .then((module) => module.default)
    .catch((error: unknown) => {
      console.error(`[attachments] pictures go as they are: ${String(error).slice(0, 200)}`);
      return undefined;
    });
  return loading;
}

const PICTURE_PIXELS = 300_000_000;

/**
 * `bytes` fitted to `limits`: upright, no bigger than it needs to be, and with
 * no EXIF (so no location). Unchanged when it already fits and carries none,
 * or when it can't be read (the provider then says what it thinks of it).
 */
export async function fitPicture(
  bytes: Buffer,
  mimeType: ImageType,
  limits: FitLimits = MODEL_FIT,
): Promise<Fitted> {
  const same: Fitted = { bytes, mimeType, changed: false };
  const sharp = await loadSharp();
  if (!sharp) return same;
  try {
    const options = { failOn: 'none', limitInputPixels: PICTURE_PIXELS } as const;
    const meta = await sharp(bytes, options).metadata();
    const width = meta.width;
    const height = meta.height;
    if (!width || !height) return same;
    const edge = Math.max(width, height);
    const animated = (meta.pages ?? 1) > 1;
    const upright = (meta.orientation ?? 1) <= 1;
    const fits = edge <= limits.edge && bytes.length <= limits.bytes;
    // An animated GIF that fits keeps moving; one with nothing to hide is left alone.
    if (fits && (animated || (upright && !meta.exif && !meta.xmp)))
      return { ...same, width, height };

    let target = Math.min(edge, limits.edge);
    // A picture with see-through parts stays a PNG or WebP while it fits; else JPEG.
    let format: 'jpeg' | 'png' | 'webp' =
      mimeType === 'image/jpeg' ? 'jpeg' : mimeType === 'image/webp' ? 'webp' : 'png';
    let quality = 85;
    for (let attempt = 0; attempt < 6; attempt++) {
      let pipeline = sharp(bytes, { ...options, animated: false })
        .rotate()
        .resize({ width: target, height: target, fit: 'inside', withoutEnlargement: true });
      if (format === 'jpeg')
        pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true });
      else if (format === 'webp') pipeline = pipeline.webp({ quality });
      else pipeline = pipeline.png({ compressionLevel: 9 });
      const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
      if (data.length <= limits.bytes)
        return {
          bytes: data,
          mimeType: `image/${format}`,
          width: info.width,
          height: info.height,
          changed: true,
        };
      // Too big still: a PNG becomes a JPEG, then each try is a little smaller.
      if (format === 'png') format = 'jpeg';
      else if (quality > 70) quality -= 10;
      else target = Math.round(target * 0.8);
    }
    return same;
  } catch (error) {
    console.error(`[attachments] a picture went as it was: ${String(error).slice(0, 200)}`);
    return same;
  }
}

/** Picture formats no provider reads, which Conch turns into a JPEG when they're saved. */
export const CONVERTIBLE = new Set([
  'image/heic',
  'image/heif',
  'image/avif',
  'image/tiff',
  'image/bmp',
]);

/** Converts the file at `path` to a JPEG at `out`; false when it couldn't. */
export type PictureConverter = (path: string, out: string) => Promise<boolean>;

/** The computer's own converters, in order: macOS `sips`, libheif, ImageMagick. */
export const systemConverters: PictureConverter[] = [
  async (path, out) => {
    if (process.platform !== 'darwin') return false;
    const done = await run('/usr/bin/sips', ['-s', 'format', 'jpeg', path, '--out', out], {
      timeout: 60_000,
    });
    return done.code === 0;
  },
  async (path, out) => {
    const heif = await findExecutable('heif-convert');
    if (!heif) return false;
    return (await run(heif, ['-q', '90', path, out], { timeout: 60_000 })).code === 0;
  },
  async (path, out) => {
    const magick = await findExecutable('magick');
    if (!magick) return false;
    return (await run(magick, [path, '-auto-orient', out], { timeout: 60_000 })).code === 0;
  },
];

/**
 * A picture in a format models can't read, as a JPEG: sharp first (TIFF,
 * AVIF), then this computer's converters (HEIC needs one: sharp's own build
 * can't read it). Undefined when none could.
 */
export async function toJpeg(
  bytes: Buffer,
  /** Its extension (`heic`), for converters that go by the name. */
  ext: string,
  converters: readonly PictureConverter[] = systemConverters,
): Promise<Buffer | undefined> {
  const sharp = await loadSharp();
  if (sharp) {
    const done = await sharp(bytes, { failOn: 'none', limitInputPixels: PICTURE_PIXELS })
      .rotate()
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer()
      .catch(() => undefined);
    if (done) return done;
  }
  const dir = await mkdtemp(join(tmpdir(), 'conch-picture-'));
  try {
    const path = join(dir, `picture.${/^[a-z0-9]{1,5}$/.test(ext) ? ext : 'img'}`);
    const out = join(dir, 'picture.jpg');
    await writeFile(path, bytes, { mode: 0o600 });
    for (const convert of converters) {
      if (!(await convert(path, out).catch(() => false))) continue;
      const jpeg = await readFile(out).catch(() => undefined);
      if (jpeg?.length) return jpeg;
    }
    return undefined;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
