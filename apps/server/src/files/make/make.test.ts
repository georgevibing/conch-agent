import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { ConversationEvent, ToolProgress, type Attachment } from '@conch/protocol';

import { forTurn } from '../../attachments/prompt';
import { AttachmentStore } from '../../attachments/store';
import { mayCarry } from '../../channels/outbound';
import type { ToolContext } from '../../conversations/manager';
import type { HostToolResult } from '../../engines/types';
import { extractDocument } from '../documents';
import { publishTools } from '../publish';
import { fromMarkdown, toMarkdown } from './blocks';
import { fileName } from './formats';
import { sealHtml } from './html';
import { ChromiumPrinter, type Printer } from './printer';
import { makeCsv, parseCsv } from './sheets';
import { FileError, FileMaker, markdownSlides, sealSvg } from './tools';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

const folders: string[] = [];
afterEach(async () => {
  for (const path of folders.splice(0)) await rm(path, { recursive: true, force: true });
});

/** No browser: Conch's own writers, and refusals where one is needed. */
const noBrowser: Printer = {
  pdf: () => Promise.resolve(undefined),
  picture: () => Promise.resolve(undefined),
  by: () => undefined,
  close: () => Promise.resolve(),
};

async function setup(printer: Printer = noBrowser, conversationId = 'chat-1') {
  const home = await mkdtemp(join(tmpdir(), 'conch-make-'));
  folders.push(home);
  const cwd = join(home, 'work');
  await mkdir(cwd);
  const store = new AttachmentStore(join(home, 'attachments'));
  await mkdir(store.dir);
  const events: unknown[] = [];
  const ctx = {
    conversationId,
    signal: new AbortController().signal,
    append: (event: unknown) => events.push(event),
  } as unknown as ToolContext;
  const maker = new FileMaker({ store, printer });
  const tools = maker.tools(ctx, async () => ({ cwd, readableDirs: [store.dir] }));
  const tool = (name: string) => {
    const found = tools.find((t) => t.name === name);
    if (!found) throw new Error(name);
    return (args: Record<string, unknown>) => found.run(args as never) as Promise<HostToolResult>;
  };
  const progress = () =>
    events.flatMap((e) => {
      const parsed = ToolProgress.safeParse(e);
      return parsed.success ? [parsed.data] : [];
    });
  return { home, cwd, store, ctx, tool, events, progress, maker };
}

const out = (result: HostToolResult) =>
  JSON.parse(result.text) as Record<string, unknown> & { id: string };

async function bytesOf(store: AttachmentStore, id: string) {
  const found = await store.get(id);
  return { attachment: found?.attachment as Attachment, bytes: await readFile(found?.path ?? '') };
}

const signal = () => new AbortController().signal;

const REPORT = `# Quarterly report

Revenue grew **12%** in Q3, led by *Europe*. See [the site](https://example.com).

## Highlights

- New customers: 42
- Churn down
  - especially in retail
1. First
2. Second

| Region | Revenue |
|---|---:|
| Europe | 1200 |
| Asia | 800 |

> A quote worth keeping.

\`\`\`js
console.log('hi');
\`\`\`
`;

