/**
 * Just enough tar to carry a work folder to a machine and back (ADR 0106):
 * regular files and folders, long names (PAX and GNU), gzip. Written here
 * rather than taken from the system's `tar` because what comes back is
 * untrusted: the reader only *lists* entries, and `mirror.ts` decides, path by
 * path, what may land in the work folder. Links and devices are never made.
 */
import { gunzipSync, gzipSync } from 'node:zlib';

export interface TarFile {
  path: string;
  data: Buffer;
  /** Permission bits; only the executable bit is kept on the way back. */
  mode: number;
  /** Seconds since 1970. */
  mtime: number;
}

export interface TarEntry {
  path: string;
  type: 'file' | 'dir' | 'link' | 'other';
  data: Buffer;
  mode: number;
  mtime: number;
}

const BLOCK = 512;

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function header(name: string, size: number, mode: number, mtime: number, type: string): Buffer {
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, 100, 'utf8');
  block.write(octal(mode & 0o7777, 8), 100, 'ascii');
  block.write(octal(0, 8), 108, 'ascii');
  block.write(octal(0, 8), 116, 'ascii');
  block.write(octal(size, 12), 124, 'ascii');
  block.write(octal(Math.max(0, Math.floor(mtime)), 12), 136, 'ascii');
  block.fill(' ', 148, 156);
  block.write(type, 156, 'ascii');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(octal(sum, 7) + ' ', 148, 'ascii');
  return block;
}

const pad = (size: number) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

/** A PAX record: "<len> path=<value>\n", where <len> counts itself. */
function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 1;
  while (String(length).length + Buffer.byteLength(body) !== length)
    length = String(length).length + Buffer.byteLength(body);
  return Buffer.from(`${length}${body}`, 'utf8');
}

/** Files into a gzipped tar. */
export function packTar(files: readonly TarFile[]): Buffer {
  const parts: Buffer[] = [];
  for (const file of files) {
    let name = file.path;
    if (Buffer.byteLength(name) > 99) {
      const pax = paxRecord('path', name);
      parts.push(
        header('././@PaxHeader', pax.length, 0o644, file.mtime, 'x'),
        pax,
        pad(pax.length),
      );
      name = name.slice(-90).replace(/^\/+/, '');
    }
    parts.push(header(name, file.data.length, file.mode, file.mtime, '0'), file.data);
    parts.push(pad(file.data.length));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(parts));
}

function readNumber(field: Buffer): number {
  // GNU base-256 for big values: the first byte's top bit is set.
  if (field.length && (field[0] ?? 0) & 0x80) {
    let value = 0;
    for (let i = 1; i < field.length; i++) value = value * 256 + (field[i] ?? 0);
    return value;
  }
  const text = field.toString('ascii').replace(/\0.*$/s, '').trim();
  return text ? parseInt(text, 8) : 0;
}

const text = (field: Buffer) => field.toString('utf8').replace(/\0.*$/s, '');

function paxPath(data: Buffer): string | undefined {
  let at = 0;
  const all = data.toString('utf8');
  while (at < all.length) {
    const space = all.indexOf(' ', at);
    if (space < 0) break;
    const length = parseInt(all.slice(at, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = all.slice(space + 1, at + length - 1);
    if (record.startsWith('path=')) return record.slice(5);
    at += length;
  }
  return undefined;
}

/**
 * The entries of a (gzipped) tar, at most `maxBytes` once unpacked. Throws on
 * a damaged archive rather than guessing.
 */
export function readTar(gzipped: Buffer, maxBytes = 1024 ** 3): TarEntry[] {
  const raw = gunzipSync(gzipped, { maxOutputLength: maxBytes });
  const entries: TarEntry[] = [];
  let at = 0;
  let longName: string | undefined;
  while (at + BLOCK <= raw.length) {
    const block = raw.subarray(at, at + BLOCK);
    if (block.every((byte) => byte === 0)) break;
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : (block[i] ?? 0);
    if (sum !== readNumber(block.subarray(148, 156))) throw new Error('The archive is damaged.');
    const size = readNumber(block.subarray(124, 136));
    const flag = String.fromCharCode(block[156] ?? 0);
    const start = at + BLOCK;
    if (start + size > raw.length) throw new Error('The archive is cut short.');
    const data = raw.subarray(start, start + size);
    at = start + size + ((BLOCK - (size % BLOCK)) % BLOCK);
    if (flag === 'x') {
      longName = paxPath(data) ?? longName;
      continue;
    }
    if (flag === 'L') {
      longName = text(data);
      continue;
    }
    if (flag === 'g') continue;
    const prefix = block.subarray(257, 263).toString('ascii').startsWith('ustar')
      ? text(block.subarray(345, 500))
      : '';
    const name =
      longName ??
      (prefix ? `${prefix}/${text(block.subarray(0, 100))}` : text(block.subarray(0, 100)));
    longName = undefined;
    entries.push({
      path: name,
      type:
        flag === '0' || flag === '\0' || flag === '7'
          ? 'file'
          : flag === '5'
            ? 'dir'
            : flag === '1' || flag === '2'
              ? 'link'
              : 'other',
      data: Buffer.from(data),
      mode: readNumber(block.subarray(100, 108)),
      mtime: readNumber(block.subarray(136, 148)),
    });
  }
  return entries;
}
