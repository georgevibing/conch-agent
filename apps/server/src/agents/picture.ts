/**
 * An agent's picture of your own (ADR 0101): a PNG, JPEG or WebP, read from
 * its bytes (never its name), its structure walked to the end, and kept
 * without what a camera or an editor writes into it — where and when it was
 * taken, the device, comments, thumbnails. Only what draws the picture is
 * kept, so nothing about you leaves with it. SVG is never a picture: it's a
 * document that can carry script. Animated pictures are refused: a face holds
 * still.
 *
 * The browser frames and shrinks the picture before it comes here, which
 * already drops most of this; the gateway never relies on that.
 */
import { crc32 } from 'node:zlib';

import { AGENT_LIMITS, type AgentImageType } from '@conch/protocol';

export type CleanPicture =
  | { ok: true; type: AgentImageType; bytes: Buffer; width: number; height: number }
  | { ok: false; problem: string };

/** The sides a face may have: big enough to draw well, never a photo straight off a camera. */
export const PICTURE_SIDES = { min: 16, max: 2048 } as const;

const fail = (problem: string): CleanPicture => ({ ok: false, problem });
const DAMAGED = 'That picture is damaged, or not one Conch can read. Choose another.';
const MOVES = 'That picture moves. Choose one that holds still.';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The PNG chunks that draw the picture and say how its colours look. Anything
 * else (`tEXt`, `iTXt`, `zTXt`, `eXIf`, `tIME`, an editor's own) is left out.
 */
const PNG_KEEP = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'bKGD',
  'pHYs',
]);

function cleanPng(b: Buffer): CleanPicture {
  const kept: Buffer[] = [PNG_SIGNATURE];
  let at = 8;
  let width = 0;
  let height = 0;
  let data = false;
  for (let count = 0; count < 100_000; count++) {
    if (at + 12 > b.length) return fail(DAMAGED);
    const length = b.readUInt32BE(at);
    const type = b.subarray(at + 4, at + 8).toString('latin1');
    if (!/^[A-Za-z]{4}$/.test(type) || length > b.length - at - 12) return fail(DAMAGED);
    const body = b.subarray(at + 8, at + 8 + length);
    if (crc32(b.subarray(at + 4, at + 8 + length)) !== b.readUInt32BE(at + 8 + length))
      return fail(DAMAGED);
    if (count === 0) {
      if (type !== 'IHDR' || length !== 13) return fail(DAMAGED);
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
    }
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') return fail(MOVES);
    // A chunk a reader must understand (upper case first) that isn't one of these: not a PNG we can vouch for.
    const critical = type.charCodeAt(0) < 0x61;
    if (critical && !PNG_KEEP.has(type)) return fail(DAMAGED);
    if (type === 'IDAT') data = true;
    const end = at + 12 + length;
    if (PNG_KEEP.has(type)) kept.push(b.subarray(at, end));
    at = end;
    if (type === 'IEND') {
      // Anything after the end is someone hiding something: refused, not trimmed.
      if (at !== b.length || !data) return fail(DAMAGED);
      return { ok: true, type: 'image/png', bytes: Buffer.concat(kept), width, height };
    }
  }
  return fail(DAMAGED);
}

/**
 * JPEG segments kept: the frame, tables and scans, JFIF (APP0), the colour
 * profile (APP2 `ICC_PROFILE`) and Adobe's colour transform (APP14). EXIF and
 * XMP (APP1), IPTC (APP13), comments and every other APPn are left out.
 */
function keepJpegSegment(marker: number, body: Buffer): boolean {
  if (marker === 0xfe) return false; // COM
  if (marker >= 0xe0 && marker <= 0xef) {
    if (marker === 0xe0) return body.subarray(0, 5).toString('latin1') === 'JFIF\0';
    if (marker === 0xe2) return body.subarray(0, 12).toString('latin1') === 'ICC_PROFILE\0';
    if (marker === 0xee) return body.subarray(0, 5).toString('latin1') === 'Adobe';
    return false;
  }
  return true;
}

function cleanJpeg(b: Buffer): CleanPicture {
  const kept: Buffer[] = [b.subarray(0, 2)];
  let at = 2;
  let width = 0;
  let height = 0;
  let scans = 0;
  while (at + 2 <= b.length) {
    if (b[at] !== 0xff) return fail(DAMAGED);
    // Fill bytes before a marker.
    while (b[at + 1] === 0xff && at + 2 < b.length) at++;
    const marker = b[at + 1] ?? 0;
    if (marker === 0xd9) {
      if (at + 2 !== b.length || !scans) return fail(DAMAGED);
      kept.push(b.subarray(at, at + 2));
      return { ok: true, type: 'image/jpeg', bytes: Buffer.concat(kept), width, height };
    }
    if (marker === 0xd8 || marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7))
      return fail(DAMAGED);
    if (at + 4 > b.length) return fail(DAMAGED);
    const length = b.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > b.length) return fail(DAMAGED);
    const body = b.subarray(at + 4, at + 2 + length);
    // Start of frame, but not DHT (C4), JPG (C8) or DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8) return fail(DAMAGED);
      height = b.readUInt16BE(at + 5);
      width = b.readUInt16BE(at + 7);
    }
    let end = at + 2 + length;
    if (marker === 0xda) {
      if (!width || !height) return fail(DAMAGED);
      scans++;
      // The scan's data runs to the next marker that isn't stuffing (FF00) or a restart (FFD0–D7).
      while (end < b.length) {
        if (b[end] === 0xff) {
          const next = b[end + 1];
          if (next === undefined) return fail(DAMAGED);
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7) || next === 0xff) {
            end += next === 0xff ? 1 : 2;
            continue;
          }
          break;
        }
        end++;
      }
      kept.push(b.subarray(at, end));
    } else if (keepJpegSegment(marker, body)) kept.push(b.subarray(at, end));
    at = end;
  }
  return fail(DAMAGED);
}

