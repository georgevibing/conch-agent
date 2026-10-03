/**
 * The container: a POSIX tar (ustar, with pax headers for long or non-ASCII
 * names) inside gzip — Node's own zlib, no dependency. Any `tar -xzf` opens
 * it, so a backup is never locked in Conch.
 *
 * Reading is strict because a backup can come from anywhere: only regular
 * files (never links, devices or folders), checked header sums, a size cap
 * on everything unpacked (a “zip bomb” stops at the cap), and after the end
 * nothing but a tar record's worth of zeros (a bomb of zeros after the end
 * stops there too).
 */
import { createGzip, type Gzip } from 'node:zlib';

import { BACKUP_LIMITS } from '@conch/protocol';

export type BackupErrorCode =
  | 'not-backup'
  | 'damaged'
  | 'unsafe'
  | 'too-big'
  | 'newer'
  | 'older'
  | 'needs-passphrase'
  | 'wrong-passphrase'
  | 'weak-passphrase'
  | 'local-only'
  | 'busy'
  | 'not-found'
  | 'no-space';

/** What went wrong with a backup, in one plain sentence a person can act on. */
export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const DAMAGED = 'This backup is damaged, or was changed after it was made. Try another one.';
const NOT_BACKUP = 'That file isn’t a Conch backup.';

const BLOCK = 512;
const ZEROS = Buffer.alloc(BLOCK * 2);
/**
 * Zeros allowed after the end: `tar` pads its output to a whole record of 20
 * blocks (10 KiB). Anything more is refused, and nothing past it is unpacked.
 */
export const MAX_TRAILING = 20 * BLOCK;
/** A pax header only ever carries a name here; anything bigger is refused. */
const MAX_PAX = 64 * 1024;

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

export function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 1;
  while (String(length).length + Buffer.byteLength(body) !== length) length++;
  return Buffer.from(`${length}${body}`, 'utf8');
}

/** One 512-byte ustar header. Exported for tests that build hostile archives by hand. */
export function tarHeader(name: string, size: number, type: string, mtime = 0): Buffer {
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, 100, 'utf8');
  block.write(octal(0o600, 8), 100, 'ascii');
  block.write(octal(0, 8), 108, 'ascii');
  block.write(octal(0, 8), 116, 'ascii');
  block.write(octal(size, 12), 124, 'ascii');
  block.write(octal(Math.max(0, Math.floor(mtime / 1000)), 12), 136, 'ascii');
  block.write('        ', 148, 'ascii');
  block.write(type, 156, 'ascii');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return block;
}

export const padding = (size: number) => (BLOCK - (size % BLOCK)) % BLOCK;

/** Writes a tar.gz entry by entry, waiting whenever the output is full. */
export class TarWriter {
  readonly gzip: Gzip = createGzip({ level: 6 });

  async #write(chunk: Buffer): Promise<void> {
    if (!this.gzip.write(chunk))
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          this.gzip.off('error', fail);
          resolve();
        };
        const fail = (error: Error) => {
          this.gzip.off('drain', done);
          reject(error);
        };
        this.gzip.once('drain', done);
        this.gzip.once('error', fail);
      });
  }

  async add(name: string, data: Buffer, mtime = Date.now()): Promise<void> {
    // Plain ASCII under 100 bytes fits the classic header; anything else gets a pax name.
    const simple = /^[\x20-\x7e]*$/.test(name) && name.length < 100;
    if (!simple) {
      const pax = paxRecord('path', name);
      await this.#write(tarHeader('PaxHeader', pax.length, 'x', mtime));
      await this.#write(Buffer.concat([pax, Buffer.alloc(padding(pax.length))]));
    }
    await this.#write(tarHeader(simple ? name : 'long-name', data.length, '0', mtime));
    await this.#write(data);
    const pad = padding(data.length);
    if (pad) await this.#write(Buffer.alloc(pad));
  }

  async end(): Promise<void> {
    await this.#write(ZEROS);
    this.gzip.end();
  }
}

export interface TarEntry {
  name: string;
  size: number;
}