describe('file_make', () => {
  it('makes a PDF from HTML without a browser too, keeping its words in any script', async () => {
    const why: Printer = {
      ...noBrowser,
      problem: () => ({ message: 'Chromium wouldn’t start to print' }),
    };
    const { tool, store } = await setup(why);
    const made = out(
      await tool('file_make')({
        format: 'pdf',
        name: 'menu',
        html: '<html><body><h1>Μενού</h1><p>Καλημέρα · Привет · café</p><script>x()</script></body></html>',
      }),
    );
    expect(made).toMatchObject({ name: 'menu.pdf', mime: 'application/pdf', pages: 1 });
    const text = (
      await extractDocument((await bytesOf(store, made.id)).bytes, 'm.pdf', 0, 2, signal())
    ).sections
      .map((s) => s.text)
      .join(' ');
    expect(text).toContain('café');
    expect(text).not.toContain('x()');
    const warnings = (made.warnings as string[]).join(' ');
    // Why, in words to pass on, and no reason to go and install something else.
    expect(warnings).toContain('Chromium wouldn’t start to print');
    expect(warnings).toContain('don’t install anything');
    expect(warnings).toContain('words are kept');
  });

  it('makes a PDF from Markdown with the built-in writer when there is no browser', async () => {
    const { tool, store, progress } = await setup();
    const result = await tool('file_make')({ format: 'pdf', name: 'Q3 report', markdown: REPORT });
    const made = out(result);
    expect(made).toMatchObject({ name: 'Q3 report.pdf', mime: 'application/pdf', pages: 1 });
    const { bytes, attachment } = await bytesOf(store, made.id);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(attachment.pages).toBe(1);
    const read = await extractDocument(bytes, 'Q3 report.pdf', 0, 5, signal());
    const text = read.sections.map((s) => s.text).join(' ');
    expect(text).toContain('Quarterly report');
    expect(text).toContain('Europe');
    expect(made.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('built-in PDF writer')]),
    );
    expect(result.view).toEqual({
      kind: 'downloads',
      items: [expect.objectContaining({ id: made.id })],
    });
    expect(String(made.message)).toContain('message_user');
    // Progress: queued first, never backwards, never 100%, and it says what it's doing.
    const steps = progress();
    expect(steps[0]).toMatchObject({ toolName: 'file_make', stage: 'queued', progress: 0 });
    expect(steps.at(-1)).toMatchObject({ stage: 'finishing' });
    for (let i = 1; i < steps.length; i++)
      expect(steps[i]?.progress ?? 0).toBeGreaterThanOrEqual(steps[i - 1]?.progress ?? 0);
    expect(steps.every((s) => (s.progress ?? 0) < 1)).toBe(true);
    expect(steps.some((s) => s.detail)).toBe(true);
    // Every event is one the log takes.
    for (const step of steps)
      expect(
        ConversationEvent.safeParse({
          conversationId: 'c',
          seq: 1,
          at: 1,
          type: 'tool.progress',
          ...step,
        }).success,
      ).toBe(true);
  });

  it('makes a Word document that opens, with its headings, lists and table', async () => {
    const { tool, store } = await setup();
    const made = out(
      await tool('file_make')({ format: 'docx', name: 'notes', title: 'Notes', markdown: REPORT }),
    );
    const { bytes, attachment } = await bytesOf(store, made.id);
    expect(attachment.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    const zip = unzipSync(new Uint8Array(bytes));
    expect(Object.keys(zip)).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        'word/document.xml',
        'word/styles.xml',
        'word/numbering.xml',
      ]),
    );
    const xml = strFromU8(zip['word/document.xml'] ?? new Uint8Array());
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:numPr>');
    const read = await extractDocument(bytes, 'notes.docx', 0, 5, signal());
    expect(read.sections[0]?.text).toContain('Revenue grew 12% in Q3');
    expect(read.sections[0]?.text).toContain('Europe');
  });

  it('makes a workbook with real numbers, dates and formulas, and a CSV that is safe to open', async () => {
    const { tool, store } = await setup();
    const sheets = [
      {
        name: 'Budget',
        rows: [
          ['Item', 'Cost', 'Date'],
          ['Rent', 1200, '2026-01-01'],
          ['Food', 300.5, '2026-01-02'],
          ['Total', { formula: 'SUM(B2:B3)' }, null],
        ],
      },
      { name: 'Notes', rows: [['=HYPERLINK("http://evil")'], ['ok']] },
    ];
    const xlsx = out(await tool('file_make')({ format: 'xlsx', name: 'Budget', sheets }));
    expect(xlsx).toMatchObject({ name: 'Budget.xlsx', sheets: 2 });
    const { bytes } = await bytesOf(store, xlsx.id);
    const read = await extractDocument(bytes, 'Budget.xlsx', 0, 5, signal());
    expect(read.totalSections).toBe(2);
    expect(read.sections[0]?.text).toContain('B2: 1200');
    expect(read.sections[0]?.text).toContain('[formula: SUM(B2:B3)');
    // A date is a date cell (an Excel day number), not text.
    expect(read.sections[0]?.text).toMatch(/C2: 46023\b/);
    const sheetXml = strFromU8(
      unzipSync(new Uint8Array(bytes))['xl/worksheets/sheet1.xml'] ?? new Uint8Array(),
    );
    expect(sheetXml).toContain('state="frozen"');
    expect(sheetXml).toContain('<autoFilter');

    const csv = out(await tool('file_make')({ format: 'csv', name: 'notes', sheets: [sheets[1]] }));
    const text = (await bytesOf(store, csv.id)).bytes.toString('utf8');
    expect(text.startsWith('﻿')).toBe(true);
    // A formula from a cell's text never runs when the CSV is opened.
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('makes a presentation with a slide each, its picture inside', async () => {
    const { tool, store } = await setup();
    const picture = await store.save({ name: 'shell.png', bytes: PNG });
    await store.claim([picture.id], 'chat-1');
    const made = out(
      await tool('file_make')({
        format: 'pptx',
        name: 'Pitch',
        slides: [
          { title: 'Conch', subtitle: 'A shell for every model' },
          { title: 'Why', bullets: ['**Every** provider', 'Your files'], image: picture.id },
          { title: 'Next', body: '- one\n  - nested\n- two' },
        ],
      }),
    );
    expect(made).toMatchObject({ name: 'Pitch.pptx', slides: 3 });
    const { bytes } = await bytesOf(store, made.id);
    const zip = unzipSync(new Uint8Array(bytes));
    expect(zip['ppt/media/image1.png']).toBeDefined();
    const read = await extractDocument(bytes, 'Pitch.pptx', 0, 5, signal());
    expect(read.totalSections).toBe(3);
    expect(read.sections[1]?.text).toContain('Every provider');
    expect(read.sections[2]?.text).toContain('nested');
  });

  it('makes text formats, JSON and charts as SVG; PNG charts need a browser', async () => {
    const { tool, store } = await setup();
    const md = out(await tool('file_make')({ format: 'md', name: 'a', markdown: '# Hi\n\nThere' }));
    expect((await bytesOf(store, md.id)).attachment.mimeType).toBe('text/markdown');
    const json = out(
      await tool('file_make')({ format: 'json', name: 'data', data: { a: [1, 2] } }),
    );
    expect(JSON.parse((await bytesOf(store, json.id)).bytes.toString('utf8'))).toEqual({
      a: [1, 2],
    });
    await expect(
      tool('file_make')({ format: 'json', name: 'bad', content: '{nope' }),
    ).rejects.toThrow('valid JSON');
    const chart = {
      type: 'bar',
      title: 'Sales',
      labels: ['Q1', 'Q2', 'Q3'],
      series: [
        { name: 'North', values: [3, 5, 4] },
        { name: 'South', values: [2, 1, 6] },
      ],
    };
    const svg = out(await tool('file_make')({ format: 'svg', name: 'sales', chart }));
    const drawn = (await bytesOf(store, svg.id)).bytes.toString('utf8');
    expect(drawn.startsWith('<svg')).toBe(true);
    expect(drawn).toContain('North');
    await expect(tool('file_make')({ format: 'png', name: 'sales', chart })).rejects.toThrow(
      'browser',
    );
    const html = out(
      await tool('file_make')({
        format: 'html',
        name: 'page',
        html: '<h1>Hi</h1><script>alert(1)</script>',
      }),
    );
    const page = (await bytesOf(store, html.id)).bytes.toString('utf8');
    expect(page).not.toContain('<script');
    expect(page).toContain("default-src 'none'");
  });

  it('prints with a browser when one is there, keeping a preview picture of the first page', async () => {
    const printed: string[] = [];
    const printer: Printer = {
      pdf: (html) => {
        printed.push(html);
        return Promise.resolve({ pdf: Buffer.from('%PDF-1.7\n%fake'), preview: PNG });
      },
      picture: () => Promise.resolve(PNG),
      by: () => 'Chrome',
      close: () => Promise.resolve(),
    };
    const { tool, store, progress } = await setup(printer);
    const made = out(
      await tool('file_make')({ format: 'pdf', name: 'r', markdown: '# Hi <b>x</b>' }),
    );
    // What the model wrote is text on the page, never markup.
    expect(printed[0]).toContain('Hi &lt;b&gt;x&lt;/b&gt;');
    expect(printed[0]).toContain("default-src 'none'");
    expect(typeof made.preview).toBe('string');
    const { attachment } = await bytesOf(store, made.id);
    expect(attachment.preview).toBe(made.preview);
    expect((await bytesOf(store, String(made.preview))).attachment.kind).toBe('image');
    expect(progress().some((p) => p.by === 'Chrome' && p.estimated)).toBe(true);
    // The preview is the card's, not one of the chat's files.
    const ctx = { conversationId: 'chat-1', signal: signal() } as ToolContext;
    const list = publishTools(ctx, async () => ({ cwd: '/' }), store).find(
      (t) => t.name === 'list_attachments',
    );
    const listed = JSON.parse(((await list?.run({ offset: 0 })) as HostToolResult).text) as {
      files: { id: string }[];
    };
    expect(listed.files.map((f) => f.id)).toEqual([made.id]);
    // A PNG chart is drawn by the browser and shown to models that can see.
    const chart = await tool('file_make')({
      format: 'png',
      name: 'c',
      chart: { type: 'line', labels: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] },
    });
    expect(chart.images?.[0]?.mimeType).toBe('image/png');
  });

  it('refuses what is too big, and keeps names inside its own folder', async () => {
    const huge: Printer = {
      pdf: () => Promise.resolve({ pdf: Buffer.alloc(31 * 1024 * 1024) }),
      picture: () => Promise.resolve(undefined),
      by: () => 'Chrome',
      close: () => Promise.resolve(),
    };
    const { tool, store } = await setup(huge);
    await expect(
      tool('file_make')({ format: 'pdf', name: 'big', markdown: '# x' }),
    ).rejects.toThrow('30 MB');
    const rows = Array.from({ length: 3000 }, () => Array.from({ length: 200 }, () => 1));
    const small = await setup();
    await expect(
      small.tool('file_make')({ format: 'xlsx', name: 'x', sheets: [{ name: 's', rows }] }),
    ).rejects.toThrow('cells');
    const made = out(
      await small.tool('file_make')({ format: 'txt', name: '../../etc/passwd', content: 'hi' }),
    );
    expect(made.name).toBe('passwd.txt');
    const found = await small.store.get(made.id);
    expect(relative(small.store.dir, found?.path ?? '/').startsWith('..')).toBe(false);
    expect(fileName('report.docx', 'pdf')).toBe('report.pdf');
    expect(fileName('CON', 'pdf')).toBe('_CON.pdf');
    void store;
  });

  it('runs one file at a time per chat, the next one waiting as queued', async () => {
    let release: () => void = () => undefined;
    const slow: Printer = {
      pdf: () =>
        new Promise((done) => {
          release = () => done({ pdf: Buffer.from('%PDF-1.7\n') });
        }),
      picture: () => Promise.resolve(undefined),
      by: () => 'Chrome',
      close: () => Promise.resolve(),
    };
    const { tool, progress } = await setup(slow);
    const first = tool('file_make')({ format: 'pdf', name: 'a', markdown: '# a' });
    await new Promise((r) => setTimeout(r, 20));
    const second = tool('file_make')({ format: 'md', name: 'b', markdown: '# b' });
    await new Promise((r) => setTimeout(r, 20));
    expect(
      progress()
        .filter((p) => p.stage === 'queued')
        .at(-1)?.detail,
    ).toContain('Waiting');
    release();
    await Promise.all([first, second]);
  });
});

