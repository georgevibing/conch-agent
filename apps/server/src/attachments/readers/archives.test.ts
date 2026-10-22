import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, zstdCompressSync } from 'node:zlib';

import type { Attachment } from '@conch/protocol';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sniff } from '../sniff';
import { archiveFormat, archivePrograms, archives, type ArchivePrograms } from './archives';
import type { AttachmentAbilities, ReaderDeps, ReaderResult } from './types';

const API: AttachmentAbilities = { images: false, files: false, tools: true };
const CHAT_ONLY: AttachmentAbilities = { images: false, files: false };
const OPENS_FILES: AttachmentAbilities = { images: true, files: true, tools: true };

function attachmentFor(name: string, bytes: Buffer): Attachment {
  const sniffed = sniff(bytes, name, undefined);
  return {
    id: 'att_archive1',
    name,
    mimeType: sniffed.mimeType,
    size: bytes.length,
    kind: sniffed.kind,
    createdAt: 0,
  };
}

async function readArchive(
  name: string,
  bytes: Buffer,
  can: AttachmentAbilities = API,
  deps: ReaderDeps = {},
): Promise<ReaderResult | undefined> {
  const attachment = attachmentFor(name, bytes);
  expect(archives.matches(attachment, bytes.subarray(0, 4096))).toBe(true);
  return archives.read({
    attachment,
    bytes,
    path: '/nowhere/archive',
    room: 60_000,
    can,
    deps,
    signal: AbortSignal.timeout(60_000),
  });
}

/** A ustar header and body, padded: enough tar to test with, no program needed. */
function tarEntry(name: string, body: Buffer | string, type = '0', link = ''): Buffer {
  const data = typeof body === 'string' ? Buffer.from(body) : body;
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
  h.write(`${(1_700_000_000).toString(8).padStart(11, '0')}\0`, 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write(link, 157);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([h, data, pad]);
}

function paxEntry(records: Record<string, string>, then: Buffer): Buffer {
  let body = '';
  for (const [key, value] of Object.entries(records)) {
    const rest = ` ${key}=${value}\n`;
    let length = rest.length + 2;
    while (`${length}${rest}`.length !== length) length++;
    body += `${length}${rest}`;
  }
  return Buffer.concat([tarEntry('PaxHeader', body, 'x'), then]);
}

const tarEnd = () => Buffer.alloc(1024);

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'conch-archive-test-'));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('archive formats', () => {
  it('knows archives by their bytes, and leaves document ZIPs to other readers', () => {
    const zip = Buffer.from(zipSync({ 'a.txt': strToU8('hi') }));
    expect(sniff(zip, 'download', undefined).mimeType).toBe('application/zip');
    expect(archiveFormat(attachmentFor('download', zip), zip)).toBe('zip');
    expect(archiveFormat(attachmentFor('app.jar', zip), zip)).toBe('zip');
    expect(archiveFormat(attachmentFor('book.epub', zip), zip)).toBeUndefined();
    expect(archiveFormat(attachmentFor('report.docx', zip), zip)).toBeUndefined();
    const gz = gzipSync('hello');
    expect(sniff(gz, 'blob', undefined).mimeType).toBe('application/gzip');
    expect(archiveFormat(attachmentFor('notes.txt.gz', gz), gz)).toBe('gzip');
    const seven = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4, 0, 0]);
    expect(sniff(seven, 'x', undefined).mimeType).toBe('application/x-7z-compressed');
    expect(archiveFormat(attachmentFor('x.7z', seven), seven)).toBe('7z');
    const tar = Buffer.concat([tarEntry('a.txt', 'hi'), tarEnd()]);
    expect(sniff(tar, 'stuff', undefined).mimeType).toBe('application/x-tar');
    // Text that merely starts like bzip2 is still text.
    expect(sniff(Buffer.from('BZh9 is a nice name'), 'note', undefined).kind).toBe('text');
  });
});

