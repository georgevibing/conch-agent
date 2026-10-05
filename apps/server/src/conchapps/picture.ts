/**
 * An app's picture (ADR 0090): one PNG, JPEG or WebP at the top of its folder
 * (`icon.png`, `icon.jpg` or `icon.webp`), drawn as its icon instead of the
 * glyph. It's someone else's bytes, so it's read here before anything else
 * sees it — the kind from its bytes (never its name), its structure walked to
 * the end (nothing hidden after it, no animation), its size and sides held to
 * `APP_LIMITS.picture`. SVG is never a picture: it's a document that can
 * carry script, and Conch draws only what it can check byte by byte.
 */
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { crc32 } from 'node:zlib';

import {
  APP_LIMITS,
  APP_PICTURES,
  type AppPictureName,
  type AppPictureType,
  isAppPicture,
} from '@conch/protocol';

import { pathIn } from './store';
import type { AppFiles } from './types';

export interface Picture {
  name: AppPictureName;
  type: AppPictureType;
  width: number;
  height: number;
  bytes: number;
}

/** What the bytes are, or why they can't be an app's picture: one sentence a model can act on. */
export type PictureRead =
  | { ok: true; type: AppPictureType; width: number; height: number }
  | { ok: false; problem: string };

const NAMES = Object.keys(APP_PICTURES) as AppPictureName[];
const KIND: Record<AppPictureType, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
};
const NAME_OF: Record<AppPictureType, AppPictureName> = {
  'image/png': 'icon.png',
  'image/jpeg': 'icon.jpg',
  'image/webp': 'icon.webp',
};

/** The file name a picture of this kind is kept under. */
export const pictureName = (type: AppPictureType): AppPictureName => NAME_OF[type];

const kb = (n: number) => `${Math.round(n / 1024)} KB`;
const fail = (problem: string): PictureRead => ({ ok: false, problem });
const DAMAGED = 'damaged, or not a picture Conch can check';

// ── PNG ─────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Every chunk walked and its checksum held, IHDR first, IEND last and at the very end. */
function readPng(b: Buffer): PictureRead {
  let at = 8;
  let width = 0;
  let height = 0;
  let data = false;
  for (let count = 0; count < 10_000; count++) {
    if (at + 12 > b.length) return fail(`This PNG is ${DAMAGED}: it ends too soon.`);
    const length = b.readUInt32BE(at);
    const type = b.subarray(at + 4, at + 8).toString('latin1');
    if (!/^[A-Za-z]{4}$/.test(type) || length > b.length - at - 12)
      return fail(`This PNG is ${DAMAGED}.`);
    const body = b.subarray(at + 8, at + 8 + length);
    const crc = b.readUInt32BE(at + 8 + length);
    if (crc32(b.subarray(at + 4, at + 8 + length)) !== crc)
      return fail(`This PNG is ${DAMAGED}: a part of it doesn’t match its checksum.`);
    if (count === 0) {
      if (type !== 'IHDR' || length !== 13) return fail(`This PNG is ${DAMAGED}.`);
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
    }
    if (type === 'acTL' || type === 'fcTL')
      return fail('This PNG moves (an animated PNG). An icon holds still: use a single frame.');
    if (type === 'IDAT') data = true;
    at += 12 + length;
    if (type === 'IEND') {
      if (at !== b.length)
        return fail('This PNG has something hidden after its end. Save the picture again.');
      if (!data) return fail(`This PNG is ${DAMAGED}: it has no picture in it.`);
      return { ok: true, type: 'image/png', width, height };
    }
  }
  return fail(`This PNG is ${DAMAGED}.`);
}

// ── JPEG ────────────────────────────────────────────────────────────────────