describe('file_convert, file_combine, file_unzip', () => {
  it('converts CSV to a workbook and back, and workbooks to JSON', async () => {
    const { tool, store, cwd } = await setup();
    await writeFile(join(cwd, 'people.csv'), 'name;age;zip\nAda;36;007\nBo;41;123\n');
    const xlsx = out(await tool('file_convert')({ source: 'people.csv', to: 'xlsx' }));
    expect(xlsx).toMatchObject({ name: 'people.xlsx', sheets: 1, from: 'people.csv' });
    const json = out(await tool('file_convert')({ source: xlsx.id, to: 'json' }));
    expect(JSON.parse((await bytesOf(store, json.id)).bytes.toString('utf8'))).toEqual([
      { name: 'Ada', age: 36, zip: '007' },
      { name: 'Bo', age: 41, zip: 123 },
    ]);
    const csv = out(await tool('file_convert')({ source: xlsx.id, to: 'csv' }));
    expect(parseCsv((await bytesOf(store, csv.id)).bytes.toString('utf8'))).toEqual([
      ['name', 'age', 'zip'],
      ['Ada', '36', '007'],
      ['Bo', '41', '123'],
    ]);
  });

  it('converts Word to Markdown and PDF, and a PDF back to text', async () => {
    const { tool, store } = await setup();
    const docx = out(await tool('file_make')({ format: 'docx', name: 'memo', markdown: REPORT }));
    const md = out(await tool('file_convert')({ source: docx.id, to: 'md' }));
    const text = (await bytesOf(store, md.id)).bytes.toString('utf8');
    expect(text).toContain('# Quarterly report');
    expect(text).toContain('**12%**');
    expect(text).toContain('- New customers: 42');
    expect(text).toContain('| Europe | 1200 |');
    const pdf = out(await tool('file_convert')({ source: docx.id, to: 'pdf' }));
    expect(pdf).toMatchObject({ mime: 'application/pdf' });
    const back = out(await tool('file_convert')({ source: pdf.id, to: 'txt' }));
    expect((await bytesOf(store, back.id)).bytes.toString('utf8')).toContain('Quarterly report');
  });

  it('merges PDFs and pictures into one PDF, in order', async () => {
    const { tool } = await setup();
    const a = out(await tool('file_make')({ format: 'pdf', name: 'a', markdown: '# A' }));
    const b = out(
      await tool('file_make')({
        format: 'pdf',
        name: 'b',
        markdown: '# B\n\n<!-- pagebreak -->\n\nmore',
      }),
    );
    const merged = out(
      await tool('file_combine')({ sources: [a.id, b.id], to: 'pdf', name: 'both' }),
    );
    expect(merged).toMatchObject({ name: 'both.pdf', pages: 3, files: 2 });
    const txt = out(await tool('file_make')({ format: 'txt', name: 't', content: 'x' }));
    await expect(
      tool('file_combine')({ sources: [a.id, txt.id], to: 'pdf', name: 'x' }),
    ).rejects.toThrow('Convert it to PDF first');
  });

  it('zips files and unpacks them again, refusing paths that leave the archive', async () => {
    const { tool, store } = await setup();
    const one = out(await tool('file_make')({ format: 'txt', name: 'one', content: 'first' }));
    const two = out(await tool('file_make')({ format: 'txt', name: 'one', content: 'second' }));
    const zip = out(
      await tool('file_combine')({ sources: [one.id, two.id], to: 'zip', name: 'Bundle' }),
    );
    expect(zip).toMatchObject({ name: 'Bundle.zip', mime: 'application/zip' });
    const unpacked = JSON.parse((await tool('file_unzip')({ source: zip.id })).text) as {
      files: { id: string; name: string }[];
    };
    expect(unpacked.files.map((f) => f.name)).toEqual(['one.txt', 'one (2).txt']);
    expect((await bytesOf(store, unpacked.files[1]?.id ?? '')).bytes.toString('utf8')).toBe(
      'second\n',
    );

    const { zipSync, strToU8 } = await import('fflate');
    const evil = await store.save({
      name: 'evil.zip',
      bytes: Buffer.from(zipSync({ '../escape.txt': strToU8('x'), 'ok.txt': strToU8('fine') })),
    });
    await store.claim([evil.id], 'chat-1');
    const result = JSON.parse((await tool('file_unzip')({ source: evil.id })).text) as {
      files: { name: string }[];
      skipped: string[];
    };
    expect(result.files.map((f) => f.name)).toEqual(['ok.txt']);
    expect(result.skipped[0]).toContain('unsafe');
  });

  it('reads only this chat’s files and the work folder', async () => {
    const { tool, store, home } = await setup();
    const other = await store.save({ name: 'secret.txt', bytes: Buffer.from('theirs') });
    await store.claim([other.id], 'another-chat');
    await expect(tool('file_convert')({ source: other.id, to: 'pdf' })).rejects.toThrow('no file');
    await writeFile(join(home, 'outside.txt'), 'nope');
    await expect(tool('file_convert')({ source: '../outside.txt', to: 'pdf' })).rejects.toThrow();
  });
});

