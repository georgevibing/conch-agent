/**
 * Small, real pictures for tests (ADR 0090): a PNG made with zlib (a solid
 * colour, every chunk's checksum right), and the headers of a JPEG and a WebP
 * as their formats lay them out — enough for anything that reads a picture's
 * structure without drawing it.
 */
import { crc32, deflateSync } from 'node:zlib';

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** A PNG of one colour; `extra` chunks go before the picture data. */
export function png(
  width = 64,
  height = width,
  options: { rgb?: [number, number, number]; extra?: Buffer[] } = {},
): Buffer {
  const [r, g, b] = options.rgb ?? [40, 160, 90];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(options.extra ?? []),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A PNG chunk, to slip into one (`png(…, { extra })`). */
export const pngChunk = chunk;

/** A JPEG's markers: start, a frame of this size, a scan, the end. */
export function jpeg(width = 64, height = width): Buffer {
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
    0x00, 0x00,
  ]);
  const sof = Buffer.from([
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ]);
  const sos = Buffer.from([
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    sof,
    sos,
    Buffer.from([0x12, 0x34, 0x56, 0x78]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** A lossless WebP's header (VP8L), or an extended one (VP8X) that may say it moves. */
export function webp(
  width = 64,
  height = width,
  options: { animated?: boolean; extended?: boolean } = {},
): Buffer {
  let first: Buffer;
  if (options.extended || options.animated) {
    const body = Buffer.alloc(10);
    body[0] = options.animated ? 0x02 : 0;
    body.writeUIntLE(width - 1, 4, 3);
    body.writeUIntLE(height - 1, 7, 3);
    first = Buffer.concat([Buffer.from('VP8X', 'latin1'), le(10), body]);
  } else {
    const body = Buffer.alloc(10);
    body[0] = 0x2f;
    body.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 1);
    first = Buffer.concat([Buffer.from('VP8L', 'latin1'), le(10), body]);
  }
  const rest = Buffer.concat([Buffer.from('WEBP', 'latin1'), first]);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), le(rest.length), rest]);
}

function le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}
