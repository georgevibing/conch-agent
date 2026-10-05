import { link, mkdir, mkdtemp, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { zipSync, strToU8 } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { extractDocument } from './documents';
import { fileBytes, readTextPage, searchFiles, textPage } from './read';

const signal = () => new AbortController().signal;
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), 'conch-files-'));
  folders.push(cwd);
  return { cwd };
}
const archive = (files: Record<string, string>) =>
  Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));

describe('bounded file tools', () => {
  it('paginates text with stable line references, and makes progress over enormous lines', async () => {
    const access = await workspace();
    await writeFile(join(access.cwd, 'notes.txt'), 'one\ntwo\nthree');
    expect(await readTextPage(access, 'notes.txt', signal(), 1, 1)).toEqual({
      text: '2: two',
      totalLines: 3,
      nextOffset: 2,
    });
    expect(textPage('x'.repeat(100_000) + '\ny', 0, 1)).toMatchObject({ nextOffset: 1 });
    expect(textPage('x'.repeat(100_000), 0, 1).text).toContain('line shortened');
  });
  it('pages CRLF and newline-heavy files without losing blank or final lines', () => {
    expect(textPage('one\r\n\r\nthree\n', 1, 2)).toEqual({
      text: '2: \n3: three',
      totalLines: 4,
      nextOffset: 3,
    });
    expect(textPage('\n'.repeat(1_000_000), 999_999, 1)).toEqual({
      text: '1000000: ',
      totalLines: 1_000_001,
      nextOffset: 1_000_000,
    });
  });
  it('refuses binaries, traversal, symlinks, hard links and protected files', async () => {
    const access = await workspace();
    await writeFile(join(access.cwd, 'secret'), Buffer.from([0, 1, 2]));
    await symlink(join(access.cwd, 'secret'), join(access.cwd, 'sym'));
    await link(join(access.cwd, 'secret'), join(access.cwd, 'hard'));
    for (const name of ['../outside', 'sym', 'hard'])
      await expect(fileBytes(access, name, signal())).rejects.toThrow();
    await expect(
      fileBytes({ ...access, protectedPaths: [join(access.cwd, 'secret')] }, 'secret', signal()),
    ).rejects.toThrow();
    await writeFile(join(access.cwd, 'binary'), Buffer.from([0, 1, 2]));
    await expect(readTextPage(access, 'binary', signal())).rejects.toThrow('binary');
  });
  it('searches literal text, continues results, skips dependencies and secrets', async () => {
    const access = await workspace();
    await writeFile(join(access.cwd, 'a.txt'), 'needle.*\nNEEDLE.*');
    await mkdir(join(access.cwd, 'node_modules'));
    await writeFile(join(access.cwd, 'node_modules', 'b'), 'needle.*');
    await writeFile(join(access.cwd, 'secret'), 'needle.*');
    const options = { path: '.', text: 'needle.*', caseSensitive: false, offset: 0, limit: 1 };
    const secured = { ...access, protectedPaths: [join(access.cwd, 'secret')] };
    expect(await searchFiles(secured, options, signal())).toMatchObject({
      matches: [{ path: 'a.txt', line: 1 }],
      nextOffset: 1,
    });
    expect(await searchFiles(secured, { ...options, offset: 1 }, signal())).toMatchObject({
      matches: [{ path: 'a.txt', line: 2 }],
      nextOffset: null,
    });
  });
  it('honors cancellation before opening a file', async () => {
    const access = await workspace();
    const stop = new AbortController();
    stop.abort();
    await expect(fileBytes(access, 'missing', stop.signal)).rejects.toThrow();
  });
});

describe('document parser in a separate process', () => {
  it('reads DOCX text without executing document content', async () => {
    const bytes = archive({
      'word/document.xml':
        '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t> world</w:t></w:r></w:p></w:body></w:document>',
    });
    expect(await extractDocument(bytes, 'note.docx', 0, 5, signal())).toMatchObject({
      sections: [{ text: 'Hello world', truncated: false }],
      nextOffset: null,
    });
  });
  it('reads spreadsheet shared strings, inline strings, cells and cached formulas', async () => {
    const bytes = archive({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Costs" r:id="r1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>Tea</t></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><f>1+2</f><v>3</v></c></row></sheetData></worksheet>',
    });
    const result = await extractDocument(bytes, 'book.xlsx', 0, 5, signal());
    expect(result.sections[0]?.text).toBe('A1: Tea | B1: 3 [formula: 1+2; cached value]');
  });
  it('paginates slide references', async () => {
    const bytes = archive({
      'ppt/presentation.xml':
        '<presentation><sldIdLst><sldId r:id="r2"/><sldId r:id="r1"/></sldIdLst></presentation>',
      'ppt/_rels/presentation.xml.rels':
        '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>',
      'ppt/slides/slide1.xml': '<slide><p><t>First</t></p></slide>',
      'ppt/slides/slide2.xml': '<slide><p><t>Second</t></p></slide>',
    });
    expect(await extractDocument(bytes, 'deck.pptx', 1, 1, signal())).toMatchObject({
      sections: [{ label: 'Slide 2', text: 'First' }],
      totalSections: 2,
      nextOffset: null,
    });
  });
  it('continues a long section without losing text', async () => {
    const text = 'a'.repeat(40_000) + 'end &amp; finish';
    const bytes = archive({ 'word/document.xml': `<document><p><t>${text}</t></p></document>` });
    const first = await extractDocument(bytes, 'long.docx', 0, 1, signal());
    expect(first.sections[0]).toMatchObject({ truncated: true, nextTextOffset: 40_000, offset: 0 });
    const rest = await extractDocument(bytes, 'long.docx', 0, 1, signal(), 40_000);
    expect(rest.sections[0]).toMatchObject({
      text: 'end & finish',
      truncated: false,
      nextTextOffset: null,
    });
  });
  it('rejects malformed documents, XML entities and archive traversal', async () => {
    await expect(
      extractDocument(Buffer.from('broken'), 'bad.docx', 0, 5, signal()),
    ).rejects.toThrow();
    await expect(
      extractDocument(archive({ '../secret.xml': 'x' }), 'bad.docx', 0, 5, signal()),
    ).rejects.toThrow('unsafe');
    await expect(
      extractDocument(
        archive({
          'word/document.xml': '<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><document/>',
        }),
        'bad.docx',
        0,
        5,
        signal(),
      ),
    ).rejects.toThrow('entity');
  });
  it('refuses an oversized archive before decompression', async () => {
    const bytes = archive({ 'word/document.xml': '<document/>' });
    const entry = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(entry).toBeGreaterThan(0);
    bytes.writeUInt32LE(50 * 1024 * 1024, entry + 24);
    await expect(extractDocument(bytes, 'bomb.docx', 0, 1, signal())).rejects.toThrow(
      'expanded document is too large',
    );
  });
  it('reads a real PDF text page', async () => {
    const body = 'BT /F1 12 Tf 50 750 Td (Hello PDF) Tj ET';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const [i, obj] of objects.entries()) {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    }
    const xref = pdf.length;
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((n) => String(n).padStart(10, '0') + ' 00000 n ')
      .join('\n')}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    expect(await extractDocument(Buffer.from(pdf), 'hello.pdf', 0, 1, signal())).toMatchObject({
      sections: [{ label: 'Page 1', text: 'Hello PDF' }],
    });
  });
});