describe('reading what the person sends', () => {
  it('gives a provider that can’t open files the words of a PDF or Word file, and a path to one that can', async () => {
    const { tool, store } = await setup();
    const docx = out(await tool('file_make')({ format: 'docx', name: 'memo', markdown: REPORT }));
    const pdf = out(await tool('file_make')({ format: 'pdf', name: 'memo', markdown: REPORT }));
    const attachments = (await store.forConversation('chat-1')).filter((a) =>
      [docx.id, pdf.id].includes(a.id),
    );
    const chat = await forTurn(store, attachments, { images: true, files: false });
    expect(chat.block).toContain('taken out by Conch');
    expect(chat.block).toContain('Revenue grew 12% in Q3');
    expect(chat.block).toContain(`id="${docx.id}"`);
    expect(chat.block).not.toContain('path=');
    const agent = await forTurn(store, attachments, { images: true, files: true });
    expect(agent.block).toContain('read_document');
    expect(agent.block).not.toContain('taken out by Conch');
  });

  it('lets read_document and read_file take this chat’s files by id, and no other chat’s', async () => {
    const { documentTools } = await import('../documents');
    const { fileTools } = await import('../tools');
    const { tool, store, ctx, cwd } = await setup();
    const docx = out(await tool('file_make')({ format: 'docx', name: 'memo', markdown: REPORT }));
    const md = out(await tool('file_make')({ format: 'md', name: 'notes', markdown: '# Notes' }));
    const access = async () => ({ cwd, readableDirs: [store.dir] });
    const read = documentTools(ctx, access, store)[0];
    const text = JSON.parse(
      String(await read?.run({ file_path: docx.id, offset: 0, limit: 5, text_offset: 0 } as never)),
    );
    expect(text.sections[0].text).toContain('Quarterly report');
    const readFile_ = fileTools(ctx, access, store).find((t) => t.name === 'read_file');
    expect(
      String(await readFile_?.run({ file_path: md.id, offset: 0, limit: 10 } as never)),
    ).toContain('# Notes');
    const other = await store.save({ name: 'x.md', bytes: Buffer.from('theirs') });
    await store.claim([other.id], 'another-chat');
    await expect(
      readFile_?.run({ file_path: other.id, offset: 0, limit: 10 } as never),
    ).rejects.toThrow('no attachment');
  });
});

