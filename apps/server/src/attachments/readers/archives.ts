import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Attachment, AttachmentView, AttachmentViewPart } from '@conch/protocol';
import { z } from 'zod';

import { runWorker, WorkerFailed } from '../../files/worker';
import { findExecutable } from '../../lib/proc';
import { cleanName, extension, sniff } from '../sniff';
import type { Reader, ReaderInput, ReaderResult } from './types';

/**
 * Archives (ADR 0017 § "Archives"): what's inside a ZIP, a tarball, a gzip,
 * zstd, bzip2 or xz file, a 7-Zip, RAR, CAB or XAR archive, for every model.
 * A listing (path, size, when it changed), then the words of its most useful
 * small text files (README, manifests, source) and of a document or two
 * inside, read by the other readers.
 *
 * Nothing is unpacked to disk. ZIP, tar, gzip and zstd are read in the
 * sealed worker (`files/archive-worker.mjs`: bytes on stdin, no file system
 * or subprocess permission), under limits on entries, expanded bytes and
 * ratio. Formats Node can't expand are turned into a plain stream by a
 * program this computer has (`bzip2`/`xz` to decompress; `bsdtar` to turn a
 * 7-Zip, RAR, CAB or XAR archive into a tar stream), which the worker then
 * reads. Those programs get the bytes on stdin, an empty environment and an
 * empty private folder, and on macOS run in a sandbox with no network, no
 * writes and none of the person's files; bsdtar is only ever given an
 * archive whose own binary signature says what it is, since it would
 * otherwise read an mtree text as a list of files on this computer to pack.
 */

export type ArchiveFormat =
  'zip' | 'gzip' | 'zstd' | 'tar' | 'bzip2' | 'xz' | '7z' | 'rar' | 'cab' | 'xar';

/** Programs that open what Node can't. Each optional: without one, that format is only named. */
export interface ArchivePrograms {
  bsdtar?: string;
  bzip2?: string;
  xz?: string;
}

export interface ArchiveDeps {
  /** Where the programs are; tests give their own (or none). */
  programs?: () => Promise<ArchivePrograms>;
}

const ZIP_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
  'application/java-archive',
  'application/vnd.android.package-archive',
]);
/** ZIPs by another name, that are listed as archives (not EPUB or Office files, which other readers own). */
const ZIP_KINDS: Record<string, string> = {
  zip: 'ZIP archive',
  jar: 'Java archive (JAR, a ZIP)',
  war: 'Java web archive (WAR, a ZIP)',
  ear: 'Java enterprise archive (EAR, a ZIP)',
  aar: 'Android library (AAR, a ZIP)',
  apk: 'Android app (APK, a ZIP)',
  ipa: 'iPhone app (IPA, a ZIP)',
  whl: 'Python wheel (a ZIP)',
  nupkg: 'NuGet package (a ZIP)',
  xpi: 'browser extension (XPI, a ZIP)',
  vsix: 'Visual Studio extension (VSIX, a ZIP)',
};
/** ZIPs that are documents, books or drawings: other readers (or none) take them, never this one. */
const OTHER_ZIPS = new Set(
  'epub docx xlsx pptx docm xlsm pptm odt ods odp odg xps oxps kmz key pages numbers sketch 3mf vsdx'.split(
    ' ',
  ),
);
/** Formats handed to bsdtar: each has a binary signature, so it can't be taken for an mtree list. */
const VIA_BSDTAR = new Set<ArchiveFormat>(['7z', 'rar', 'cab', 'xar']);

const bytesAt = (b: Buffer, offset: number, values: readonly number[]) =>
  b.length >= offset + values.length && values.every((v, i) => b[offset + i] === v);
const textAt = (b: Buffer, offset: number, text: string) =>
  b.length >= offset + text.length &&
  b.subarray(offset, offset + text.length).toString('latin1') === text;