describe('reading archives for models', () => {
  it('lists a ZIP and shows its README and source first', async () => {
    const zip = Buffer.from(
      zipSync({
        'project/README.md': strToU8('# Widget\nIt makes widgets.'),
        'project/package.json': strToU8('{"name":"widget"}'),
        'project/src/index.ts': strToU8('export const widget = 1;'),
        'project/logo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]),
        'project/node_modules/x/index.js': strToU8('noise'),
      }),
    );
    const read = await readArchive('project.zip', zip);
    expect(read?.note).toMatch(/^\(A ZIP archive with 5 files/);
    expect(read?.text).toContain('project/README.md');
    expect(read?.text).toContain('--- project/README.md ---\n# Widget');
    expect(read?.text).toContain('{"name":"widget"}');
    expect(read?.text).toContain('export const widget = 1;');
    expect(read?.text?.indexOf('--- project/README.md')).toBeLessThan(
      read?.text?.indexOf('--- project/src/index.ts') ?? 0,
    );
    expect(read?.text).not.toContain('--- project/logo.png');
    expect(read?.note).toContain('file_unzip with source "att_archive1"');
    expect(read?.view?.parts[0]).toMatchObject({ kind: 'tree', total: 5 });
  });

  it('reads a JAR as a ZIP, with its manifest', async () => {
    const jar = Buffer.from(
      zipSync({
        'META-INF/MANIFEST.MF': strToU8('Manifest-Version: 1.0\nMain-Class: app.Main\n'),
        'app/Main.class': new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0, 0]),
      }),
    );
    const read = await readArchive('app.jar', jar);
    expect(read?.note).toContain('Java archive (JAR, a ZIP)');
    expect(read?.text).toContain('Main-Class: app.Main');
  });

  it('reads a tarball, with pax long names, and never follows a link', async () => {
    const long = `deep/${'d'.repeat(120)}/notes.md`;
    const tgz = gzipSync(
      Buffer.concat([
        tarEntry('pkg/README', 'Read me first.'),
        paxEntry({ path: long }, tarEntry('ignored-short-name', 'Long-named notes.')),
        tarEntry('pkg/passwd', '', '2', '/etc/passwd'),
        tarEntry('pkg/data.bin', Buffer.from([0, 1, 2, 3])),
        tarEnd(),
      ]),
    );
    const read = await readArchive('pkg.tar.gz', tgz);
    expect(read?.note).toMatch(/^\(A gzip-compressed tar archive with 3 files/);
    expect(read?.text).toContain('Read me first.');
    expect(read?.text).toContain(long);
    expect(read?.text).toContain('Long-named notes.');
    expect(read?.text).toContain('pkg/passwd  2023-11-14 22:13  [link, not followed]');
    expect(read?.text).not.toContain('root:');
    expect(read?.note).toContain('1 link (never followed)');
    // Not a ZIP: Conch's unzip tool can't help, and the note doesn't pretend it can.
    expect(read?.note).not.toContain('file_unzip');
  });

  it('reads one compressed file (gzip and zstd) as the file itself', async () => {
    const gz = await readArchive('notes.txt.gz', gzipSync('Meeting at noon.'));
    expect(gz?.note).toMatch(/^\(A gzip-compressed file with 16 B once expanded/);
    expect(gz?.text).toContain('Meeting at noon.');
    const zst = await readArchive('log.txt.zst', zstdCompressSync(Buffer.from('zstd words')));
    expect(zst?.text).toContain('zstd words');
  });

  it('reads a document inside through the document reader', async () => {
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
      'word/document.xml': strToU8(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Quarterly plan inside the zip</w:t></w:r></w:p></w:body></w:document>',
      ),
    });
    const zip = Buffer.from(zipSync({ 'docs/plan.docx': docx }));
    const read = await readArchive('bundle.zip', zip, CHAT_ONLY);
    expect(read?.text).toContain('--- docs/plan.docx ---');
    expect(read?.text).toContain('Quarterly plan inside the zip');
    // A chat-only model is never told to call a tool.
    expect(read?.note).not.toMatch(/file_unzip|read_document/);
  });

  it('gives an engine that opens files a short look and how to unpack the rest safely', async () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 40; i++) files[`src/file${i}.ts`] = strToU8(`// ${i}\n${'x'.repeat(2000)}`);
    const read = await readArchive('src.zip', Buffer.from(zipSync(files)), OPENS_FILES);
    expect(read?.text?.length).toBeLessThanOrEqual(12_000);
    expect(read?.note).toContain('new, empty folder in the work folder');
    expect(read?.note).not.toContain('file_unzip');
  });
});