/** WebP chunks kept: the picture, its transparency and colour profile. EXIF and XMP are left out. */
const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ICCP']);

function cleanWebp(b: Buffer): CleanPicture {
  if (b.length < 30 || b.readUInt32LE(4) + 8 !== b.length) return fail(DAMAGED);
  const kept: Buffer[] = [];
  let width = 0;
  let height = 0;
  let at = 12;
  for (let count = 0; at < b.length; count++) {
    if (count > 1000 || at + 8 > b.length) return fail(DAMAGED);
    const type = b.subarray(at, at + 4).toString('latin1');
    const size = b.readUInt32LE(at + 4);
    if (size > b.length - at - 8) return fail(DAMAGED);
    const body = b.subarray(at + 8, at + 8 + size);
    if (type === 'ANIM' || type === 'ANMF') return fail(MOVES);
    if (count === 0) {
      if (type === 'VP8X' && size >= 10) {
        if ((body[0] ?? 0) & 0x02) return fail(MOVES);
        width = body.readUIntLE(4, 3) + 1;
        height = body.readUIntLE(7, 3) + 1;
      } else if (type === 'VP8 ' && size >= 10) {
        if (body[3] !== 0x9d || body[4] !== 0x01 || body[5] !== 0x2a) return fail(DAMAGED);
        width = body.readUInt16LE(6) & 0x3fff;
        height = body.readUInt16LE(8) & 0x3fff;
      } else if (type === 'VP8L' && size >= 5) {
        if (body[0] !== 0x2f) return fail(DAMAGED);
        const bits = body.readUInt32LE(1);
        width = (bits & 0x3fff) + 1;
        height = ((bits >> 14) & 0x3fff) + 1;
      } else return fail(DAMAGED);
    }
    const end = at + 8 + size + (size % 2);
    if (end > b.length) return fail(DAMAGED);
    if (WEBP_KEEP.has(type)) {
      const chunk = Buffer.from(b.subarray(at, end));
      // The extended header says EXIF (0x08) and XMP (0x04) follow: they don't any more.
      if (type === 'VP8X') chunk[8] = (chunk[8] ?? 0) & ~0x0c;
      kept.push(chunk);
    }
    at = end;
  }
  if (at !== b.length || !width || !height) return fail(DAMAGED);
  const body = Buffer.concat(kept);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return { ok: true, type: 'image/webp', bytes: Buffer.concat([header, body]), width, height };
}

/** Looks like a document rather than a picture: SVG, HTML, XML. */
const looksLikeMarkup = (b: Buffer) => {
  const start = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  return /^\s*</.test(b.subarray(start, start + 64).toString('latin1'));
};

/**
 * The picture these bytes are, without its metadata, or why it can't be a
 * face, in one sentence for the person. `max`: how many bytes it may be.
 */
export function cleanPicture(bytes: Buffer, max: number = AGENT_LIMITS.avatarBytes): CleanPicture {
  if (!bytes.length) return fail('That picture was empty. Choose another.');
  if (bytes.length > max) return fail('That picture is too big. Choose a smaller one.');
  let read: CleanPicture;
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) read = cleanPng(bytes);
  else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    read = cleanJpeg(bytes);
  else if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    read = cleanWebp(bytes);
  else if (looksLikeMarkup(bytes))
    return fail('That’s a document (like SVG), not a picture. Choose a PNG, JPEG or WebP.');
  else return fail('Choose a PNG, JPEG or WebP picture.');
  if (!read.ok) return read;
  if (read.width < PICTURE_SIDES.min || read.height < PICTURE_SIDES.min)
    return fail('That picture is too small to draw well. Choose a bigger one.');
  if (read.width > PICTURE_SIDES.max || read.height > PICTURE_SIDES.max)
    return fail('That picture is too big. Choose a smaller one.');
  return read;
}

/** What kind of picture it is, from its first bytes alone (for reading back what was kept). */
export function pictureType(bytes: Uint8Array): AgentImageType | undefined {
  const at = (i: number, ...values: number[]) => values.every((v, n) => bytes[i + n] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return undefined;
}