/** Where an entry's bytes go, chunk by chunk. */
export interface EntrySink {
  write(chunk: Buffer): void | Promise<void>;
  end(): void | Promise<void>;
}

/**
 * - a sink: the entry's bytes go there;
 * - `skip`: its bytes are read past;
 * - `stop`: that's all the reader wanted (the header, for a list).
 */
export type Visit = EntrySink | 'skip' | 'stop';

function field(block: Buffer, start: number, length: number): string {
  const raw = block.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString('utf8');
}

function number(block: Buffer, start: number, length: number): number {
  // Base-256 sizes (a leading 0x80) are for files over 8 GB: never in a backup.
  if ((block[start] ?? 0) & 0x80) throw new BackupError('too-big', DAMAGED);
  const text = field(block, start, length).trim();
  if (!/^[0-7]*$/.test(text)) throw new BackupError('damaged', DAMAGED);
  return text ? parseInt(text, 8) : 0;
}

function checksumOk(block: Buffer): boolean {
  const stored = number(block, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (block[i] ?? 0);
  return sum === stored;
}

function parsePax(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) throw new BackupError('damaged', DAMAGED);
    const length = Number(data.subarray(offset, space).toString('ascii'));
    if (!Number.isInteger(length) || length <= 0 || offset + length > data.length)
      throw new BackupError('damaged', DAMAGED);
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq === -1) throw new BackupError('damaged', DAMAGED);
    out[record.slice(0, eq)] = record.slice(eq + 1);
    offset += length;
  }
  return out;
}

export interface ReadLimits {
  maxUnpackedBytes?: number;
  maxFileBytes?: number;
  maxFiles?: number;
  /** Free space for what's unpacked: past it, `no-space` (the disk, not the backup). */
  roomBytes?: number;
}

/**
 * What else a reader may pass over, for archives that aren't backups (a
 * Conch app from GitHub, ADR 0061): `git archive` writes a pax global header
 * (the commit) and an entry for every folder. Neither is ever unpacked.
 */
export interface ReadOptions {
  skipFolders?: boolean;
  skipGlobalHeaders?: boolean;
}

export const NO_ROOM =
  'There isn’t enough free space on this computer to restore this backup. Free up some space, then try again.';

/**
 * Read a tar from gunzipped chunks, handing each regular file to `visit`.
 * Throws `BackupError` on anything that isn't a plain file, a bad header, a
 * cut-off archive, or more than the limits allow.
 */