describe('untrusted archives', () => {
  it('lists names that point outside the archive, and never reads them', async () => {
    const zip = Buffer.from(
      zipSync({
        '../../evil.txt': strToU8('PLANTED'),
        '/etc/cron.d/x': strToU8('PLANTED'),
        'C:/Windows/x.txt': strToU8('PLANTED'),
        'ok.txt': strToU8('fine'),
      }),
    );
    const read = await readArchive('evil.zip', zip);
    expect(read?.text).toContain('../../evil.txt');
    expect(read?.text).toContain('unsafe name');
    expect(read?.text).not.toContain('PLANTED');
    expect(read?.text).toContain('fine');
    expect(read?.note).toContain('3 entries whose names point outside the archive');
    expect(existsSync(join(tmpdir(), '..', 'evil.txt'))).toBe(false);
  });

  it('drops a ZIP member that expands past the size it claims (a zip bomb)', async () => {
    const zip = Buffer.from(zipSync({ 'README.md': new Uint8Array(4 * 1024 * 1024) }));
    // Say it's 20 bytes, in both the local header and the directory.
    zip.writeUInt32LE(20, 22);
    const dir = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt32LE(20, dir + 24);
    const read = await readArchive('bomb.zip', zip);
    expect(read?.note).toContain('ZIP archive with 1 file');
    expect(read?.text).not.toContain('--- README.md');
  });

  it('stops expanding a gzip bomb, and says the list may be incomplete', async () => {
    const member = gzipSync(Buffer.alloc(64 * 1024 * 1024), { level: 9 });
    const bomb = Buffer.concat(Array.from({ length: 16 }, () => member));
    const started = Date.now();
    const read = await readArchive('bomb.gz', bomb);
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(read?.note).toMatch(/cut short|stops early|very large/);
    expect(read?.text ?? '').not.toContain('\0');
  }, 30_000);

  it('handles a ZIP with more entries than it reads', async () => {
    const files: Record<string, Uint8Array> = {};
    const empty = new Uint8Array(0);
    for (let i = 0; i < 100_050; i++) files[`f/${i}`] = empty;
    const zip = Buffer.from(zipSync(files, { level: 0 }));
    const read = await readArchive('many.zip', zip);
    expect(read?.note).toMatch(/100,000 files/);
    expect(read?.note).toContain('the list may be incomplete');
    expect(read?.text).toMatch(/… and [\d,]+ more entries, not listed\./);
  }, 60_000);

  it('says plainly when an archive is damaged', async () => {
    const zip = Buffer.from(zipSync({ 'a.txt': strToU8('hello there') }));
    const cut = await readArchive('cut.zip', zip.subarray(0, zip.length - 30));
    expect(cut?.note).toMatch(/^\(A ZIP archive Conch couldn't look inside\./);
    const gz = await readArchive(
      'junk.gz',
      Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08, 0]), Buffer.alloc(64, 0x41)]),
    );
    expect(gz?.note).toMatch(/couldn't look inside/);
    const tar = Buffer.concat([tarEntry('a.txt', 'hello'), tarEnd()]);
    tar[0] = 0x5a; // breaks the checksum
    const bad = await readArchive(
      'bad.tar',
      Buffer.concat([tar.subarray(0, 512), Buffer.alloc(100)]),
    );
    expect(bad?.note).toMatch(/couldn't look inside/);
  });

  it('names a 7-Zip archive when nothing here opens it', async () => {
    const seven = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4, 1, 2, 3, 4]);
    const read = await readArchive('x.7z', seven, CHAT_ONLY, {
      archives: { programs: async () => ({}) },
    });
    expect(read?.note).toMatch(/^\(A 7-Zip archive of 12 B\. This computer has nothing/);
    expect(read?.note).toContain('ask for the files themselves');
  });
});

describe('archives opened by this computer’s programs', async () => {
  const programs: ArchivePrograms = await archivePrograms();

  it.skipIf(!programs.bsdtar)('lists and reads a 7-Zip archive through bsdtar', async () => {
    const dir = join(scratch, 'seven');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'README.txt'), 'Seven zip words');
    const out = join(scratch, 'x.7z');
    execFileSync(programs.bsdtar ?? '', ['--format', '7zip', '-cf', out, '-C', dir, 'src']);
    const read = await readArchive('x.7z', await readFile(out));
    expect(read?.note).toMatch(/^\(A 7-Zip archive with 1 file/);
    expect(read?.text).toContain('src/README.txt');
    expect(read?.text).toContain('Seven zip words');
  });

  it.skipIf(!programs.bzip2)(
    'never lets a compressed mtree list read files on this computer',
    async () => {
      const secret = join(scratch, 'secret.txt');
      await writeFile(secret, 'TOP-SECRET-VALUE');
      const spec = `#mtree\n./x type=file contents=${secret}\n`;
      const bz2 = execFileSync(programs.bzip2 ?? '', ['-c'], { input: spec });
      const read = await readArchive('spec.tar.bz2', bz2, API, {
        archives: { programs: async () => programs },
      });
      expect(read?.text ?? '').not.toContain('TOP-SECRET-VALUE');
    },
  );

  it.skipIf(!programs.bzip2)('reads a bzip2 tarball', async () => {
    const tar = Buffer.concat([tarEntry('notes/README.md', 'bzip2 words'), tarEnd()]);
    const bz2 = execFileSync(programs.bzip2 ?? '', ['-c'], { input: tar });
    const read = await readArchive('notes.tar.bz2', bz2);
    expect(read?.note).toMatch(/^\(A bzip2-compressed tar archive with 1 file/);
    expect(read?.text).toContain('bzip2 words');
  });
});
