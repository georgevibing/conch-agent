import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strToU8, zipSync, type Zippable } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { extractDocument } from '../../files/documents';
import { forTurn } from '../prompt';
import { sniff } from '../sniff';
import { AttachmentStore } from '../store';

const signal = () => new AbortController().signal;
const read = (bytes: Buffer, name: string, offset = 0, limit = 20) =>
  extractDocument(bytes, name, offset, limit, signal());
const all = async (bytes: Buffer, name: string) =>
  (await read(bytes, name)).sections.map((s) => `[${s.label}]\n${s.text}`).join('\n');

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

/** A zip with its `mimetype` first and stored, as ODF and EPUB keep it. */
function zipped(mimetype: string | undefined, files: Record<string, string>): Buffer {
  const entries: Zippable = {};
  if (mimetype) entries.mimetype = [strToU8(mimetype), { level: 0 }];
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text);
  return Buffer.from(zipSync(entries));
}

const ODF_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"';
const odf = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}><office:body>${body}</office:body></office:document-content>`;

// ── A tiny OLE compound file writer, for Outlook and Office 97–2003 fixtures ──

/** Streams under the root (and storages one level down), as Office writes them. */
type Tree = Record<string, Buffer | Record<string, Buffer>>;

function compoundFile(tree: Tree): Buffer {
  const SECTOR = 512;
  const entries: {
    name: string;
    type: number;
    data?: Buffer;
    children: number[];
    start: number;
    size: number;
  }[] = [{ name: 'Root Entry', type: 5, children: [], start: 0xfffffffe, size: 0 }];
  const add = (parent: number, name: string, value: Buffer | Record<string, Buffer>) => {
    const id = entries.length;
    if (Buffer.isBuffer(value)) {
      entries.push({
        name,
        type: 2,
        data: value,
        children: [],
        start: 0xfffffffe,
        size: value.length,
      });
      entries[parent]?.children.push(id);
    } else {
      entries.push({ name, type: 1, children: [], start: 0, size: 0 });
      entries[parent]?.children.push(id);
      for (const [n, v] of Object.entries(value)) add(id, n, v);
    }
  };
  for (const [name, value] of Object.entries(tree)) add(0, name, value);

  // Small streams go in the mini stream (64-byte sectors), big ones in sectors of their own.
  const mini: Buffer[] = [];
  const miniFat: number[] = [];
  const big: { entry: (typeof entries)[number] }[] = [];
  for (const entry of entries) {
    if (entry.type !== 2 || !entry.data) continue;
    if (entry.data.length >= 4096) {
      big.push({ entry });
      continue;
    }
    const count = Math.ceil(entry.data.length / 64);
    if (!count) continue;
    entry.start = mini.length;
    for (let i = 0; i < count; i++) {
      const piece = Buffer.alloc(64);
      entry.data.copy(piece, 0, i * 64, (i + 1) * 64);
      mini.push(piece);
      miniFat.push(i === count - 1 ? 0xfffffffe : mini.length);
    }
  }
  const sectors: Buffer[] = [];
  const fat: number[] = [];
  const place = (data: Buffer) => {
    const count = Math.max(1, Math.ceil(data.length / SECTOR));
    const start = sectors.length;
    for (let i = 0; i < count; i++) {
      const s = Buffer.alloc(SECTOR);
      data.copy(s, 0, i * SECTOR, (i + 1) * SECTOR);
      sectors.push(s);
      fat.push(i === count - 1 ? 0xfffffffe : sectors.length);
    }
    return start;
  };
  const miniData = Buffer.concat(mini);
  const root = entries[0];
  if (root) {
    root.start = miniData.length ? place(miniData) : 0xfffffffe;
    root.size = miniData.length;
  }
  const miniFatBuf = Buffer.alloc(Math.max(1, miniFat.length) * 4, 0xff);
  miniFat.forEach((v, i) => miniFatBuf.writeUInt32LE(v, i * 4));
  const miniFatStart = miniFat.length ? place(miniFatBuf) : 0xfffffffe;
  for (const { entry } of big) entry.start = place(entry.data ?? Buffer.alloc(0));

  // Each storage's children as a chain down the right: a valid (if lopsided) tree.
  const dir = Buffer.alloc(Math.ceil(entries.length / 4) * 4 * 128);
  const left = new Map<number, number>();
  const right = new Map<number, number>();
  const child = new Map<number, number>();
  for (const [id, entry] of entries.entries()) {
    if (!entry.children.length) continue;
    entry.children.forEach((c, i) => {
      if (i === 0) child.set(id, c);
      const next = entry.children[i + 1];
      if (next !== undefined) right.set(c, next);
    });
  }
  for (let i = 0; i < dir.length / 128; i++) {
    const at = i * 128;
    const entry = entries[i];
    dir.writeUInt32LE(0xffffffff, at + 68);
    dir.writeUInt32LE(0xffffffff, at + 72);
    dir.writeUInt32LE(0xffffffff, at + 76);
    if (!entry) continue;
    const name = Buffer.from(`${entry.name}\0`, 'utf16le');
    name.copy(dir, at);
    dir.writeUInt16LE(name.length, at + 64);
    dir[at + 66] = entry.type;
    dir.writeUInt32LE(left.get(i) ?? 0xffffffff, at + 68);
    dir.writeUInt32LE(right.get(i) ?? 0xffffffff, at + 72);
    dir.writeUInt32LE(child.get(i) ?? 0xffffffff, at + 76);
    dir.writeUInt32LE(entry.start, at + 116);
    dir.writeUInt32LE(entry.size, at + 120);
  }
  const dirStart = place(dir);
  // The FAT itself, in as many sectors as it needs (each describing 128 sectors).
  let fatSectors = 1;
  while (Math.ceil((sectors.length + fatSectors) / 128) > fatSectors) fatSectors++;
  const fatStart = sectors.length;
  for (let i = 0; i < fatSectors; i++) {
    sectors.push(Buffer.alloc(SECTOR));
    fat.push(0xfffffffd);
  }
  const fatBuf = Buffer.alloc(fatSectors * SECTOR, 0xff);
  fat.forEach((v, i) => fatBuf.writeUInt32LE(v, i * 4));
  for (let i = 0; i < fatSectors; i++) {
    const sector = sectors[fatStart + i];
    if (sector) fatBuf.copy(sector, 0, i * SECTOR);
  }

  const header = Buffer.alloc(SECTOR);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header);
  header.writeUInt16LE(0x3e, 0x18);
  header.writeUInt16LE(3, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(fatSectors, 0x2c);
  header.writeUInt32LE(dirStart, 0x30);
  header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(miniFatStart, 0x3c);
  header.writeUInt32LE(miniFat.length ? 1 : 0, 0x40);
  header.writeUInt32LE(0xfffffffe, 0x44);
  for (let i = 0; i < 109; i++)
    header.writeUInt32LE(i < fatSectors ? fatStart + i : 0xffffffff, 0x4c + i * 4);
  return Buffer.concat([header, ...sectors]);
}

const utf16 = (text: string) => Buffer.from(text, 'utf16le');

/** A Word 97 document whose text is one 8-bit piece. */
function wordFile(text: string, flags = 0): Buffer {
  const word = Buffer.alloc(1024 + text.length);
  word.writeUInt16LE(0xa5ec, 0);
  word.writeUInt16LE(0x00c1, 2);
  word.writeUInt16LE(flags, 0x0a);
  word.writeUInt16LE(14, 32);
  word.writeUInt16LE(22, 62);
  word.writeInt32LE(text.length, 76);
  word.writeUInt16LE(0x5d, 152);
  word.writeUInt32LE(0, 418);
  word.writeUInt32LE(21, 422);
  Buffer.from(text, 'latin1').copy(word, 1024);
  const table = Buffer.alloc(21);
  table[0] = 0x02;
  table.writeUInt32LE(16, 1);
  table.writeUInt32LE(0, 5);
  table.writeUInt32LE(text.length, 9);
  table.writeUInt32LE((1024 * 2) | 0x40000000, 15);
  return compoundFile({ WordDocument: word, '0Table': table });
}

const record = (type: number, data: Buffer) => {
  const head = Buffer.alloc(4);
  head.writeUInt16LE(type, 0);
  head.writeUInt16LE(data.length, 2);
  return Buffer.concat([head, data]);
};
const u16 = (...values: number[]) => {
  const b = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => b.writeUInt16LE(v, i * 2));
  return b;
};
const u32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
};

/** An Excel 97 workbook: one sheet, shared strings split across a CONTINUE record. */
function excelFile(): Buffer {
  const bof = (dt: number) => record(0x0809, u16(0x0600, dt, 0, 0, 0, 0, 0, 0));
  const eof = record(0x000a, Buffer.alloc(0));
  const sheetName = Buffer.from('Costs', 'latin1');
  // "Tea" whole, then "Coffee" split after "Cof", continuing as UTF-16 ("fee").
  const sst = Buffer.concat([
    u32(2),
    u32(2),
    u16(3),
    Buffer.from([0]),
    Buffer.from('Tea', 'latin1'),
    u16(6),
    Buffer.from([0]),
    Buffer.from('Cof', 'latin1'),
  ]);
  const cont = Buffer.concat([Buffer.from([1]), utf16('fee')]);
  const boundSheet = (offset: number) =>
    record(
      0x0085,
      Buffer.concat([u32(offset), Buffer.from([0, 0, sheetName.length, 0]), sheetName]),
    );
  const globalsWithout = Buffer.concat([
    bof(5),
    boundSheet(0),
    record(0x00fc, sst),
    record(0x003c, cont),
    eof,
  ]);
  const number = Buffer.alloc(14);
  number.writeUInt16LE(1, 0);
  number.writeUInt16LE(1, 2);
  number.writeDoubleLE(2.5, 6);
  const rk = Buffer.concat([u16(2, 1, 0), u32((42 << 2) | 0x02)]);
  const sheet = Buffer.concat([
    bof(0x10),
    record(0x00fd, Buffer.concat([u16(0, 0, 0), u32(0)])),
    record(0x00fd, Buffer.concat([u16(1, 0, 0), u32(1)])),
    record(0x0203, number),
    record(0x027e, rk),
    eof,
  ]);
  const globals = Buffer.concat([
    bof(5),
    boundSheet(globalsWithout.length),
    record(0x00fc, sst),
    record(0x003c, cont),
    eof,
  ]);
  return compoundFile({ Workbook: Buffer.concat([globals, sheet]) });
}

/** A PowerPoint 97 deck: two slides in the outline. */
function powerPointFile(): Buffer {
  const rec = (verInstance: number, type: number, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt16LE(verInstance, 0);
    head.writeUInt16LE(type, 2);
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body]);
  };
  const list = rec(
    0x000f,
    0x0ff0,
    Buffer.concat([
      rec(0, 0x03f3, Buffer.alloc(20)),
      rec(0, 0x0fa0, utf16('Welcome')),
      rec(0, 0x0fa8, Buffer.from('Agenda\rPlans', 'latin1')),
      rec(0, 0x03f3, Buffer.alloc(20)),
      rec(0, 0x0fa0, utf16('Thanks')),
    ]),
  );
  return compoundFile({ 'PowerPoint Document': rec(0x000f, 0x03e8, list) });
}

/** An Outlook message with a sender, a body and one attachment. */
function outlookFile(): Buffer {
  const props = Buffer.alloc(32 + 16);
  props.writeUInt32LE((0x0039 << 16) | 0x0040, 32);
  // 2026-01-02T03:04:05Z as a FILETIME.
  const filetime = (BigInt(Date.UTC(2026, 0, 2, 3, 4, 5)) + 11_644_473_600_000n) * 10_000n;
  props.writeBigUInt64LE(filetime, 40);
  return compoundFile({
    '__properties_version1.0': props,
    '__substg1.0_0037001F': utf16('Lunch on Friday'),
    '__substg1.0_0C1A001F': utf16('Ada Lovelace'),
    '__substg1.0_5D01001F': utf16('ada@example.com'),
    '__substg1.0_0E04001F': utf16('Grace Hopper'),
    '__substg1.0_1000001F': utf16('Shall we meet at noon?\r\nAda'),
    '__attach_version1.0_#00000000': {
      '__substg1.0_3707001F': utf16('menu.pdf'),
      '__substg1.0_370E001F': utf16('application/pdf'),
      '__substg1.0_37010102': Buffer.alloc(5000, 1),
    },
  });
}

const EMAIL = [
  'Return-Path: <ada@example.com>',
  'From: =?UTF-8?B?QWTDoSBMb3ZlbGFjZQ==?= <ada@example.com>',
  'To: Grace <grace@example.com>',
  'Date: Fri, 2 Jan 2026 10:00:00 +0000',
  'Subject: =?UTF-8?Q?Caf=C3=A9_plans?=',
  '  for Friday',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="outer"',
  '',
  'This is a multi-part message.',
  '--outer',
  'Content-Type: multipart/alternative; boundary=inner',
  '',
  '--inner',
  'Content-Type: text/plain; charset=iso-8859-1',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Let=E2s meet at the caf=E9 at noon. A long line that is =',
  'softly broken.',
  '--inner',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>HTML version</p>',
  '--inner--',
  '--outer',
  'Content-Type: application/pdf',
  "Content-Disposition: attachment; filename*=utf-8''men%C3%BC.pdf",
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.alloc(3000, 7).toString('base64'),
  '--outer--',
  '',
].join('\r\n');

describe('documents beyond PDF and Office, read in the sealed worker', () => {
  it('reads an OpenDocument text: headings, lists, tables, spaces and notes', async () => {
    const bytes = zipped('application/vnd.oasis.opendocument.text', {
      'content.xml': odf(
        '<office:text><text:h text:outline-level="1">Plan</text:h>' +
          '<text:p>Two<text:s text:c="2"/>spaces<text:tab/>and a note<text:note><text:note-citation>1</text:note-citation><text:note-body><text:p>Footnote</text:p></text:note-body></text:note>.</text:p>' +
          '<text:list><text:list-item><text:p>First</text:p><text:list><text:list-item><text:p>Inner</text:p></text:list-item></text:list></text:list-item></text:list>' +
          '<table:table><table:table-row><table:table-cell><text:p>Name</text:p></table:table-cell><table:table-cell><text:p>Role</text:p></table:table-cell></table:table-row>' +
          '<table:table-row><table:table-cell><text:p>Ada</text:p></table:table-cell><table:table-cell><text:p>A|B</text:p></table:table-cell></table:table-row></table:table>' +
          '</office:text>',
      ),
    });
    const text = await all(bytes, 'plan.odt');
    expect(text).toContain('# Plan');
    expect(text).toContain('Two  spaces\tand a note [note: Footnote].');
    expect(text).toContain('- First\n  - Inner');
    expect(text).toContain('| Name | Role |\n| --- | --- |\n| Ada | A\\|B |');
  });

  it('reads OpenDocument sheets as tables, without expanding a million repeated rows', async () => {
    const bytes = zipped('application/vnd.oasis.opendocument.spreadsheet', {
      'content.xml': odf(
        '<office:spreadsheet><table:table table:name="Budget">' +
          '<table:table-row><table:table-cell><text:p>Item</text:p></table:table-cell><table:table-cell table:number-columns-repeated="2"><text:p>x</text:p></table:table-cell></table:table-row>' +
          '<table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>' +
          '<table:table-row><table:table-cell table:formula="of:=SUM([.B1:.C1])"><text:p>7</text:p></table:table-cell></table:table-row>' +
          '</table:table><table:table table:name="Empty"/></office:spreadsheet>',
      ),
    });
    const started = Date.now();
    const result = await read(bytes, 'budget.ods');
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.sections.map((s) => s.label)).toEqual(['Sheet: Budget', 'Sheet: Empty']);
    expect(result.sections[0]?.text).toBe(
      '| # | A | B | C |\n| --- | --- | --- | --- |\n| 1 | Item | x | x |\n| 1048572 | 7 (=SUM([.B1:.C1])) |  |  |',
    );
    expect(result.sections[1]?.text).toBe('(This sheet is empty.)');
  });

  it('reads OpenDocument slides with their speaker notes', async () => {
    const bytes = zipped('application/vnd.oasis.opendocument.presentation', {
      'content.xml': odf(
        '<office:presentation>' +
          '<draw:page draw:name="page1"><draw:frame><draw:text-box><text:p>Hello</text:p></draw:text-box></draw:frame>' +
          '<presentation:notes><draw:frame><draw:text-box><text:p>Say hi</text:p></draw:text-box></draw:frame></presentation:notes></draw:page>' +
          '<draw:page draw:name="page2"><draw:frame><draw:text-box><text:p>Bye</text:p></draw:text-box></draw:frame></draw:page>' +
          '</office:presentation>',
      ),
    });
    const result = await read(bytes, 'talk.odp');
    expect(result.sections).toMatchObject([
      { label: 'Slide 1', text: 'Hello\n\nSpeaker notes: Say hi' },
      { label: 'Slide 2', text: 'Bye' },
    ]);
  });

  it('refuses a locked OpenDocument file and one nested beyond the parser’s limit', async () => {
    const lockedFile = zipped('application/vnd.oasis.opendocument.text', {
      'META-INF/manifest.xml': '<manifest><file-entry><encryption-data/></file-entry></manifest>',
      'content.xml': 'garbage',
    });
    await expect(read(lockedFile, 'secret.odt')).rejects.toThrow('locked');
    const deep = zipped('application/vnd.oasis.opendocument.text', {
      'content.xml': odf(
        `<office:text><text:p>${'<text:span>'.repeat(5000)}x${'</text:span>'.repeat(5000)}</text:p></office:text>`,
      ),
    });
    await expect(read(deep, 'deep.odt')).rejects.toThrow();
  });

  it('reads an EPUB in its spine’s order, chapters named from its table of contents', async () => {
    const bytes = zipped('application/epub+zip', {
      'META-INF/container.xml':
        '<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      'OEBPS/content.opf':
        '<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Night Train</dc:title><dc:creator>Ada</dc:creator><dc:language>en</dc:language></metadata>' +
        '<manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="a" href="Text/one.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="b" href="Text/two%20b.xhtml" media-type="application/xhtml+xml"/><item id="evil" href="../../etc/passwd" media-type="application/xhtml+xml"/></manifest>' +
        '<spine toc="ncx"><itemref idref="b"/><itemref idref="evil"/><itemref idref="a"/></spine></package>',
      'OEBPS/toc.ncx':
        '<ncx><navMap><navPoint><navLabel><text>The Start</text></navLabel><content src="Text/two%20b.xhtml#top"/></navPoint></navMap></ncx>',
      'OEBPS/Text/two b.xhtml':
        '<?xml version="1.0"?><!DOCTYPE html><html><head><title>skip</title><script>alert(1)</script></head><body><h1>Departure</h1><p>The train&nbsp;left at <b>six</b>.</p><table><tr><th>Stop</th><th>Time</th></tr><tr><td>Lyon</td><td>8:00</td></tr></table></body></html>',
      'OEBPS/Text/one.xhtml':
        '<html><body><h2>Arrival</h2><ul><li>Tea</li><li><a href="https://example.com/x">Map</a></li></ul></body></html>',
    });
    const result = await read(bytes, 'train.epub');
    expect(result.sections.map((s) => s.label)).toEqual([
      'About this book',
      'Chapter 1: The Start',
      'Chapter 2: Arrival',
    ]);
    expect(result.sections[0]?.text).toContain('Title: Night Train\nBy: Ada');
    expect(result.sections[1]?.text).toBe(
      '# Departure\n\nThe train left at six.\n\n| Stop | Time |\n| --- | --- |\n| Lyon | 8:00 |',
    );
    expect(result.sections[1]?.text).not.toContain('alert');
    expect(result.sections[2]?.text).toBe('## Arrival\n\n- Tea\n- Map <https://example.com/x>');
  });

  it('refuses an EPUB under DRM, but not one whose fonts are only obfuscated', async () => {
    const book = (algorithm: string) =>
      zipped('application/epub+zip', {
        'META-INF/encryption.xml': `<encryption><EncryptedData><EncryptionMethod Algorithm="${algorithm}"/></EncryptedData></encryption>`,
        'META-INF/container.xml':
          '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
        'book.opf':
          '<package><manifest><item id="a" href="a.html" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>',
        'a.html': '<p>Words</p>',
      });
    await expect(
      read(book('http://www.w3.org/2001/04/xmlenc#aes128-cbc'), 'b.epub'),
    ).rejects.toThrow('locked');
    expect(
      (await read(book('http://www.idpf.org/2008/embedding'), 'b.epub')).sections[1]?.text,
    ).toBe('Words');
  });

  it('refuses a zip that would expand past its limit before unpacking it', async () => {
    const bomb = Buffer.from(
      zipSync({
        mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
        'content.xml': new Uint8Array(12 * 1024 * 1024),
      }),
    );
    expect(bomb.length).toBeLessThan(200_000);
    await expect(read(bomb, 'bomb.odt')).rejects.toThrow('too large');
  });

  it('reads RTF: control words skipped, escapes and Unicode decoded, tables kept', async () => {
    const rtf = String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0 Times New Roman;}}{\colortbl;\red0\green0\blue0;}{\*\generator Riched20;}{\info{\title Secret title}}\pard Caf\'e9 costs \u8364?5\par
Line \{two\}\line next\par
{\field{\*\fldinst HYPERLINK "http://x"}{\fldrslt Link}}\par
\trowd\cellx1000\cellx2000 A\cell B\cell\row
{\pict\pngblip 89504e47}}`;
    const text = await all(Buffer.from(rtf, 'latin1'), 'note.rtf');
    expect(text).toContain('Café costs €5');
    expect(text).toContain('Line {two}\nnext');
    expect(text).toContain('Link');
    expect(text).toContain('A | B |');
    expect(text).not.toMatch(/Times New Roman|Riched20|Secret title|HYPERLINK|89504e47/);
    await expect(read(Buffer.from(`{\\rtf1${'{'.repeat(20_000)}`), 'deep.rtf')).rejects.toThrow(
      'nested too deeply',
    );
  });

  it('reads an email: decoded headers, the plain body, and what it carried by name and size', async () => {
    const result = await read(Buffer.from(EMAIL, 'latin1'), 'plans.eml');
    expect(result.sections[0]?.label).toBe('Message: Café plans for Friday');
    const text = result.sections[0]?.text ?? '';
    expect(text).toMatch(/^From: Adá Lovelace <ada@example.com>\nTo: Grace <grace@example.com>\n/);
    expect(text).toContain('Subject: Café plans for Friday');
    expect(text).toContain('Letâs meet at the café at noon. A long line that is softly broken.');
    expect(text).not.toContain('HTML version');
    expect(text).toContain('Attachments (1):\n- menü.pdf (application/pdf, 3 KB)');
    expect(text).not.toContain(Buffer.alloc(30, 7).toString('base64'));
  });

  it('reads an HTML-only email, and copes with huge headers and deep nesting', async () => {
    const html = [
      'From: a@example.com',
      'Subject: Hi',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(
        '<div><p>Hello <a href="https://example.com">there</a></p><script>bad()</script></div>',
      ).toString('base64'),
    ].join('\n');
    expect(await all(Buffer.from(html), 'hi.eml')).toContain('Hello there <https://example.com>');

    const huge = `From: a@example.com\nSubject: Big\n${'X-Junk: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n'.repeat(80_000)}\nThe body.`;
    expect(await all(Buffer.from(huge), 'big.eml')).toContain('The body.');

    let nested = 'Body at the bottom';
    for (let i = 0; i < 40; i++)
      nested = `Content-Type: multipart/mixed; boundary=b${i}\n\n--b${i}\n${nested}\n--b${i}--`;
    const deep = await all(
      Buffer.from(`From: a@example.com\nSubject: Deep\n${nested}`),
      'deep.eml',
    );
    expect(deep).toContain('Subject: Deep');

    const hostile = `From: a@example.com\nSubject: x\nContent-Type: text/html\n\n${'<a'.repeat(200_000)}${'<1'.repeat(200_000)}>`;
    const started = Date.now();
    await read(Buffer.from(hostile), 'x.eml');
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('reads a mailbox a message a section, unescaping its From lines', async () => {
    const message = (n: number) =>
      `From sender@example.com Fri Jan  2 10:00:00 2026\nFrom: sender@example.com\nSubject: Note ${n}\n\nBody ${n}\n>From the start\n`;
    const mbox = Buffer.from([1, 2, 3].map(message).join('\n'));
    const result = await read(mbox, 'inbox.mbox', 1, 5);
    expect(result.totalSections).toBe(3);
    expect(result.sections.map((s) => s.label)).toEqual(['Message 2: Note 2', 'Message 3: Note 3']);
    expect(result.sections[0]?.text).toContain('Body 2\nFrom the start');
  });

  it('reads an Outlook message from its compound file', async () => {
    const text = await all(outlookFile(), 'lunch.msg');
    expect(text).toContain('[Message: Lunch on Friday]');
    expect(text).toContain(
      'From: Ada Lovelace <ada@example.com>\nTo: Grace Hopper\nDate: Fri, 02 Jan 2026 03:04:05 GMT',
    );
    expect(text).toContain('Shall we meet at noon?\nAda');
    expect(text).toContain('- menu.pdf (application/pdf, 5 KB)');
  });

  it('reads Word, Excel and PowerPoint 97–2003 files itself', async () => {
    const doc = await all(
      wordFile(
        'Minutes\rWe agreed.\r\x13 HYPERLINK "http://x" \x14Our site\x15 is live.\rA\x07B\x07\x07',
      ),
      'minutes.doc',
    );
    expect(doc).toContain('Minutes\nWe agreed.\nOur site is live.\nA | B |');
    expect(doc).not.toContain('HYPERLINK');
    await expect(read(wordFile('x', 0x0100), 'locked.doc')).rejects.toThrow('locked');

    const xls = await read(excelFile(), 'costs.xls');
    expect(xls.sections[0]).toMatchObject({
      label: 'Sheet: Costs',
      text: '| # | A | B |\n| --- | --- | --- |\n| 1 | Tea |  |\n| 2 | Coffee | 2.5 |\n| 3 |  | 42 |',
    });

    const ppt = await read(powerPointFile(), 'deck.ppt');
    expect(ppt.sections).toMatchObject([
      { label: 'Slide 1', text: 'Welcome\nAgenda\nPlans' },
      { label: 'Slide 2', text: 'Thanks' },
    ]);
  });

  it('refuses a compound file whose sector chains loop', async () => {
    const bytes = outlookFile();
    // Point the directory's first sector at itself in the FAT.
    const dirStart = bytes.readUInt32LE(0x30);
    const fatSector = bytes.readUInt32LE(0x4c);
    bytes.writeUInt32LE(dirStart, 512 + fatSector * 512 + dirStart * 4);
    await expect(read(bytes, 'loop.msg')).rejects.toThrow('damaged');
  });

  it.runIf(process.platform === 'darwin')(
    'reads a real Word 97 file, as macOS writes one',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'conch-doc-'));
      folders.push(dir);
      await writeFile(join(dir, 'a.txt'), 'Hello from an old Word file\n\nSecond paragraph');
      execFileSync('/usr/bin/textutil', [
        '-convert',
        'doc',
        join(dir, 'a.txt'),
        '-output',
        join(dir, 'a.doc'),
      ]);
      const text = await all(await readFile(join(dir, 'a.doc')), 'a.doc');
      expect(text).toContain('Hello from an old Word file');
      expect(text).toContain('Second paragraph');
    },
  );

  it('reads a Jupyter notebook: cells in order, outputs shortened, pictures named', async () => {
    const notebook = {
      nbformat: 4,
      metadata: { kernelspec: { language: 'python' } },
      cells: [
        { cell_type: 'markdown', source: ['# Analysis\n', 'Load the data.'] },
        {
          cell_type: 'code',
          source: 'print("hi")',
          outputs: [
            { output_type: 'stream', text: ['\u001b[31mhi\u001b[0m\n'] },
            {
              output_type: 'display_data',
              data: { 'image/png': 'iVBOR', 'text/plain': '<Figure>' },
            },
          ],
        },
        {
          cell_type: 'code',
          source: 'x',
          outputs: [{ output_type: 'stream', text: 'y'.repeat(10_000) }],
        },
        {
          cell_type: 'code',
          source: '1/0',
          outputs: [
            {
              output_type: 'error',
              ename: 'ZeroDivisionError',
              evalue: 'division by zero',
              traceback: [],
            },
          ],
        },
      ],
    };
    const text = await all(Buffer.from(JSON.stringify(notebook)), 'analysis.ipynb');
    expect(text).toContain('[Cell 1 · markdown]\n# Analysis\nLoad the data.');
    expect(text).toContain(
      '[Cell 2 · code]\n```python\nprint("hi")\n```\nOutput:\n```\nhi\n<Figure>\n[picture: image/png]\n```',
    );
    expect(text).toContain('… [output shortened]');
    expect(text).not.toContain('y'.repeat(4_001));
    expect(text).toContain('ZeroDivisionError: division by zero');
  });
});