export async function readTar(
  source: AsyncIterable<Buffer>,
  visit: (entry: TarEntry) => Visit | Promise<Visit>,
  limits: ReadLimits = {},
  options: ReadOptions = {},
): Promise<void> {
  const maxUnpacked = limits.maxUnpackedBytes ?? BACKUP_LIMITS.maxUnpackedBytes;
  const maxFile = limits.maxFileBytes ?? BACKUP_LIMITS.maxFileBytes;
  const maxFiles = limits.maxFiles ?? BACKUP_LIMITS.maxFiles;
  let unpacked = 0;
  let files = 0;
  let head = Buffer.alloc(0);
  let pax: { data: Buffer[]; remaining: number } | undefined;
  let nextName: string | undefined;
  let zeros = 0;
  let ended = false;
  let trailing = 0;
  type State =
    | { kind: 'header' }
    | { kind: 'data'; remaining: number; pad: number; sink?: EntrySink }
    | { kind: 'pax'; remaining: number; pad: number }
    | { kind: 'skip'; remaining: number };
  // Cast so the reads below don't narrow to the first value: `onHeader` changes it too.
  let state = { kind: 'header' } as State;

  const onHeader = async (block: Buffer): Promise<'stop' | undefined> => {
    if (block.every((b) => b === 0)) {
      zeros++;
      if (zeros === 2) ended = true;
      return undefined;
    }
    if (zeros) throw new BackupError('damaged', DAMAGED);
    if (field(block, 257, 5) !== 'ustar' || !checksumOk(block))
      throw new BackupError('not-backup', NOT_BACKUP);
    const type = String.fromCharCode(block[156] ?? 0);
    const size = number(block, 124, 12);
    if (type === 'x') {
      if (size > MAX_PAX) throw new BackupError('damaged', DAMAGED);
      state = { kind: 'pax', remaining: size, pad: padding(size) };
      pax = { data: [], remaining: size };
      if (size === 0) state = { kind: 'header' };
      return undefined;
    }
    if (type === 'g' && options.skipGlobalHeaders) {
      if (size > MAX_PAX) throw new BackupError('damaged', DAMAGED);
      state = size ? { kind: 'skip', remaining: size + padding(size) } : { kind: 'header' };
      return undefined;
    }
    if (type === '5' && options.skipFolders) {
      nextName = undefined;
      if (++files > maxFiles) throw new BackupError('too-big', 'This backup holds too many files.');
      state = size ? { kind: 'skip', remaining: size + padding(size) } : { kind: 'header' };
      return undefined;
    }
    if (type === '1' || type === '2')
      throw new BackupError('unsafe', 'This backup holds a link, which Conch never restores.');
    if (type !== '0' && type !== '\0')
      throw new BackupError('unsafe', 'This backup holds something other than files.');
    const prefix = field(block, 345, 155);
    const name = nextName ?? (prefix ? `${prefix}/${field(block, 0, 100)}` : field(block, 0, 100));
    nextName = undefined;
    if (++files > maxFiles) throw new BackupError('too-big', 'This backup holds too many files.');
    if (size > maxFile) throw new BackupError('too-big', 'A file in this backup is too big.');
    unpacked += size;
    if (unpacked > maxUnpacked)
      throw new BackupError('too-big', 'This backup is bigger than Conch restores.');
    if (limits.roomBytes !== undefined && unpacked > limits.roomBytes)
      throw new BackupError('no-space', NO_ROOM);
    const got = await visit({ name, size });
    if (got === 'stop') return 'stop';
    const sink = got === 'skip' ? undefined : got;
    if (size === 0) {
      await sink?.end();
      state = { kind: 'header' };
    } else state = { kind: 'data', remaining: size, pad: padding(size), sink };
    return undefined;
  };

  for await (const chunk of source) {
    let offset = 0;
    while (offset < chunk.length) {
      if (ended) {
        // Only a record's padding of zeros may follow the end: nothing is
        // hidden after it, and a bomb of zeros isn't unpacked past it.
        const rest = chunk.subarray(offset);
        trailing += rest.length;
        if (trailing > MAX_TRAILING || rest.some((b) => b !== 0))
          throw new BackupError('damaged', DAMAGED);
        offset = chunk.length;
        break;
      }
      if (state.kind === 'header') {
        const take = Math.min(BLOCK - head.length, chunk.length - offset);
        head = Buffer.concat([head, chunk.subarray(offset, offset + take)]);
        offset += take;
        if (head.length === BLOCK) {
          const block = head;
          head = Buffer.alloc(0);
          if ((await onHeader(block)) === 'stop') return;
        }
      } else if (state.kind === 'data') {
        const take = Math.min(state.remaining, chunk.length - offset);
        await state.sink?.write(chunk.subarray(offset, offset + take));
        state.remaining -= take;
        offset += take;
        if (state.remaining === 0) {
          await state.sink?.end();
          state = state.pad ? { kind: 'skip', remaining: state.pad } : { kind: 'header' };
        }
      } else if (state.kind === 'pax') {
        const take = Math.min(state.remaining, chunk.length - offset);
        pax?.data.push(chunk.subarray(offset, offset + take));
        state.remaining -= take;
        offset += take;
        if (state.remaining === 0) {
          const records = parsePax(Buffer.concat(pax?.data ?? []));
          pax = undefined;
          nextName = records.path;
          state = state.pad ? { kind: 'skip', remaining: state.pad } : { kind: 'header' };
        }
      } else {
        const take = Math.min(state.remaining, chunk.length - offset);
        state.remaining -= take;
        offset += take;
        if (state.remaining === 0) state = { kind: 'header' };
      }
    }
  }
  if (!ended) throw new BackupError('damaged', DAMAGED);
}
