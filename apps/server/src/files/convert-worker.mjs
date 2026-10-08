/**
 * Disposable converter for files Conch didn't make (see worker.ts): merging
 * PDFs, counting their pages, unpacking a zip, reading a workbook's cells or
 * a Word document's structure. Bytes in on stdin, JSON out on stdout; no
 * writes, no network, no subprocesses.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import pdfLib from 'pdf-lib';

const { PDFDocument } = pdfLib;

const MAX_EXPANDED = 40 * 1024 * 1024;
const MAX_PAGES = 3000;
const MAX_CELLS = 500_000;

const list = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const string = (x) => (typeof x === 'string' || typeof x === 'number' ? String(x) : '');
const unsafe = (name) =>
  name.includes('..') || name.startsWith('/') || name.includes('\\') || /^[a-z]:/i.test(name);

function officeZip(bytes) {
  let size = 0;
  let entries = 0;
  const zip = unzipSync(new Uint8Array(bytes), {
    filter: (entry) => {
      if (++entries > 10_000) throw new Error('The document contains too many archive entries.');
      if (unsafe(entry.name)) throw new Error('The document contains an unsafe archive path.');
      if (!entry.name.endsWith('.xml') && !entry.name.endsWith('.rels')) return false;
      size += entry.originalSize;
      if (size > MAX_EXPANDED || entry.originalSize > 20 * 1024 * 1024)
        throw new Error('The expanded document is too large. Split it into smaller documents.');
      return true;
    },
  });
  let actual = 0;
  for (const value of Object.values(zip)) {
    actual += value.length;
    if (actual > MAX_EXPANDED) throw new Error('The expanded document is too large.');
  }
  return zip;
}

function xmlText(zip, path) {
  const data = zip[path];
  if (!data) return undefined;
  const text = strFromU8(data);
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error('Documents with XML entity declarations cannot be read.');
  return text;
}

const flat = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  processEntities: true,
  parseTagValue: false,
  trimValues: false,
});
const ordered = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  removeNSPrefix: true,
  processEntities: true,
  parseTagValue: false,
  trimValues: false,
});

function texts(node) {
  if (!node || typeof node !== 'object') return '';
  if (Array.isArray(node)) return node.map(texts).join('');
  return Object.entries(node)
    .map(([key, value]) =>
      key === 't'
        ? list(value)
            .map((v) => (typeof v === 'object' ? string(v['#text']) : string(v)))
            .join('')
        : key.startsWith('@_')
          ? ''
          : texts(value),
    )
    .join('');
}

// ── PDF ─────────────────────────────────────────────────────────────────────

async function loadPdf(bytes) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/encrypt/i.test(message)) throw new Error('locked');
    throw new Error('One of the PDFs could not be read. Try saving a fresh copy of it.');
  }
}

async function merge(sources, size) {
  const out = await PDFDocument.create();
  out.setCreator('Conch');
  out.setProducer('Conch');
  const [pw, ph] = size === 'Letter' ? [612, 792] : [595.28, 841.89];
  for (const source of sources) {
    const bytes = Buffer.from(source.data, 'base64');
    if (source.type === 'pdf') {
      const doc = await loadPdf(bytes);
      if (out.getPageCount() + doc.getPageCount() > MAX_PAGES)
        throw new Error(`A merged PDF can have at most ${MAX_PAGES} pages.`);
      const pages = await out.copyPages(doc, doc.getPageIndices());
      for (const page of pages) out.addPage(page);
    } else {
      const image = source.type === 'png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);
      const [W, H] = image.width > image.height ? [ph, pw] : [pw, ph];
      const page = out.addPage([W, H]);
      const scale = Math.min((W - 72) / image.width, (H - 72) / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      page.drawImage(image, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
    }
  }
  const data = Buffer.from(await out.save());
  return { data: data.toString('base64'), pages: out.getPageCount() };
}

// ── ZIP ─────────────────────────────────────────────────────────────────────

function unzip(bytes, limit, maxEach) {
  const skipped = [];
  let seen = 0;
  let size = 0;
  let more = 0;
  const wanted = [];
  const zip = unzipSync(new Uint8Array(bytes), {
    filter: (entry) => {
      if (++seen > 5000) throw new Error('That archive has too many entries.');
      const name = entry.name;
      if (name.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store$)/.test(name)) return false;
      if (unsafe(name)) {
        skipped.push(`${name.slice(0, 120)} (an unsafe path)`);
        return false;
      }
      if (entry.originalSize > maxEach) {
        skipped.push(`${name.slice(0, 120)} (too large)`);
        return false;
      }
      if (wanted.length >= limit || size + entry.originalSize > MAX_EXPANDED) {
        more++;
        return false;
      }
      size += entry.originalSize;
      wanted.push(name);
      return true;
    },
  });
  let actual = 0;
  const files = [];
  for (const name of wanted) {
    const data = zip[name];
    if (!data) continue;
    actual += data.length;
    if (actual > MAX_EXPANDED || data.length > maxEach)
      throw new Error('That archive expands to more than it says. It was not unpacked.');
    if (!data.length) continue;
    files.push({ path: name, data: Buffer.from(data).toString('base64') });
  }
  return { files, more, skipped };
}

// ── Workbooks ───────────────────────────────────────────────────────────────

function columnIndex(ref) {
  const letters = /^([A-Z]+)/.exec(ref ?? '')?.[1];
  if (!letters) return undefined;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function workbook(bytes) {
  const zip = officeZip(bytes);
  const parse = (path) => {
    const text = xmlText(zip, path);
    if (text === undefined) throw new Error('The spreadsheet is missing a required part.');
    return flat.parse(text);
  };
  if (!zip['xl/workbook.xml']) throw new Error('This is not an Excel workbook (.xlsx).');
  const book = parse('xl/workbook.xml');
  const relationships = list(parse('xl/_rels/workbook.xml.rels').Relationships?.Relationship);
  const shared = zip['xl/sharedStrings.xml']
    ? list(parse('xl/sharedStrings.xml').sst?.si).map(texts)
    : [];
  let cells = 0;
  const sheets = list(book.workbook?.sheets?.sheet).map((sheet) => {
    const rel = relationships.find((r) => r['@_Id'] === sheet['@_id']);
    if (!rel || rel['@_TargetMode'] === 'External')
      throw new Error('The spreadsheet points to an external or missing worksheet.');
    const target = string(rel['@_Target']);
    if (unsafe(target) || /^[a-z]+:/i.test(target))
      throw new Error('The spreadsheet contains an unsafe worksheet reference.');
    const path = target.startsWith('/xl/') ? target.slice(1) : `xl/${target}`;
    const rows = [];
    for (const row of list(parse(path).worksheet?.sheetData?.row)) {
      const index = Number(row['@_r']) - 1;
      const at = Number.isInteger(index) && index >= 0 && index < 1_048_576 ? index : rows.length;
      const values = [];
      for (const cell of list(row.c)) {
        if (++cells > MAX_CELLS) throw new Error('That workbook has too many cells to convert.');
        const col = columnIndex(string(cell['@_r'])) ?? values.length;
        if (col > 16_383) continue;
        const type = cell['@_t'];
        const raw = typeof cell.v === 'object' ? string(cell.v?.['#text']) : string(cell.v);
        const value =
          type === 's'
            ? (shared[Number(raw)] ?? '')
            : type === 'inlineStr'
              ? texts(cell.is)
              : type === 'b'
                ? raw === '1'
                : type === 'str' || type === 'e'
                  ? raw
                  : raw === ''
                    ? null
                    : Number.isFinite(Number(raw))
                      ? Number(raw)
                      : raw;
        values[col] = value;
      }
      rows[at] = Array.from(values, (v) => (v === undefined ? null : v));
    }
    return { name: string(sheet['@_name']), rows: Array.from(rows, (r) => r ?? []) };
  });
  return { sheets };
}

// ── Word ────────────────────────────────────────────────────────────────────

const childrenOf = (node, key) => (Array.isArray(node?.[key]) ? node[key] : []);
const attrs = (node) => node?.[':@'] ?? {};
const tag = (node) => Object.keys(node).find((k) => k !== ':@');

function find(nodes, name) {
  for (const node of nodes) if (tag(node) === name) return node;
  return undefined;
}

function wordDocument(bytes) {
  const zip = officeZip(bytes);
  const main = xmlText(zip, 'word/document.xml');
  if (main === undefined) throw new Error('This is not a Word document (.docx).');
  const relsText = xmlText(zip, 'word/_rels/document.xml.rels');
  const links = new Map();
  if (relsText)
    for (const r of list(flat.parse(relsText).Relationships?.Relationship))
      if (r['@_TargetMode'] === 'External') links.set(r['@_Id'], string(r['@_Target']));
  // Which lists are numbered: numId → abstractNum → each level's format.
  const ordered_ = new Map();
  const numberingText = xmlText(zip, 'word/numbering.xml');
  if (numberingText) {
    const numbering = flat.parse(numberingText).numbering ?? {};
    const abstract = new Map(
      list(numbering.abstractNum).map((a) => [
        string(a['@_abstractNumId']),
        list(a.lvl).map((l) => string(l.numFmt?.['@_val'])),
      ]),
    );
    for (const num of list(numbering.num))
      ordered_.set(
        string(num['@_numId']),
        abstract.get(string(num.abstractNumId?.['@_val'])) ?? [],
      );
  }
  const styleNames = new Map();
  const stylesText = xmlText(zip, 'word/styles.xml');
  if (stylesText)
    for (const s of list(flat.parse(stylesText).styles?.style))
      styleNames.set(string(s['@_styleId']), string(s.name?.['@_val']).toLowerCase());

  const runsOf = (nodes, style = {}) => {
    const out = [];
    for (const node of nodes) {
      const name = tag(node);
      if (name === 'r') {
        const parts = childrenOf(node, 'r');
        const rPr = childrenOf(find(parts, 'rPr') ?? {}, 'rPr');
        const on = (key) => {
          const el = find(rPr, key);
          return el !== undefined && !/^(0|false|none)$/i.test(string(attrs(el)['@_val']));
        };
        const run = {
          ...style,
          ...(on('b') && { bold: true }),
          ...(on('i') && { italic: true }),
          ...(on('strike') && { strike: true }),
        };
        for (const part of parts) {
          const kind = tag(part);
          if (kind === 't')
            out.push({
              ...run,
              text: childrenOf(part, 't')
                .map((t) => string(t['#text']))
                .join(''),
            });
          else if (kind === 'tab') out.push({ ...run, text: '\t' });
          else if (kind === 'br' || kind === 'cr') out.push({ text: '', br: true });
          else if (kind === 'drawing' || kind === 'pict') out.push({ ...run, text: '[picture]' });
        }
      } else if (name === 'hyperlink') {
        const href = links.get(attrs(node)['@_id']);
        out.push(
          ...runsOf(childrenOf(node, 'hyperlink'), {
            ...style,
            ...(href && /^(https?:|mailto:)/i.test(href) && { link: href }),
          }),
        );
      } else if (
        name === 'ins' ||
        name === 'smartTag' ||
        name === 'sdt' ||
        name === 'sdtContent' ||
        name === 'fldSimple'
      )
        out.push(...runsOf(childrenOf(node, name), style));
    }
    return out;
  };

  const blocks = [];
  let list_ = undefined;
  const closeList = () => {
    list_ = undefined;
  };
  const paragraph = (node) => {
    const parts = childrenOf(node, 'p');
    const pPr = childrenOf(find(parts, 'pPr') ?? {}, 'pPr');
    const styleId = string(attrs(find(pPr, 'pStyle') ?? {})['@_val']);
    const style = styleNames.get(styleId) ?? styleId.toLowerCase();
    const runs = runsOf(parts);
    const numPr = childrenOf(find(pPr, 'numPr') ?? {}, 'numPr');
    const numId = string(attrs(find(numPr, 'numId') ?? {})['@_val']);
    const level = Math.min(8, Number(string(attrs(find(numPr, 'ilvl') ?? {})['@_val'])) || 0);
    const heading = /^heading ?([1-6])$/.exec(style)?.[1] ?? (style === 'title' ? '1' : undefined);
    if (numId && numId !== '0' && !heading) {
      const formats = ordered_.get(numId) ?? [];
      const isOrdered = (formats[level] ?? 'bullet') !== 'bullet' && formats[level] !== 'none';
      const item = { runs, children: [] };
      if (!list_ || list_.numId !== numId || (level === 0 && list_.block.ordered !== isOrdered)) {
        if (level === 0 || !list_) {
          const block = { type: 'list', ordered: isOrdered, start: 1, items: [] };
          blocks.push(block);
          list_ = { numId, block, stack: [block] };
        }
      }
      // Nest by level: each deeper level is a list inside the last item above it.
      const stack = list_.stack;
      while (stack.length > level + 1) stack.pop();
      while (stack.length < level + 1) {
        const parent = stack.at(-1).items.at(-1);
        if (!parent) break;
        const block = { type: 'list', ordered: isOrdered, start: 1, items: [] };
        parent.children.push(block);
        stack.push(block);
      }
      stack.at(-1).items.push(item);
      return;
    }
    closeList();
    if (!runs.some((r) => r.text.trim() || r.br)) return;
    if (heading) blocks.push({ type: 'heading', level: Number(heading), runs });
    else if (style === 'quote' || style === 'intense quote')
      blocks.push({ type: 'quote', blocks: [{ type: 'paragraph', runs }] });
    else blocks.push({ type: 'paragraph', runs });
  };
  const table = (node) => {
    closeList();
    const rows = childrenOf(node, 'tbl')
      .filter((n) => tag(n) === 'tr')
      .map((tr) =>
        childrenOf(tr, 'tr')
          .filter((n) => tag(n) === 'tc')
          .map((tc) => {
            const runs = [];
            for (const p of childrenOf(tc, 'tc').filter((n) => tag(n) === 'p')) {
              if (runs.length) runs.push({ text: ' ' });
              runs.push(...runsOf(childrenOf(p, 'p')));
            }
            return runs;
          }),
      );
    if (!rows.length) return;
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r) => [...r, ...Array.from({ length: width - r.length }, () => [])];
    blocks.push({
      type: 'table',
      header: pad(rows[0]),
      rows: rows.slice(1).map(pad),
      align: Array.from({ length: width }, () => null),
    });
  };
  const doc = ordered.parse(main);
  const documentNode = doc.find((n) => tag(n) === 'document');
  const body = find(childrenOf(documentNode, 'document'), 'body');
  const walk = (nodes) => {
    for (const node of nodes) {
      const name = tag(node);
      if (name === 'p') paragraph(node);
      else if (name === 'tbl') table(node);
      else if (name === 'sdt' || name === 'sdtContent') walk(childrenOf(node, name));
    }
  };
  walk(childrenOf(body, 'body'));
  return { blocks };
}

// ── Main ────────────────────────────────────────────────────────────────────

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 90 * 1024 * 1024) throw new Error('Input is too large.');
}
try {
  const request = JSON.parse(input);
  let result;
  if (request.op === 'merge') result = await merge(request.sources, request.size);
  else if (request.op === 'pages')
    result = { pages: (await loadPdf(Buffer.from(request.data, 'base64'))).getPageCount() };
  else if (request.op === 'unzip')
    result = unzip(Buffer.from(request.data, 'base64'), request.limit, request.maxEach);
  else if (request.op === 'xlsx') result = workbook(Buffer.from(request.data, 'base64'));
  else if (request.op === 'docx') result = wordDocument(Buffer.from(request.data, 'base64'));
  else throw new Error('Unknown operation.');
  process.stdout.write(JSON.stringify({ result }));
} catch (error) {
  const message = error instanceof Error ? error.message : 'The file could not be read.';
  process.stdout.write(
    JSON.stringify({
      error:
        message === 'locked' || /password|encrypted/i.test(message)
          ? 'This file is locked with a password. Use an unlocked copy.'
          : /invalid zip|unexpected EOF|invalid (?:block|distance|length)/i.test(message)
            ? 'This file is damaged or not what its name says.'
            : message.slice(0, 500),
    }),
  );
}