/** The markers up to the scan walked, the frame's size read, and it ends where a JPEG ends. */
function readJpeg(b: Buffer): PictureRead {
  let at = 2;
  let width = 0;
  let height = 0;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return fail(`This JPEG is ${DAMAGED}.`);
    let marker = b[at + 1] ?? 0;
    // Fill bytes before a marker.
    while (marker === 0xff && at + 2 < b.length) {
      at++;
      marker = b[at + 1] ?? 0;
    }
    // Markers with no length of their own.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x00)
      return fail(`This JPEG is ${DAMAGED}.`);
    const length = b.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > b.length) return fail(`This JPEG is ${DAMAGED}.`);
    // Start of frame, but not DHT (C4), JPG (C8) or DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8) return fail(`This JPEG is ${DAMAGED}.`);
      height = b.readUInt16BE(at + 5);
      width = b.readUInt16BE(at + 7);
    }
    if (marker === 0xda) {
      if (!width || !height) return fail(`This JPEG is ${DAMAGED}: it has no frame.`);
      if (b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9)
        return fail('This JPEG doesn’t end where a JPEG ends. Save the picture again.');
      return { ok: true, type: 'image/jpeg', width, height };
    }
    at += 2 + length;
  }
  return fail(`This JPEG is ${DAMAGED}: it ends too soon.`);
}

// ── WebP ────────────────────────────────────────────────────────────────────

/** RIFF's own size holds, every chunk fits, and the first says the picture's size. */
function readWebp(b: Buffer): PictureRead {
  if (b.length < 30) return fail(`This WebP is ${DAMAGED}.`);
  if (b.readUInt32LE(4) + 8 !== b.length)
    return fail('This WebP isn’t the size it says it is. Save the picture again.');
  let width = 0;
  let height = 0;
  let at = 12;
  for (let count = 0; at < b.length; count++) {
    if (count > 1000 || at + 8 > b.length) return fail(`This WebP is ${DAMAGED}.`);
    const type = b.subarray(at, at + 4).toString('latin1');
    const size = b.readUInt32LE(at + 4);
    if (size > b.length - at - 8) return fail(`This WebP is ${DAMAGED}.`);
    const body = b.subarray(at + 8, at + 8 + size);
    if (count === 0) {
      if (type === 'VP8X' && size >= 10) {
        if ((body[0] ?? 0) & 0x02)
          return fail(
            'This WebP moves (an animated WebP). An icon holds still: use a single frame.',
          );
        width = body.readUIntLE(4, 3) + 1;
        height = body.readUIntLE(7, 3) + 1;
      } else if (type === 'VP8 ' && size >= 10) {
        if (body[3] !== 0x9d || body[4] !== 0x01 || body[5] !== 0x2a)
          return fail(`This WebP is ${DAMAGED}.`);
        width = body.readUInt16LE(6) & 0x3fff;
        height = body.readUInt16LE(8) & 0x3fff;
      } else if (type === 'VP8L' && size >= 5) {
        if (body[0] !== 0x2f) return fail(`This WebP is ${DAMAGED}.`);
        const bits = body.readUInt32LE(1);
        width = (bits & 0x3fff) + 1;
        height = ((bits >> 14) & 0x3fff) + 1;
      } else return fail(`This WebP is ${DAMAGED}.`);
    }
    if (type === 'ANIM' || type === 'ANMF')
      return fail('This WebP moves (an animated WebP). An icon holds still: use a single frame.');
    at += 8 + size + (size % 2);
  }
  if (at !== b.length) return fail(`This WebP is ${DAMAGED}.`);
  return { ok: true, type: 'image/webp', width, height };
}

// ── Any of them ─────────────────────────────────────────────────────────────

/** Looks like a document rather than a picture: SVG, HTML, XML. */
const looksLikeMarkup = (b: Buffer) => {
  // A UTF-8 byte order mark first is still a document.
  const start = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  return /^\s*</.test(b.subarray(start, start + 64).toString('latin1'));
};

/**
 * What these bytes are as a picture, from the bytes alone, held to the
 * limits. Any other kind, anything damaged, moving, too big or too small
 * says why in one sentence.
 */
