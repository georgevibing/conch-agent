/**
 * Small pictures built byte by byte for tests, with the metadata a camera or
 * an editor leaves in them (ADR 0101): where a photo was taken, comments,
 * XMP. Only their structure is real, which is all the picture checks read.
 */
import { crc32, deflateSync } from 'node:zlib';

const SECRET = 'GPS 52.5200N 13.4050E, taken by Ada';

function pngChunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** A `side`×`side` grey PNG; `extra` chunks go after IHDR, `after` bytes after IEND. */
export function png(
  side = 64,
  options: { text?: boolean; extra?: Buffer[]; after?: Buffer } = {},
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const rows = Buffer.alloc((side + 1) * side, 0x80);
  for (let y = 0; y < side; y++) rows[y * (side + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    ...(options.text
      ? [
          pngChunk('tEXt', Buffer.from(`Comment\0${SECRET}`, 'latin1')),
          pngChunk('eXIf', Buffer.from(`MM\0*${SECRET}`, 'latin1')),
          pngChunk('tIME', Buffer.from([0x07, 0xea, 1, 2, 3, 4, 5])),
        ]
      : []),
    ...(options.extra ?? []),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
    options.after ?? Buffer.alloc(0),
  ]);
}

export { pngChunk };

function segment(marker: number, body: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}

/** A JPEG's structure: JFIF, EXIF and XMP (APP1), a comment, a frame, one scan. */
export function jpeg(side = 64, options: { exif?: boolean } = {}): Buffer {
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(side, 1);
  sof.writeUInt16BE(side, 3);
  sof[5] = 1;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    ...(options.exif
      ? [
          segment(0xe1, Buffer.from(`Exif\0\0${SECRET}`, 'latin1')),
          segment(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0<x>${SECRET}</x>`, 'latin1')),
          segment(0xed, Buffer.from(`Photoshop 3.0\0${SECRET}`, 'latin1')),
          segment(0xfe, Buffer.from(SECRET, 'latin1')),
        ]
      : []),
    segment(0xdb, Buffer.alloc(65, 1)),
    segment(0xc0, sof.subarray(0, 9)),
    segment(0xc4, Buffer.alloc(20, 0)),
    segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    // Entropy-coded data, with a stuffed FF00 and a restart marker in it.
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function riffChunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(type, 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

/** A WebP with an extended header saying EXIF and XMP follow, and both of them. */
export function webp(side = 64, options: { exif?: boolean; animated?: boolean } = {}): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = (options.exif ? 0x0c : 0) | (options.animated ? 0x02 : 0);
  vp8x.writeUIntLE(side - 1, 4, 3);
  vp8x.writeUIntLE(side - 1, 7, 3);
  const vp8l = Buffer.alloc(9);
  vp8l[0] = 0x2f;
  vp8l.writeUInt32LE(((side - 1) & 0x3fff) | (((side - 1) & 0x3fff) << 14), 1);
  const body = Buffer.concat([
    riffChunk('VP8X', vp8x),
    riffChunk('VP8L', vp8l),
    ...(options.exif
      ? [
          riffChunk('EXIF', Buffer.from(`MM\0*${SECRET}`, 'latin1')),
          riffChunk('XMP ', Buffer.from(`<x>${SECRET}</x>`, 'latin1')),
        ]
      : []),
  ]);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

/** Whether these bytes still say where or by whom. */
export const carriesSecret = (bytes: Buffer) => bytes.includes(Buffer.from('52.5200N', 'latin1'));