describe('the pieces', () => {
  it('reads Markdown into blocks and writes it back', () => {
    const doc = fromMarkdown(REPORT);
    expect(doc.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'list',
      'list',
      'table',
      'quote',
      'code',
    ]);
    const again = fromMarkdown(toMarkdown(doc));
    expect(again.map((b) => b.type)).toEqual(doc.map((b) => b.type));
    // Raw HTML stays text.
    expect(fromMarkdown('<script>x</script>')[0]).toMatchObject({ type: 'paragraph' });
  });

  it('splits Markdown into slides at its headings', () => {
    const slides = markdownSlides('# Deck\nA subtitle\n## One\n- a\n## Two\nwords');
    expect(slides.map((s) => [s.layout, s.title])).toEqual([
      ['title', 'Deck'],
      ['content', 'One'],
      ['content', 'Two'],
    ]);
    expect(slides[0]?.subtitle).toBe('A subtitle');
  });

  it('seals HTML and SVG the model wrote', () => {
    const html = sealHtml(
      '<html><head></head><body onload="x()"><iframe src="https://e.com"></iframe><a href="javascript:alert(1)">a</a><img src="https://track.er/p.png"></body></html>',
    );
    expect(html).not.toMatch(/onload|<iframe|javascript:/);
    expect(html).toContain("default-src 'none'; img-src data:");
    const svg = sealSvg(
      '<svg><script>1</script><a xlink:href="https://e.com"><text onclick="x">t</text></a><image href="https://e.com/a.png"/></svg>',
    );
    expect(svg).not.toMatch(/script|onclick|https:/);
  });

  it('seals HTML whose tags come back together when one is taken out', () => {
    const attacks = [
      '<scr<script></script>ipt>alert(1)</script>',
      '<script>alert(1)</script foo="bar">',
      '<SCRIPT>alert(1)</SCRIPT >',
      '<script>never closed',
      '<ifr<iframe>ame src="https://e.com"></iframe>',
      '<img src=x on onerror=1 error=alert(1)>',
      '<img src="x"onerror=alert(1)>',
      '<svg/onload=alert(1)>',
      '<img src=x o onclick="1"nerror=alert(1)>',
      '<met<meta>a http-equiv="refresh" content="0;url=https://e.com">',
    ];
    for (const attack of attacks) {
      const html = sealHtml(`<p>hi</p>${attack}`);
      expect(html, attack).not.toMatch(
        /<script|<iframe|<meta http-equiv="refresh"|[\s/"']on[a-z]+\s*=/i,
      );
      expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('hi'));
    }
    // A page that keeps making new tags is shown as its words.
    const tangled = `${'<ifr'.repeat(40)}<iframe>${'ame>'.repeat(40)}`;
    expect(sealHtml(tangled)).not.toMatch(/<iframe/i);
    expect(sealHtml(tangled)).toContain('<pre>&lt;ifr');
    // A handler goes, the quote before it stays: the next attribute can't shift.
    expect(sealHtml('<a title="x"onclick=y href="#">a</a>')).toContain(
      '<a title="x" href="#">a</a>',
    );
  });

  it('puts the CSP before anything the page says, a <head> in a comment or not', () => {
    for (const page of [
      '<!-- <head> --><html><head><title>t</title></head><body>x</body></html>',
      '<!DOCTYPE html><html lang="en"><body><head></head>x</body></html>',
    ]) {
      const html = sealHtml(page);
      expect(
        html.startsWith(
          '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"',
        ),
      ).toBe(true);
      expect(html.match(/<!doctype/gi)).toHaveLength(1);
      expect(html).toContain("form-action 'none'");
    }
    expect(sealHtml('<p>a < b</p>')).toContain('<body><p>a < b</p></body>');
  });

  it('seals SVG by rebuilding it, so nothing a filter would miss gets through', () => {
    const attacks = [
      '<svg><scr<script>1</script>ipt>alert(1)</script></svg>',
      '<svg><script >1</script foo></svg>',
      '<svg xmlns:x="http://www.w3.org/2000/svg"><x:script>alert(1)</x:script></svg>',
      '<svg><rect x="1"onload="alert(1)"/></svg>',
      '<svg><rect ONLOAD="alert(1)"/></svg>',
      '<svg><a href=javascript:alert(1)><text>t</text></a></svg>',
      '<svg><a xlink:href=" javascript:alert(1)"><text>t</text></a></svg>',
      '<svg><a href="#"><set attributeName="href" to="javascript:alert(1)"/></a></svg>',
      '<svg><animate attributeName="onclick" values="alert(1)"/></svg>',
      '<svg><foreignObject><iframe src="https://e.com"/></foreignObject></svg>',
      '<svg><g xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></g></svg>',
      '<svg><h:iframe xmlns:h="http://www.w3.org/1999/xhtml" src="https://e.com"/></svg>',
      '<?xml-stylesheet type="text/xsl" href="https://e.com/x.xsl"?><svg/>',
      '<svg><text>&lt;script&gt;alert(1)&lt;/script&gt;</text></svg>',
    ];
    for (const attack of attacks) {
      const svg = sealSvg(attack);
      expect(svg, attack).not.toMatch(
        /<[\w:]*script|\son[a-z]+=|javascript:|https:|<iframe|<img|xml-stylesheet/i,
      );
    }
    expect(sealSvg(`<svg><rect title='" onload="x'/></svg>`)).toBe(
      '<svg><rect title="&quot; onload=&quot;x"/></svg>',
    );
    expect(sealSvg('<svg><text>&lt;b&gt; &amp; c</text></svg>')).toBe(
      '<svg><text>&lt;b&gt; &amp; c</text></svg>',
    );
    expect(() => sealSvg('<svg><!-- never closed')).toThrow(FileError);
  });

  it('keeps an ordinary SVG as it was written', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" width="10">\n' +
      '  <!-- a dot -->\n  <defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>\n' +
      '  <style><![CDATA[ .a { fill: url(#g) } ]]></style>\n' +
      '  <use xlink:href="#g"/><image href="data:image/png;base64,AAAA"/>\n' +
      '  <circle class="a" cx="5" cy="5" r="4"><animate attributeName="r" values="4;3;4" dur="1s"/></circle>\n' +
      '  <text x="1" y="9">A &amp; B</text>\n</svg>';
    expect(sealSvg(svg)).toBe(svg);
  });

  it('writes CSV a spreadsheet reads back exactly', () => {
    const rows = [['a,b', 'say "hi"', 'line\nbreak', '-5', '@sum', 3]];
    const text = makeCsv(rows).toString('utf8');
    expect(parseCsv(text)).toEqual([['a,b', 'say "hi"', 'line\nbreak', '-5', "'@sum", '3']]);
  });
});