export function readPicture(bytes: Buffer): PictureRead {
  const { picture } = APP_LIMITS;
  if (bytes.length > picture.bytes)
    return fail(
      `This picture is ${kb(bytes.length)}; an app’s picture can be at most ${kb(picture.bytes)}. Use a smaller one, around 256 × 256.`,
    );
  let read: PictureRead;
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) read = readPng(bytes);
  else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    read = readJpeg(bytes);
  else if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    read = readWebp(bytes);
  else if (looksLikeMarkup(bytes))
    return fail(
      'This is a document (SVG or HTML), not a picture. Conch draws only PNG, JPEG or WebP: find a PNG of it, like a site’s apple-touch-icon or a 256 px PNG of the logo.',
    );
  else
    return fail(
      'This isn’t a PNG, JPEG or WebP picture. Conch reads what the bytes are, not the name: find a PNG of it.',
    );
  if (!read.ok) return read;
  const { width, height } = read;
  if (width < picture.minSide || height < picture.minSide)
    return fail(
      `This picture is ${width} × ${height}, too small to draw well. Use one at least ${picture.minSide} × ${picture.minSide}; 256 × 256 looks best.`,
    );
  if (width > picture.maxSide || height > picture.maxSide)
    return fail(
      `This picture is ${width} × ${height}; an app’s picture can be at most ${picture.maxSide} × ${picture.maxSide}. Use a smaller one, around 256 × 256.`,
    );
  return read;
}

/** Why an app's picture can't be its picture, or nothing when it can. */
export function pictureProblem(name: AppPictureName, bytes: Buffer): string | undefined {
  const read = readPicture(bytes);
  if (!read.ok) return `${name}: ${read.problem}`;
  if (APP_PICTURES[name] !== read.type)
    return `${name} is a ${KIND[read.type]} picture: name it ${NAME_OF[read.type]}.`;
  return undefined;
}

/** The app's picture names it holds, in the order Conch looks. */
export const picturesIn = (files: AppFiles): AppPictureName[] =>
  NAMES.filter((name) => files.has(name));

/** Every file that's an app's picture is left out: what its tools and pages are made of. */
export const withoutPicture = (files: AppFiles): AppFiles =>
  new Map([...files].filter(([path]) => !isAppPicture(path)));

/** The app's picture, when it has one that holds; never a picture that doesn't. */
export function pictureOf(files: AppFiles): Picture | undefined {
  const [name, ...more] = picturesIn(files);
  if (!name || more.length) return undefined;
  const bytes = files.get(name) as Buffer;
  const read = readPicture(bytes);
  if (!read.ok || APP_PICTURES[name] !== read.type) return undefined;
  return { name, type: read.type, width: read.width, height: read.height, bytes: bytes.length };
}

/** A picture in words, for the maker's tools: “a 256 × 256 PNG (12 KB)”. */
export const describePicture = (p: {
  type: AppPictureType;
  width: number;
  height: number;
  bytes: number;
}) =>
  `a ${p.width} × ${p.height} ${KIND[p.type]} (${p.bytes < 1024 ? `${p.bytes} bytes` : kb(p.bytes)})`;

/**
 * The picture in an app's folder on disk, read for drawing: a plain file
 * (never a link, never one linked twice), under the size cap, and checked
 * again byte by byte, since the folder can change after it was added.
 * Undefined when there's none that holds.
 */
export async function readPictureFile(
  dir: string,
): Promise<{ name: AppPictureName; type: AppPictureType; bytes: Buffer } | undefined> {
  const found: AppPictureName[] = [];
  for (const name of NAMES) {
    const info = await lstat(pathIn(dir, name)).catch(() => undefined);
    if (info) found.push(name);
  }
  const [name, ...more] = found;
  if (!name || more.length) return undefined;
  const path = pathIn(dir, name);
  const before = await lstat(path).catch(() => undefined);
  if (!before?.isFile() || before.nlink > 1 || before.size > APP_LIMITS.picture.bytes)
    return undefined;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => undefined);
  if (!handle) return undefined;
  try {
    const now = await handle.stat();
    if (!now.isFile() || now.ino !== before.ino || now.dev !== before.dev || now.nlink > 1)
      return undefined;
    const bytes = Buffer.alloc(Math.min(now.size, APP_LIMITS.picture.bytes + 1));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const own = bytes.subarray(0, bytesRead);
    return pictureProblem(name, own) ? undefined : { name, type: APP_PICTURES[name], bytes: own };
  } finally {
    await handle.close();
  }
}

/** Whether an app's folder has a picture at all (cheap: the reading happens when it's drawn). */
export async function hasPictureFile(dir: string): Promise<boolean> {
  for (const name of NAMES)
    if ((await lstat(pathIn(dir, name)).catch(() => undefined))?.isFile()) return true;
  return false;
}