describe('the documents reader, for every provider', () => {
  async function store() {
    const dir = await mkdtemp(join(tmpdir(), 'conch-docs-'));
    folders.push(dir);
    return new AttachmentStore(dir);
  }

  it('knows these files by name and by their bytes', () => {
    expect(sniff(Buffer.from(EMAIL), 'plans.eml', undefined)).toMatchObject({
      kind: 'text',
      mimeType: 'message/rfc822',
    });
    const odt = zipped('application/vnd.oasis.opendocument.text', { 'content.xml': odf('') });
    expect(sniff(odt, 'download', undefined).mimeType).toBe(
      'application/vnd.oasis.opendocument.text',
    );
    expect(sniff(outlookFile(), 'lunch.msg', undefined).mimeType).toBe(
      'application/vnd.ms-outlook',
    );
  });

  it('gives a provider that can’t open files an email’s words, not its raw MIME, and an engine that can the file', async () => {
    const files = await store();
    const mail = await files.save({ name: 'plans.eml', bytes: Buffer.from(EMAIL, 'latin1') });
    const api = await forTurn(files, [mail], { images: false, files: false, tools: true });
    expect(api.block).toContain('An email, read by Conch');
    expect(api.block).toContain('Letâs meet at the café');
    expect(api.block).not.toContain('Content-Transfer-Encoding');
    const agent = await forTurn(files, [mail], { images: false, files: true, tools: true });
    expect(agent.block).toContain('Content-Transfer-Encoding');
  });

  it('gives an API model an older Word file’s words, and the sheets of a workbook as a preview table', async () => {
    const files = await store();
    const doc = await files.save({ name: 'minutes.doc', bytes: wordFile('Minutes\rWe agreed.') });
    const api = await forTurn(files, [doc], { images: false, files: false });
    expect(api.block).toContain('We agreed.');
    const { documents } = await import('./documents');
    const result = await documents.read({
      attachment: await files.save({ name: 'costs.xls', bytes: excelFile() }),
      bytes: excelFile(),
      path: '',
      room: 60_000,
      can: { images: false, files: false },
      deps: {},
      signal: signal(),
    });
    expect(result?.view?.parts[0]).toMatchObject({
      kind: 'table',
      title: 'Costs',
      columns: ['A', 'B'],
      rows: [
        ['Tea', ''],
        ['Coffee', '2.5'],
        ['', '42'],
      ],
    });
  });

  it('lets a text that is no email go in as it is', async () => {
    const files = await store();
    const note = await files.save({ name: 'notes.eml', bytes: Buffer.from('just some words\n') });
    const api = await forTurn(files, [note], { images: false, files: false });
    expect(api.block).toContain('just some words');
    expect(api.block).not.toContain('read by Conch');
  });
});