/** What kind of archive this is, from its first bytes (and, for a ZIP, its name or type). */
export function archiveFormat(attachment: Attachment, head: Buffer): ArchiveFormat | undefined {
  if (attachment.kind !== 'file') return undefined;
  if (textAt(head, 0, 'PK\x03\x04') || textAt(head, 0, 'PK\x05\x06'))
    return extension(attachment.name) in ZIP_KINDS ||
      (ZIP_TYPES.has(attachment.mimeType) && !OTHER_ZIPS.has(extension(attachment.name)))
      ? 'zip'
      : undefined;
  if (bytesAt(head, 0, [0x1f, 0x8b, 0x08])) return 'gzip';
  if (bytesAt(head, 0, [0x28, 0xb5, 0x2f, 0xfd])) return 'zstd';
  if (bytesAt(head, 0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return 'xz';
  if (
    /^BZh[1-9]$/.test(head.subarray(0, 4).toString('latin1')) &&
    (bytesAt(head, 4, [0x31, 0x41, 0x59, 0x26, 0x53, 0x59]) ||
      bytesAt(head, 4, [0x17, 0x72, 0x45, 0x38, 0x50, 0x90]))
  )
    return 'bzip2';
  if (bytesAt(head, 0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return '7z';
  if (textAt(head, 0, 'Rar!\x1a\x07')) return 'rar';
  if (textAt(head, 0, 'MSCF\0\0\0\0')) return 'cab';
  if (textAt(head, 0, 'xar!')) return 'xar';
  if (textAt(head, 257, 'ustar') || (extension(attachment.name) === 'tar' && tarChecksum(head)))
    return 'tar';
  return undefined;
}

function tarChecksum(h: Buffer): boolean {
  if (h.length < 512) return false;
  const stored = parseInt(h.subarray(148, 156).toString('latin1').replace(/\0.*$/s, '').trim(), 8);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : (h[i] ?? 0);
  return stored === sum;
}

// ── Programs ────────────────────────────────────────────────────────────────

let found: Promise<ArchivePrograms> | undefined;

/** bsdtar ships with macOS (as `tar` too) and Windows 10+ (`tar.exe`); Linux has it as `bsdtar`. */
export function archivePrograms(): Promise<ArchivePrograms> {
  found ??= (async () => {
    const windowsTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    const bsdtar =
      platform() === 'darwin' && existsSync('/usr/bin/bsdtar')
        ? '/usr/bin/bsdtar'
        : platform() === 'win32' && existsSync(windowsTar)
          ? windowsTar
          : await findExecutable('bsdtar');
    const [bzip2, xz] = await Promise.all([findExecutable('bzip2'), findExecutable('xz')]);
    return { bsdtar, bzip2, xz };
  })().catch(() => ({}));
  return found;
}

/** macOS: no network, no writes, none of the person's files or the system's settings. */
const SANDBOX =
  '(version 1)(allow default)(deny network*)(deny file-write*)' +
  '(deny file-read* (subpath "/Users") (subpath "/private") (subpath "/Volumes") (subpath "/etc")' +
  ' (subpath "/var") (subpath "/tmp") (subpath "/opt") (subpath "/Applications") (subpath "/Library"))';

/** Most bytes a program may hand back: past it, the rest is said to be left out. */
const PIPE_MAX = 48 * 1024 * 1024;

interface Piped {
  out: Buffer;
  /** It had more to say than `PIPE_MAX`. */
  cut: boolean;
  ok: boolean;
}

/**
 * Bytes through a program, to stdout, in an empty private folder that's then
 * removed. `seek`: the program needs a file it can seek in (7-Zip keeps its
 * index at the end), so the bytes are written there as `archive`, under a
 * name of Conch's choosing, and `@archive` in `args` names it.
 */
async function pipe(
  file: string,
  args: readonly string[],
  input: Buffer,
  signal: AbortSignal,
  seek = false,
): Promise<Piped> {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'conch-archive-')));
  try {
    if (seek) await writeFile(join(cwd, 'archive'), input, { mode: 0o600 });
    // The sandbox may read only that folder; a folder name it can't quote safely gets none.
    const own = seek && /^[\w/.-]+$/.test(cwd) ? `(allow file-read* (subpath "${cwd}"))` : '';
    const sandboxed = platform() === 'darwin' && existsSync('/usr/bin/sandbox-exec');
    const [command, argv] = sandboxed
      ? ['/usr/bin/sandbox-exec', ['-p', SANDBOX + own, file, ...args]]
      : [file, [...args]];
    const env: Record<string, string> =
      platform() === 'win32'
        ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' }
        : { LC_ALL: 'C.UTF-8' };
    const child = spawn(command, argv, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let cut = false;
    const stop = () => child.kill('SIGKILL');
    const timer = setTimeout(stop, 30_000).unref();
    signal.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      if (cut) return;
      const room = PIPE_MAX - size;
      chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
      size += Math.min(chunk.length, room);
      if (size >= PIPE_MAX) {
        cut = true;
        stop();
      }
    });
    child.stdin.on('error', () => {});
    const code = await new Promise<number | null>((done) => {
      child.once('error', () => done(null));
      child.once('close', (exit) => done(exit));
      child.stdin.end(seek ? undefined : input);
    });
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
    const out = Buffer.concat(chunks);
    // An empty tar (only its closing zeros) from a program that failed is nothing at all.
    const empty = !out.some((b) => b !== 0);
    return { out: empty && code !== 0 ? Buffer.alloc(0) : out, cut, ok: code === 0 || cut };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

// ── The worker ─────────────────────────────────────────────────────────────

const Entry = z.object({
  path: z.string(),
  size: z.number().nonnegative(),
  mtime: z.number().nullable(),
  type: z.enum(['file', 'dir', 'link', 'other']),
  unsafe: z.boolean(),
  encrypted: z.boolean(),
});
type Entry = z.infer<typeof Entry>;

const Listed = z.object({
  format: z.string(),
  entries: z.array(Entry),
  total: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  filled: z.number().int().nonnegative(),
  dirs: z.number().int().nonnegative(),
  links: z.number().int().nonnegative(),
  unsafe: z.number().int().nonnegative(),
  encrypted: z.number().int().nonnegative(),
  unsupported: z.number().int().nonnegative(),
  bytes: z.number().nonnegative(),
  incomplete: z.boolean(),
  expanded: z.number().nonnegative(),
  texts: z.array(z.object({ path: z.string(), text: z.string(), cut: z.boolean() })),
  documents: z.array(z.object({ path: z.string(), data: z.string() })),
  skippedText: z.number().int().nonnegative(),
  binary: z.number().int().nonnegative(),
});
export type Listed = z.infer<typeof Listed>;

/** What's inside, read in the sealed worker. Throws a plain sentence when it can't be read. */
export async function listArchive(
  bytes: Buffer,
  options: {
    name: string;
    room: number;
    docs: boolean;
    signal: AbortSignal;
    /** Already expanded by a program: a tar stream or one file. */
    inner?: boolean;
    truncated?: boolean;
  },
): Promise<Listed> {
  const output = await runWorker({
    worker: './archive-worker.mjs',
    modules: [],
    input: JSON.stringify({
      data: bytes.toString('base64'),
      name: options.name,
      room: options.room,
      docs: options.docs,
      inner: options.inner ?? false,
      truncated: options.truncated ?? false,
    }),
    signal: options.signal,
    timeoutMs: 45_000,
    maxOutput: 30_000_000,
    heapMb: 384,
  }).catch((error: unknown) => {
    if (error instanceof WorkerFailed && error.reason === 'timeout')
      throw new Error('Looking inside it took too long.');
    if (error instanceof WorkerFailed)
      throw new Error('It went past the limits Conch reads archives within.');
    throw error;
  });
  const value = z
    .object({ result: Listed.optional(), error: z.string().optional() })
    .parse(JSON.parse(output));
  if (!value.result) throw new Error(value.error ?? 'It could not be read.');
  return value.result;
}

// ── Words for the model ────────────────────────────────────────────────────

function size(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

function when(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '';
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 16).replace('T', ' ');
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

function label(format: ArchiveFormat, listed: Listed | undefined, name: string): string {
  const ext = extension(name);
  const tarred = listed?.format === 'tar';
  switch (format) {
    case 'zip':
      return ZIP_KINDS[ext] ?? 'ZIP archive';
    case 'gzip':
      return ext === 'crate'
        ? 'Rust crate (a gzip-compressed tar archive)'
        : tarred
          ? 'gzip-compressed tar archive'
          : 'gzip-compressed file';
    case 'zstd':
      return tarred ? 'zstd-compressed tar archive' : 'zstd-compressed file';
    case 'bzip2':
      return tarred ? 'bzip2-compressed tar archive' : 'bzip2-compressed file';
    case 'xz':
      return tarred ? 'xz-compressed tar archive' : 'xz-compressed file';
    case 'tar':
      return 'tar archive';
    case '7z':
      return '7-Zip archive';
    case 'rar':
      return 'RAR archive';
    case 'cab':
      return 'Windows cabinet (CAB) archive';
    case 'xar':
      return 'XAR archive (a macOS installer package or similar)';
  }
}

const article = (words: string) => (/^[aeiou]/i.test(words) ? 'An' : 'A');

function line(entry: Entry): string {
  if (entry.type === 'dir') return entry.path.endsWith('/') ? entry.path : `${entry.path}/`;
  const flags = [
    entry.type === 'link' && 'link, not followed',
    entry.type === 'other' && 'special entry, ignored',
    entry.unsafe && 'unsafe name: it points outside the archive, not read',
    entry.encrypted && 'locked with a password',
  ].filter(Boolean);
  const parts = [entry.path];
  if (entry.type === 'file') parts.push(size(entry.size));
  const date = when(entry.mtime);
  if (date) parts.push(date);
  if (flags.length) parts.push(`[${flags.join('; ')}]`);
  return parts.join('  ');
}

/** The tree, sorted by path, as many lines as fit in `room` characters. */
function tree(listed: Listed, room: number): { text: string; shown: number } {
  const entries = [...listed.entries].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const lines: string[] = [];
  let used = 0;
  for (const entry of entries) {
    const next = line(entry);
    if (used + next.length + 1 > room) break;
    lines.push(next);
    used += next.length + 1;
  }
  const rest = listed.total - lines.length;
  if (rest > 0) lines.push(`… and ${plural(rest, 'more entry', 'more entries')}, not listed.`);
  return { text: lines.join('\n'), shown: lines.length - (rest > 0 ? 1 : 0) };
}

interface Nested {
  path: string;
  note: string;
  text?: string;
  images: NonNullable<ReaderResult['images']>;
}

/**
 * A document inside (a PDF, a DOCX) read by the other readers, never this
 * one, so an archive inside an archive is only listed. It's written to a
 * fresh private folder under a name of Conch's choosing, and removed.
 */
async function readNested(
  input: ReaderInput,
  path: string,
  bytes: Buffer,
  room: number,
): Promise<Nested | undefined> {
  const { READERS } = await import('./index');
  const name = cleanName(path.split('/').at(-1) ?? 'file');
  const sniffed = sniff(bytes, name, undefined);
  if (sniffed.kind !== 'file') return undefined;
  const attachment: Attachment = {
    id: input.attachment.id,
    name,
    mimeType: sniffed.mimeType,
    size: bytes.length,
    kind: 'file',
    createdAt: input.attachment.createdAt,
  };
  const head = bytes.subarray(0, 4096);
  const reader = READERS.find((r) => r.id !== archives.id && r.matches(attachment, head));
  if (!reader) return undefined;
  const dir = await mkdtemp(join(tmpdir(), 'conch-archive-'));
  try {
    const ext = extension(name);
    const file = join(dir, /^[a-z0-9]{1,10}$/.test(ext) ? `member.${ext}` : 'member');
    await writeFile(file, bytes, { mode: 0o600 });
    const result = await reader
      .read({
        ...input,
        attachment,
        bytes,
        path: file,
        room,
        // The model can't open a member by path or id: only what's said here reaches it.
        can: { ...input.can, files: false, tools: false, pdfs: false, opensPdfs: false },
      })
      .catch(() => undefined);
    if (!result) return undefined;
    return {
      path,
      note: result.note,
      text: result.text?.slice(0, room),
      images: result.images ?? [],
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** What a model that can't look inside by itself still needs to hear. */
function nothingToOpen(what: string, attachment: Attachment, input: ReaderInput): ReaderResult {
  const own = input.can.files
    ? ' It is at the path above: unpack it with your own tools (7z x, unrar or bsdtar -xf) into a new, empty folder in the work folder if the message needs what is inside.'
    : ' If the message depends on what is inside, say so and ask for the files themselves, or for the archive as a ZIP.';
  return {
    note: `(${article(what)} ${what} of ${size(attachment.size)}. This computer has nothing Conch can open it with, so only its name and size are known.${own})`,
    more: true,
  };
}

async function read(input: ReaderInput): Promise<ReaderResult | undefined> {
  const { attachment, bytes, can, signal } = input;
  const format = archiveFormat(attachment, bytes.subarray(0, 4096));
  if (!format) return undefined;
  // An engine that opens files gets a short look (it can unpack the rest itself); the others, more.
  const room = can.files ? Math.min(input.room, 12_000) : input.room;
  const listRoom = Math.max(1_500, Math.min(Math.floor(room * 0.35), 20_000));
  const docs = !can.files;

  let source = bytes;
  let inner = false;
  let truncated = false;
  if (VIA_BSDTAR.has(format) || format === 'bzip2' || format === 'xz') {
    const programs = await (input.deps.archives?.programs ?? archivePrograms)();
    const tool = VIA_BSDTAR.has(format)
      ? programs.bsdtar
      : format === 'bzip2'
        ? programs.bzip2
        : programs.xz;
    if (!tool) return nothingToOpen(label(format, undefined, attachment.name), attachment, input);
    const via = VIA_BSDTAR.has(format);
    const args = via ? ['-c', '-f', '-', '--format', 'pax', '@archive'] : ['-d', '-c'];
    const piped = await pipe(tool, args, bytes, signal, via);
    if (!piped.ok && !piped.out.length)
      return {
        note: `(${article(label(format, undefined, attachment.name))} ${label(format, undefined, attachment.name)} of ${size(attachment.size)} Conch couldn't open: it may be locked with a password, damaged or of a newer kind.${can.files ? ' Try your own tools on the path above, into a new, empty folder in the work folder.' : ' If the message depends on it, say so and ask for an unlocked copy or a ZIP.'})`,
        more: true,
      };
    source = piped.out;
    inner = true;
    truncated = piped.cut || !piped.ok;
  }

  const what = (listed?: Listed) => label(format, listed, attachment.name);
  let listed: Listed;
  try {
    listed = await listArchive(source, {
      name: attachment.name,
      room: Math.max(0, room - listRoom),
      docs,
      signal,
      inner,
      truncated,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'It could not be read.';
    return {
      note: `(${article(what())} ${what()} Conch couldn't look inside. ${reason}${can.files ? ' Your own tools may do better with the path above.' : ' If the message depends on it, say so and ask for it again.'})`,
      more: true,
    };
  }

  const kind = what(listed);
  const single = listed.format === 'single';
  const listing = tree(listed, listRoom);
  let text = single ? '' : `Inside:\n${listing.text}`;
  for (const t of listed.texts)
    text += `\n\n--- ${t.path} ---\n${t.text}${t.cut ? '\n[Cut off here.]' : ''}`;

  // A document or two inside, through the other readers.
  const images: Nested['images'] = [];
  let readDocs = 0;
  for (const doc of listed.documents) {
    const left = room - text.length - 200;
    if (left < 2_000) break;
    const nested = await readNested(
      input,
      doc.path,
      Buffer.from(doc.data, 'base64'),
      Math.min(left, 30_000),
    ).catch(() => undefined);
    if (!nested) continue;
    readDocs++;
    text += `\n\n--- ${nested.path} ---\n${nested.note}${nested.text ? `\n${nested.text}` : ''}`;
    images.push(...nested.images);
  }

  // What was left out, in a sentence.
  const shownFiles = listed.texts.length + readDocs;
  const out: string[] = [];
  if (listed.incomplete)
    out.push(
      listed.total
        ? 'the archive goes on past what Conch reads (it is very large, cut short or damaged), so the list may be incomplete'
        : 'it stops early',
    );
  if (listing.shown < listed.total && !single)
    out.push(`${plural(listed.total - listing.shown, 'entry', 'entries')} not listed`);
  const unread = Math.max(0, listed.filled - shownFiles - listed.encrypted - listed.unsafe);
  if (unread && !single) out.push(`the contents of ${plural(unread, 'file')}`);
  if (listed.links) out.push(`${plural(listed.links, 'link')} (never followed)`);
  if (listed.unsafe)
    out.push(
      listed.unsafe === 1
        ? '1 entry whose name points outside the archive (not read)'
        : `${plural(listed.unsafe, 'entry', 'entries')} whose names point outside the archive (not read)`,
    );
  if (listed.encrypted) out.push(`${plural(listed.encrypted, 'file')} locked with a password`);
  const more = out.length > 0;

  const how = !more
    ? ''
    : can.files
      ? ' To work with the rest, unpack it with your own tools into a new, empty folder in the work folder (unzip, tar -xf or 7z x), and check the names first: nothing may land outside that folder.'
      : can.tools && format === 'zip'
        ? ` For a file not shown, use file_unzip with source "${attachment.id}": it unpacks up to 50 files into this chat, and read_file or read_document reads each by its id.`
        : ' If the message depends on a file not shown, say so and ask for that file.';

  const counts = single
    ? `${size(listed.bytes || listed.expanded)} once expanded`
    : `${plural(listed.files, 'file')}${listed.dirs ? ` in ${plural(listed.dirs, 'folder')}` : ''}, ${size(listed.bytes)} unpacked`;
  const shownWhat = single
    ? listed.texts.length || readDocs
      ? 'what it holds is below'
      : 'what it holds is not text Conch can show'
    : shownFiles
      ? `the list of what's inside is below, then the text of ${plural(shownFiles, 'file')}`
      : "the list of what's inside is below";
  const left = more ? ` Left out: ${out.join('; ')}.` : '';
  const note = `(${article(kind)} ${kind} with ${counts}. Conch looked inside without unpacking it: ${shownWhat}.${left}${how})`;

  const parts: AttachmentViewPart[] = [];
  if (!single)
    parts.push({
      kind: 'tree',
      title: 'Contents',
      entries: [...listed.entries]
        .sort((a, b) => a.path.localeCompare(b.path, 'en'))
        .slice(0, 10_000)
        .map((e) => ({
          path: e.path,
          ...(e.type === 'file' && { size: Math.floor(e.size) }),
          ...(e.type === 'dir' && { folder: true }),
        })),
      total: listed.total,
    });
  for (const t of listed.texts.slice(0, 20))
    parts.push({
      kind: 'text',
      title: t.path,
      blocks: [{ kind: 'pre', text: t.text.slice(0, 40_000) }],
    });
  const view: AttachmentView = {
    summary: `${article(kind)} ${kind} with ${counts}.`.slice(0, 600),
    parts,
    ...(more && { more: true }),
  };

  return { note, text: text.trim().slice(0, room), ...(images.length && { images }), more, view };
}

/** Archives, listed and read inside without unpacking, for every engine (it's cheap and helps all). */
export const archives: Reader = {
  id: 'archives',
  everywhere: true,
  matches: (attachment, head) => archiveFormat(attachment, head) !== undefined,
  read,
};
