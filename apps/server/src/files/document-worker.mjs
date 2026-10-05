/** Disposable parser: bytes only; no writes, native addons or subprocess permission. */
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

const MAX_EXPANDED = 40 * 1024 * 1024;
const MAX_TEXT = 60_000;
const xml = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  processEntities: true,
  parseTagValue: false,
  trimValues: false,
});
const list = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const string = (x) => (typeof x === 'string' || typeof x === 'number' ? String(x) : '');
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
function paragraphs(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const value of node) paragraphs(value, out);
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'p') out.push(...list(value).map(texts));
    else if (!key.startsWith('@_')) paragraphs(value, out);
  }
  return out;
}

async function extract(bytes, name, offset, limit, textOffset = 0) {
  const sections = [];
  const warnings = [];
  let total = 0;
  let remaining = MAX_TEXT;
  const add = (label, text) => {
    const cap = Math.min(remaining, 40_000);
    const truncated = text.length > textOffset + cap;
    const value = text.slice(textOffset, textOffset + cap);
    remaining -= value.length;
    sections.push({
      label,
      text: value,
      truncated,
      offset: offset + sections.length,
      totalCharacters: text.length,
      nextTextOffset: truncated ? textOffset + value.length : null,
    });
  };
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
      useWorkerFetch: false,
      disableFontFace: true,
      verbosity: 0,
    });
    try {
      const doc = await loading.promise;
      total = doc.numPages;
      for (let i = offset; i < Math.min(total, offset + limit); i++) {
        const page = await doc.getPage(i + 1);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
          .join('')
          .trim();
        add(`Page ${i + 1}`, text);
        if (!text)
          warnings.push(
            `Page ${i + 1} has no extractable text. It may be scanned; visual/OCR reading is needed.`,
          );
        page.cleanup();
      }
    } finally {
      await loading.destroy();
    }
  } else {
    let size = 0;
    let entries = 0;
    const zip = unzipSync(new Uint8Array(bytes), {
      filter: (entry) => {
        if (++entries > 10_000) throw new Error('The document contains too many archive entries.');
        if (entry.name.includes('..') || entry.name.startsWith('/') || entry.name.includes('\\'))
          throw new Error('The document contains an unsafe archive path.');
        if (!entry.name.endsWith('.xml') && !entry.name.endsWith('.rels')) return false;
        size += entry.originalSize;
        if (size > MAX_EXPANDED || entry.originalSize > 10 * 1024 * 1024)
          throw new Error('The expanded document is too large. Split it into smaller documents.');
        return true;
      },
    });
    let actual = 0;
    for (const value of Object.values(zip)) {
      actual += value.length;
      if (actual > MAX_EXPANDED) throw new Error('The expanded document is too large.');
    }
    const parse = (path) => {
      const data = zip[path];
      if (!data) throw new Error('The Office document is missing a required part.');
      const text = strFromU8(data);
      if (/<!DOCTYPE|<!ENTITY/i.test(text))
        throw new Error('Documents with XML entity declarations cannot be read.');
      return xml.parse(text);
    };
    if (zip['word/document.xml']) {
      // A Word document has no stable page numbers until laid out. Paragraph blocks do.
      const ordered = new XMLParser({
        preserveOrder: true,
        ignoreAttributes: false,
        removeNSPrefix: true,
        processEntities: true,
        parseTagValue: false,
        trimValues: false,
      });
      parse('word/document.xml');
      const content = ordered.parse(strFromU8(zip['word/document.xml']));
      const paraText = (node) =>
        Array.isArray(node)
          ? node.map(paraText).join('')
          : node && typeof node === 'object'
            ? Object.entries(node)
                .map(([key, value]) =>
                  key === '#text'
                    ? string(value)
                    : key === 'tab'
                      ? '\t'
                      : key === 'br'
                        ? '\n'
                        : key === ':@'
                          ? ''
                          : paraText(value),
                )
                .join('')
            : '';
      const paras = [];
      const walk = (node) => {
        if (Array.isArray(node)) {
          for (const part of node) walk(part);
        } else if (node && typeof node === 'object') {
          for (const [key, value] of Object.entries(node)) {
            if (key === 'p') paras.push(paraText(value));
            else if (key !== ':@') walk(value);
          }
        }
      };
      walk(content);
      total = Math.max(1, Math.ceil(paras.length / 100));
      for (let i = offset; i < Math.min(total, offset + limit); i++)
        add(
          `Paragraphs ${i * 100 + 1}–${Math.min(paras.length, (i + 1) * 100)}`,
          paras.slice(i * 100, (i + 1) * 100).join('\n'),
        );
      warnings.push(
        'Word page layout, images, headers, footers and tracked-change intent are not reconstructed. Labels refer to paragraph blocks.',
      );
    } else if (zip['xl/workbook.xml']) {
      const workbook = parse('xl/workbook.xml');
      const relationships = list(parse('xl/_rels/workbook.xml.rels').Relationships?.Relationship);
      const shared = zip['xl/sharedStrings.xml']
        ? list(parse('xl/sharedStrings.xml').sst?.si).map(texts)
        : [];
      const sheets = list(workbook.workbook?.sheets?.sheet);
      total = sheets.length;
      for (const sheet of sheets.slice(offset, offset + limit)) {
        const rel = relationships.find((r) => r['@_Id'] === sheet['@_id']);
        if (!rel || rel['@_TargetMode'] === 'External')
          throw new Error('The spreadsheet points to an external or missing worksheet.');
        const target = string(rel['@_Target']);
        if (target.includes('..') || target.includes('\\') || /^[a-z]+:/i.test(target))
          throw new Error('The spreadsheet contains an unsafe worksheet reference.');
        const path = target.startsWith('/xl/') ? target.slice(1) : `xl/${target}`;
        const rows = list(parse(path).worksheet?.sheetData?.row);
        const lines = rows.map((row) =>
          list(row.c)
            .map((cell) => {
              const type = cell['@_t'];
              const v =
                type === 's'
                  ? (shared[Number(cell.v)] ?? '')
                  : type === 'inlineStr'
                    ? texts(cell.is)
                    : string(cell.v);
              return `${string(cell['@_r'])}: ${v}${cell.f !== undefined ? ` [formula: ${string(cell.f)}; cached value]` : ''}`;
            })
            .join(' | '),
        );
        add(`Sheet: ${string(sheet['@_name'])}`, lines.join('\n'));
      }
      warnings.push(
        'Values are stored cell values; formulas are not run. Dates may be Excel serial numbers. Charts and formatting are not reconstructed.',
      );
    } else if (zip['ppt/presentation.xml']) {
      const presentation = parse('ppt/presentation.xml');
      const relationships = list(
        parse('ppt/_rels/presentation.xml.rels').Relationships?.Relationship,
      );
      const slides = list(presentation.presentation?.sldIdLst?.sldId).map((slide) => {
        const rel = relationships.find((r) => r['@_Id'] === slide['@_id']);
        if (!rel || rel['@_TargetMode'] === 'External')
          throw new Error('The presentation points to an external or missing slide.');
        const target = string(rel['@_Target']);
        if (target.includes('..') || target.includes('\\') || /^[a-z]+:/i.test(target))
          throw new Error('The presentation contains an unsafe slide reference.');
        return target.startsWith('/ppt/') ? target.slice(1) : `ppt/${target}`;
      });
      total = slides.length;
      for (let i = offset; i < Math.min(total, offset + limit); i++)
        add(`Slide ${i + 1}`, paragraphs(parse(slides[i])).join('\n'));
      warnings.push(
        'Slide text is extracted; diagrams, images and animations need visual inspection.',
      );
    } else
      throw new Error(
        'Use a PDF, DOCX, XLSX or PPTX file. Save older Office files in a current format first.',
      );
  }
  return {
    name,
    totalSections: total,
    sections,
    nextOffset: offset + sections.length < total ? offset + sections.length : null,
    warnings,
  };
}

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 43 * 1024 * 1024) throw new Error('Document input is too large.');
}
try {
  const { data, name, offset, limit, textOffset } = JSON.parse(input);
  const result = await extract(Buffer.from(data, 'base64'), name, offset, limit, textOffset);
  process.stdout.write(JSON.stringify({ result }));
} catch (error) {
  const message = error instanceof Error ? error.message : 'The document could not be read.';
  process.stdout.write(
    JSON.stringify({
      error: /password|encrypted/i.test(message)
        ? 'This document is locked. Attach an unlocked copy.'
        : message.slice(0, 500),
    }),
  );
}