describe('sending made files to chat apps', () => {
  it('sends a document made from words to whoever the chat is with, and the rest only to the owner', () => {
    expect(mayCarry({ name: 'mcp__conch__file_make', input: { format: 'pdf' } }, false)).toBe(true);
    expect(mayCarry({ name: 'file_convert', input: { source: 'a.docx' } }, false)).toBe(false);
    expect(mayCarry({ name: 'file_combine', input: {} }, true)).toBe(true);
    expect(mayCarry({ name: 'file_unzip', input: {} }, false)).toBe(false);
  });
});

// A real browser, where this computer has one: the page prints, sealed.
const printer = new ChromiumPrinter();
describe.skipIf(!printer.by() || process.env.CONCH_SKIP_BROWSER === '1')(
  'printing with a real browser',
  () => {
    afterEach(() => printer.close());
    it('prints a PDF with a first-page preview, and never reaches the network', async () => {
      const { tool, store } = await setup(printer);
      const made = out(
        await tool('file_make')({
          format: 'pdf',
          name: 'printed',
          title: 'Printed',
          html: '<h1>Hello</h1><img src="https://example.com/track.png"><script>document.body.innerHTML="ran"</script>',
        }),
      );
      const { bytes } = await bytesOf(store, made.id);
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      const text = (await extractDocument(bytes, 'p.pdf', 0, 2, signal())).sections[0]?.text ?? '';
      expect(text).toContain('Hello');
      expect(text).not.toContain('ran');
      expect(typeof made.preview).toBe('string');
    }, 60_000);
  },
);
