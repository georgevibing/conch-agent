/**
 * Disposable parser: bytes only; no writes, native addons or subprocess permission.
 *
 * Reads PDF; Word, Excel and PowerPoint (current and 97–2003); OpenDocument
 * text, sheets and slides; EPUB; RTF; email (.eml, .mbox, Outlook .msg); and
 * Jupyter notebooks. Every format is parsed here by hand or with the two
 * parsers allowed in (fflate, fast-xml-parser), with caps on what expands,
 * how deep anything nests and how much text comes out. Nothing in a file
 * runs: no macros, formulas, scripts or links.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

/** Most a zip may expand to, whatever its size; Open WebUI also caps the ratio. */
const MAX_EXPANDED = 40 * 1024 * 1024;
const MIN_EXPANDED = 10 * 1024 * 1024;
const MAX_RATIO = 100;
const MAX_TEXT = 60_000;
/** Most rows with values and columns shown of one sheet (Hermes Agent's caps). */
const MAX_ROWS = 5_000;
const MAX_COLUMNS = 256;
/** Most characters of one notebook cell's outputs. */
const MAX_OUTPUT = 4_000;
/** Most messages counted in a mailbox. */
const MAX_MESSAGES = 10_000;
/** Paragraphs per section of a long text. */
const BLOCK = 100;

const xmlOptions = {
  ignoreAttributes: false,
  removeNSPrefix: true,
  processEntities: true,
  parseTagValue: false,
  trimValues: false,
  // fast-xml-parser's own cap on nesting (100) stands: a file nested deeper is refused.
};
const xml = new XMLParser(xmlOptions);
const ordered = new XMLParser({ ...xmlOptions, preserveOrder: true });
const list = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const string = (x) => (typeof x === 'string' || typeof x === 'number' ? String(x) : '');
const locked = () => new Error('This document is encrypted.');

/** XML without entity declarations: a DOCTYPE may name a DTD (XHTML does), never define one. */
function checked(text) {
  if (/<!ENTITY|<!DOCTYPE[^>[]*\[/i.test(text))
    throw new Error('Documents with XML entity declarations cannot be read.');
  return text;
}

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

/** Sections that are all here already. */
const ready = (items, warnings = []) => ({
  total: items.length,
  get: (i) => items[i],
  warnings,
});

/** Lines of a long text, a hundred paragraphs a section. */
function blocks(lines, warnings = []) {
  const kept = lines.filter((line) => line.trim());
  const items = [];
  for (let i = 0; i < Math.max(1, kept.length); i += BLOCK)
    items.push({
      label: `Paragraphs ${i + 1}–${Math.min(kept.length, i + BLOCK)}`,
      text: kept.slice(i, i + BLOCK).join('\n'),
    });
  return ready(items, warnings);
}

// ── Tables ────────────────────────────────────────────────────────────────────

function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
function columnIndex(ref) {
  let n = 0;
  for (const c of ref.toUpperCase()) {
    const code = c.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + code - 64;
  }
  return n - 1;
}
const cellText = (value) =>
  string(value).slice(0, 1000).replace(/\r?\n/g, '<br>').replaceAll('|', '\\|').trim();

/**
 * A sheet as a Markdown table: its column letters across the top and each
 * row's own number first, so "B7" means what it does in the file. Rows
 * without values are left out; past `MAX_ROWS` it says so.
 * `rows`: `{ n, cells }`, `cells` a sparse array by column.
 */
function sheetTable(rows, name, warnings) {
  const kept = [];
  let width = 0;
  let wide = false;
  for (const row of rows) {
    if (!row.cells.some((v) => v !== undefined && v !== '')) continue;
    if (kept.length >= MAX_ROWS) {
      warnings.push(
        `Sheet “${name}” has more than ${MAX_ROWS} rows with values; only the first ${MAX_ROWS} are here.`,
      );
      break;
    }
    kept.push(row);
    if (row.cells.length > MAX_COLUMNS) wide = true;
    width = Math.max(width, Math.min(MAX_COLUMNS, row.cells.length));
  }
  if (wide)
    warnings.push(`Sheet “${name}” is wider than ${MAX_COLUMNS} columns; the rest are left out.`);
  if (!kept.length) return '(This sheet is empty.)';
  const columns = Array.from({ length: width }, (_, i) => columnName(i));
  return [
    `| # | ${columns.join(' | ')} |`,
    `|${' --- |'.repeat(width + 1)}`,
    ...kept.map(
      (row) =>
        `| ${row.n} | ${Array.from({ length: width }, (_, i) => cellText(row.cells[i])).join(' | ')} |`,
    ),
  ].join('\n');
}

/** A table in a document: its first row as the header. */
function docTable(rows) {
  const filled = rows.filter((row) => row.some((v) => v));
  if (!filled.length) return '';
  const width = Math.min(64, Math.max(...filled.map((r) => r.length)));
  const line = (row) =>
    `| ${Array.from({ length: width }, (_, i) => cellText(row[i])).join(' | ')} |`;
  return [line(filled[0]), `|${' --- |'.repeat(width)}`, ...filled.slice(1).map(line)].join('\n');
}

// ── HTML (EPUB chapters, email bodies, notebook outputs) ────────────────────────

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  shy: '',
  zwj: '',
  zwnj: '',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  times: '×',
  divide: '÷',
  plusmn: '±',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  aacute: 'á',
  ccedil: 'ç',
  ouml: 'ö',
  auml: 'ä',
  uuml: 'ü',
  szlig: 'ß',
  ntilde: 'ñ',
};
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,31});/gi, (whole, name) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
        ? String.fromCodePoint(code)
        : '�';
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}
const SKIPPED_TAGS = new Set([
  'script',
  'style',
  'head',
  'template',
  'svg',
  'math',
  'noscript',
  'iframe',
  'object',
  'title',
]);
const PARAGRAPH_TAGS = new Set(['p', 'blockquote', 'ul', 'ol', 'dl', 'figure', 'hr']);
const LINE_TAGS = new Set([
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'aside',
  'nav',
  'figcaption',
  'address',
  'dt',
  'dd',
  'form',
  'fieldset',
  'details',
  'summary',
  'center',
  'caption',
]);
function attribute(raw, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(raw);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : '';
}

/**
 * HTML's words, in Markdown's shapes: headings, lists, tables, links and
 * set text. One pass with `indexOf` into a list of pieces, so a hostile page
 * costs only its length; scripts, styles and comments are skipped, never run.
 */
function htmlToText(html, cap = 5_000_000) {
  const lower = html.toLowerCase();
  const buf = [];
  let size = 0;
  let pre = 0;
  let lists = 0;
  let cells = 0;
  const tables = [];
  const links = [];
  const push = (s) => {
    if (!s) return;
    buf.push(s);
    size += s.length;
  };
  const last = (n) => {
    let s = '';
    for (let k = buf.length - 1; k >= 0 && s.length < n; k--) s = buf[k].slice(-n) + s;
    return s.slice(-n);
  };
  const trimTail = () => {
    while (buf.length) {
      const piece = buf[buf.length - 1];
      let end = piece.length;
      while (end && (piece[end - 1] === ' ' || piece[end - 1] === '\t')) end--;
      size -= piece.length - end;
      if (end) {
        buf[buf.length - 1] = piece.slice(0, end);
        return;
      }
      buf.pop();
    }
  };
  const inCell = () => tables.length > 0 && cells > 0;
  const newline = (n) => {
    if (inCell()) {
      if (last(1) !== ' ') push(' ');
      return;
    }
    trimTail();
    if (!buf.length) return;
    const end = last(2);
    if (n === 1) {
      if (!end.endsWith('\n')) push('\n');
    } else if (end !== '\n\n') push(end.endsWith('\n') ? '\n' : '\n\n');
  };
  const text = (raw) => {
    if (!raw) return;
    let value = decodeEntities(raw);
    if (!pre) {
      value = value.replace(/\s+/g, ' ');
      const end = last(1);
      if (!end || end === '\n' || end === ' ') value = value.replace(/^ /, '');
    }
    push(value);
  };
  let i = 0;
  let gt = -1;
  while (i < html.length && size < cap) {
    const lt = html.indexOf('<', i);
    text(html.slice(i, lt === -1 ? html.length : lt));
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    if (gt < lt) gt = html.indexOf('>', lt);
    if (gt === -1) break;
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      if (html.startsWith('<![CDATA[', lt)) {
        const close = html.indexOf(']]>', lt);
        text(html.slice(lt + 9, close === -1 ? html.length : close));
        i = close === -1 ? html.length : close + 3;
      } else i = gt + 1;
      continue;
    }
    const raw = html.slice(lt + 1, gt);
    const m = /^(\/?)\s*([a-zA-Z][\w:.-]{0,40})/.exec(raw);
    if (!m) {
      text('<');
      i = lt + 1;
      continue;
    }
    i = gt + 1;
    const closing = m[1] === '/';
    const full = m[2].toLowerCase();
    const tag = full.slice(full.lastIndexOf(':') + 1);
    if (!closing && SKIPPED_TAGS.has(tag) && !raw.endsWith('/')) {
      const close = lower.indexOf(`</${full}`, i);
      const end = close === -1 ? -1 : lower.indexOf('>', close);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      newline(2);
      if (!closing && !inCell()) push(`${'#'.repeat(Number(heading[1]))} `);
      continue;
    }
    switch (tag) {
      case 'br':
        if (inCell()) push(' ');
        else {
          trimTail();
          push('\n');
        }
        break;
      case 'li':
        newline(1);
        if (!closing && !inCell()) push(`${'  '.repeat(Math.max(0, lists - 1))}- `);
        break;
      case 'ul':
      case 'ol':
        lists = Math.max(0, lists + (closing ? -1 : 1));
        newline(lists && !closing ? 1 : 2);
        break;
      case 'pre':
        newline(2);
        if (!inCell()) push(closing ? '```' : '```\n');
        if (closing) newline(2);
        pre = Math.max(0, pre + (closing ? -1 : 1));
        break;
      case 'table':
        if (closing) tables.pop();
        else tables.push({ rows: 0 });
        cells = 0;
        newline(2);
        break;
      case 'tr': {
        const table = tables.at(-1);
        if (!table) break;
        if (closing) {
          if (cells) {
            trimTail();
            push(' |');
            if (table.rows === 0) push(`\n|${' --- |'.repeat(cells)}`);
            table.rows++;
          }
          cells = 0;
        } else {
          cells = 0;
          newline(1);
          push('|');
        }
        break;
      }
      case 'td':
      case 'th':
        if (!tables.length || closing) break;
        if (cells) {
          trimTail();
          push(' |');
        }
        push(' ');
        cells++;
        break;
      case 'a':
        if (!closing) {
          if (links.length < 100) links.push({ href: attribute(raw, 'href'), at: buf.length });
        } else {
          const link = links.pop();
          // Only a short link's words are looked at again, so nesting can't cost twice.
          const words =
            link && buf.length - link.at <= 64 ? buf.slice(link.at).join('').trim() : '';
          if (link && /^(https?:|mailto:)/i.test(link.href) && words && words !== link.href)
            push(` <${link.href.slice(0, 500)}>`);
        }
        break;
      case 'img': {
        const alt = attribute(raw, 'alt').trim();
        if (alt) push(`[picture: ${alt.slice(0, 200)}]`);
        break;
      }
      case 'hr':
        newline(2);
        push('---');
        newline(2);
        break;
      default:
        if (PARAGRAPH_TAGS.has(tag)) newline(2);
        else if (LINE_TAGS.has(tag)) newline(1);
    }
  }
  return buf
    .join('')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Character sets ──────────────────────────────────────────────────────────────

/** Bytes as text in the charset they say; UTF-8, then Windows-1252, when they don't or lie. */
function decodeBytes(bytes, charset) {
  const label = string(charset)
    .trim()
    .toLowerCase()
    .replace(/^["']|["']$/g, '');
  if (label && !['us-ascii', 'ascii', 'utf-8', 'utf8'].includes(label))
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // Unknown to this computer: the guesses below.
    }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
/** A Windows code page (RTF's `\ansicpg`, Outlook's) as a TextDecoder label. */
function codePage(cp) {
  const pages = {
    932: 'shift_jis',
    936: 'gbk',
    949: 'euc-kr',
    950: 'big5',
    874: 'windows-874',
    10000: 'macintosh',
    65001: 'utf-8',
    20127: 'us-ascii',
    28591: 'iso-8859-1',
  };
  if (pages[cp]) return pages[cp];
  return cp >= 1250 && cp <= 1258 ? `windows-${cp}` : 'windows-1252';
}

// ── Email ─────────────────────────────────────────────────────────────────────

/** Most of a message's header kept: a message with megabytes of headers is cut, not refused. */
const MAX_HEADER = 256 * 1024;
const KNOWN_HEADERS = new Set([
  'from',
  'to',
  'subject',
  'date',
  'message-id',
  'received',
  'mime-version',
  'return-path',
  'delivered-to',
  'reply-to',
  'cc',
  'content-type',
]);

function splitEntity(raw) {
  if (/^\r?\n/.test(raw)) return { head: '', body: raw.replace(/^\r?\n/, '') };
  const gap = /\r?\n\r?\n/.exec(raw);
  return gap
    ? { head: raw.slice(0, gap.index), body: raw.slice(gap.index + gap[0].length) }
    : { head: raw, body: '' };
}

function parseHeaders(head) {
  const out = [];
  for (const line of head.slice(0, MAX_HEADER).split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && out.length) {
      const last = out[out.length - 1];
      if (last[1].length < 8000) last[1] += ` ${line.trim()}`;
    } else {
      const colon = line.indexOf(':');
      if (colon > 0 && colon < 80)
        out.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
    }
    if (out.length >= 2000) break;
  }
  return out;
}
const header = (headers, name) => headers.find(([n]) => n === name)?.[1];

function quotedPrintable(text, underscores = false) {
  const value = text.replace(/=\r?\n/g, '');
  const out = Buffer.alloc(value.length);
  let n = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(value.slice(i + 1, i + 3))) {
      out[n++] = parseInt(value.slice(i + 1, i + 3), 16);
      i += 2;
    } else out[n++] = underscores && c === '_' ? 0x20 : value.charCodeAt(i) & 0xff;
  }
  return out.subarray(0, n);
}

/** A header's words: raw UTF-8 (RFC 6532) and encoded words (RFC 2047) both decoded. */
function decodeHeader(value) {
  if (!value) return '';
  let text = value.slice(0, 8000);
  if (/[\x80-\xff]/.test(text)) text = decodeBytes(Buffer.from(text, 'latin1'));
  return text
    .replace(/(=\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=)\s+(?==\?)/g, '$1')
    .replace(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g, (_, charset, kind, words) => {
      const bytes =
        kind.toUpperCase() === 'B' ? Buffer.from(words, 'base64') : quotedPrintable(words, true);
      return decodeBytes(bytes, charset.split('*')[0]);
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function percent(text, charset) {
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(text.charCodeAt(i) & 0xff);
  }
  return decodeBytes(Buffer.from(bytes), charset);
}

/** `text/plain; charset="utf-8"`, with RFC 2231's `filename*=utf-8''…` and its continuations. */
function parseParams(value = '') {
  const parts = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < Math.min(value.length, 8000); i++) {
    const c = value[i];
    if (c === '\\' && quoted) {
      current += value[++i] ?? '';
      continue;
    }
    if (c === '"') quoted = !quoted;
    else if (c === ';' && !quoted) {
      parts.push(current);
      current = '';
    } else current += c;
  }
  parts.push(current);
  const main = (parts.shift() ?? '').trim().toLowerCase();
  const params = {};
  const continued = {};
  let charset = '';
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    let val = part.slice(eq + 1).trim();
    const m = /^([^*]+)\*(\d+)?(\*)?$/.exec(key);
    if (!m) {
      params[key] = val;
      continue;
    }
    const [, base, index, encoded] = m;
    if (index === undefined || encoded) {
      const prefixed = /^([^']*)'[^']*'(.*)$/.exec(val);
      if (prefixed && (index === undefined || index === '0')) {
        charset = prefixed[1];
        val = prefixed[2];
      }
      val = percent(val, charset);
    }
    (continued[base] ??= [])[Number(index ?? 0)] = val;
  }
  for (const [key, values] of Object.entries(continued)) params[key] = values.join('');
  return { value: main, params };
}

function splitMultipart(body, boundary) {
  const delimiter = `--${boundary}`;
  const parts = [];
  let at = body.startsWith(delimiter) ? 0 : body.indexOf(`\n${delimiter}`);
  if (at === -1) return parts;
  if (at > 0) at += 1;
  while (parts.length < 200) {
    if (body.startsWith(`${delimiter}--`, at)) break;
    const lineEnd = body.indexOf('\n', at);
    if (lineEnd === -1) break;
    const start = lineEnd + 1;
    const next = body.indexOf(`\n${delimiter}`, start);
    if (next === -1) {
      parts.push(body.slice(start));
      break;
    }
    parts.push(body.slice(start, body[next - 1] === '\r' ? next - 1 : next));
    at = next + 1;
  }
  return parts;
}

function parseEntity(raw, depth) {
  const { head, body } = splitEntity(raw);
  const headers = parseHeaders(head);
  const type = parseParams(header(headers, 'content-type') ?? 'text/plain');
  const disposition = parseParams(header(headers, 'content-disposition') ?? '');
  const entity = {
    headers,
    type: type.value || 'text/plain',
    params: type.params,
    disposition,
    body,
    encoding: (header(headers, 'content-transfer-encoding') ?? '').trim().toLowerCase(),
  };
  if (entity.type.startsWith('multipart/') && type.params.boundary && depth < 8)
    entity.children = splitMultipart(body, type.params.boundary).map((part) =>
      parseEntity(part, depth + 1),
    );
  return entity;
}

function entityBytes(entity) {
  if (entity.encoding === 'base64') return Buffer.from(entity.body, 'base64');
  if (entity.encoding === 'quoted-printable') return quotedPrintable(entity.body);
  return Buffer.from(entity.body, 'latin1');
}
function entitySize(entity) {
  if (entity.encoding === 'base64')
    return Math.floor((entity.body.replace(/[^A-Za-z0-9+/]/g, '').length * 3) / 4);
  return entity.body.length;
}
const entityName = (entity) =>
  decodeHeader(entity.disposition.params.filename ?? entity.params.name ?? '');

function sizeLabel(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** The words of a message, and the names of what it carries. */
function collect(entity, found, depth) {
  if (entity.children) {
    if (entity.type === 'multipart/alternative') {
      const plain = entity.children.find(
        (c) =>
          c.type === 'text/plain' && !entityName(c) && entityBytes(c).toString('latin1').trim(),
      );
      const pick = plain ?? entity.children.at(-1);
      if (pick) collect(pick, found, depth);
      return;
    }
    for (const child of entity.children) collect(child, found, depth);
    return;
  }
  const name = entityName(entity);
  if (entity.type === 'message/rfc822' && depth < 3) {
    const inner = readMail(entityBytes(entity).toString('latin1'), depth + 1);
    found.attachments.push({
      name: name || `${inner.subject || 'Forwarded message'}.eml`,
      type: entity.type,
      size: entitySize(entity),
    });
    found.text.push(`--- Attached message ---\n${inner.text}`);
    return;
  }
  if (/^attachment/.test(entity.disposition.value) || name || !entity.type.startsWith('text/')) {
    found.attachments.push({
      name: name || '(no name)',
      type: entity.type,
      size: entitySize(entity),
    });
    return;
  }
  const words = decodeBytes(entityBytes(entity), entity.params.charset);
  found.text.push(entity.type === 'text/html' ? htmlToText(words) : words.replace(/\r\n/g, '\n'));
}

/** One message as words: who, when, what about, its text, then what it carried. */
function mailText(fields, body, attachments) {
  const lines = fields.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  let text = `${lines.join('\n')}\n\n${body.replace(/\r\n?/g, '\n').trim().slice(0, 400_000) || '(The message has no text.)'}`;
  if (attachments.length)
    text += `\n\nAttachments (${attachments.length}):\n${attachments
      .slice(0, 200)
      .map((a) => `- ${a.name} (${a.type}${a.size ? `, ${sizeLabel(a.size)}` : ''})`)
      .join('\n')}`;
  return text;
}

function readMail(raw, depth = 0) {
  const entity = parseEntity(raw, 0);
  const h = (name) => decodeHeader(header(entity.headers, name));
  const found = { text: [], attachments: [] };
  collect(entity, found, depth);
  const subject = h('subject');
  return {
    subject,
    text: mailText(
      [
        ['From', h('from')],
        ['To', h('to')],
        ['Cc', h('cc')],
        ['Date', h('date')],
        ['Subject', subject],
      ],
      found.text.join('\n\n'),
      found.attachments,
    ),
  };
}

const MAIL_NOTE =
  'Attachments inside the message are listed by name and size; they are not opened. Ask for any that matter to be attached on their own.';

function openMail(latin) {
  const mail = readMail(latin);
  return ready(
    [
      {
        label: mail.subject ? `Message: ${mail.subject.slice(0, 120)}` : 'Message',
        text: mail.text,
      },
    ],
    [MAIL_NOTE],
  );
}

/** A mailbox (`.mbox`): each message a section, in the order they were saved. */
function openMbox(latin) {
  const starts = [0];
  for (
    let at = latin.indexOf('\nFrom ');
    at !== -1 && starts.length <= MAX_MESSAGES;
    at = latin.indexOf('\nFrom ', at + 1)
  )
    starts.push(at + 1);
  const warnings = [MAIL_NOTE];
  if (starts.length > MAX_MESSAGES) {
    starts.length = MAX_MESSAGES;
    warnings.push(`Only the first ${MAX_MESSAGES} messages are counted.`);
  }
  return {
    total: starts.length,
    get(i) {
      const raw = latin.slice(starts[i], starts[i + 1] ?? latin.length);
      const message = raw.slice(raw.indexOf('\n') + 1).replace(/^>(>*From )/gm, '$1');
      const mail = readMail(message);
      return {
        label: `Message ${i + 1}${mail.subject ? `: ${mail.subject.slice(0, 120)}` : ''}`,
        text: mail.text,
      };
    },
    warnings,
  };
}

function looksLikeMail(latin) {
  if (!/^[A-Za-z][A-Za-z0-9-]{0,76}:/.test(latin)) return false;
  const { head } = splitEntity(latin.slice(0, 64 * 1024));
  const names = new Set(parseHeaders(head).map(([n]) => n));
  return (
    [...KNOWN_HEADERS].filter((n) => names.has(n)).length >= 2 &&
    (names.has('from') || names.has('subject'))
  );
}

// ── RTF ───────────────────────────────────────────────────────────────────────

/** Groups whose words aren't the document's: fonts, colours, pictures, field codes. */
const RTF_SKIPPED = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'objdata',
  'themedata',
  'colorschememapping',
  'datastore',
  'latentstyles',
  'xmlnstbl',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'generator',
  'fldinst',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'filetbl',
  'revtbl',
  'pgdsctbl',
  'mmathPr',
  'xe',
  'tc',
  'bkmkstart',
  'bkmkend',
  'nonshppict',
  'shpinst',
  'sp',
  'atnauthor',
  'atnid',
  'annotation',
  'userprops',
  'docvar',
  'wgrffmtfilter',
  'pnseclvl',
  'fchars',
  'lchars',
]);
const RTF_SYMBOLS = {
  par: '\n',
  line: '\n',
  sect: '\n',
  page: '\n',
  tab: '\t',
  cell: ' | ',
  nestcell: ' | ',
  row: '\n',
  nestrow: '\n',
  emdash: '—',
  endash: '–',
  bullet: '•',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  emspace: ' ',
  enspace: ' ',
  qmspace: ' ',
};

/** An RTF document's words: control words are read, never acted on; one pass over the file. */
function rtfText(src) {
  let out = '';
  let pending = [];
  let codepage = 1252;
  let state = { skip: false, uc: 1 };
  let fallback = 0;
  const stack = [];
  const flush = () => {
    if (pending.length) out += decodeBytes(Buffer.from(pending), codePage(codepage));
    pending = [];
  };
  const emit = (s) => {
    if (state.skip) return;
    flush();
    out += s;
  };
  const byte = (b) => {
    if (state.skip) return;
    if (fallback > 0) fallback--;
    else pending.push(b);
  };
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '{') {
      if (stack.length >= 10_000) throw new Error('The document is nested too deeply to read.');
      stack.push(state);
      state = { ...state };
      i++;
    } else if (c === '}') {
      flush();
      state = stack.pop() ?? state;
      i++;
    } else if (c === '\\') {
      const next = src[i + 1] ?? '';
      if (/[a-zA-Z]/.test(next)) {
        const m = /^([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(src.slice(i + 1, i + 50));
        const word = m[1];
        const param = m[2] === undefined ? undefined : Number(m[2]);
        i += 1 + m[0].length;
        if (word === 'bin') {
          i += Math.max(0, param ?? 0);
          continue;
        }
        if (state.skip) continue;
        if (RTF_SKIPPED.has(word)) state.skip = true;
        else if (word === 'u' && param !== undefined) {
          emit(String.fromCharCode(param < 0 ? param + 65536 : param));
          fallback = state.uc;
        } else if (word === 'uc') state.uc = Math.max(0, param ?? 1);
        else if (word === 'ansicpg') codepage = param ?? 1252;
        else if (RTF_SYMBOLS[word] !== undefined) emit(RTF_SYMBOLS[word]);
      } else if (next === "'") {
        const hex = src.slice(i + 2, i + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) byte(parseInt(hex, 16));
        i += 4;
      } else {
        i += 2;
        if (next === '*') state.skip = true;
        else if (next === '~') emit(' ');
        else if (next === '_') emit('‑');
        else if (next === '\n' || next === '\r') emit('\n');
        else if (next === '\\' || next === '{' || next === '}') byte(next.charCodeAt(0));
      }
    } else {
      if (c !== '\r' && c !== '\n') byte(c.charCodeAt(0) & 0xff);
      i++;
    }
  }
  flush();
  return out;
}

// ── Notebooks ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex -- terminal colour codes are exactly what's removed
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const joined = (x) => (Array.isArray(x) ? x.join('') : string(x));
function shortened(text) {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… [output shortened]` : text;
}

/** A Jupyter notebook: its cells in order, code fenced, outputs shortened, pictures named. */
function openNotebook(json) {
  const nb = JSON.parse(json);
  const cells = Array.isArray(nb?.cells) ? nb.cells : nb?.worksheets?.[0]?.cells;
  if (!Array.isArray(cells)) throw new Error('This notebook has no cells.');
  const language = string(
    nb.metadata?.kernelspec?.language ?? nb.metadata?.language_info?.name ?? '',
  );
  const rendered = cells.slice(0, 20_000).map((cell, i) => {
    const kind = string(cell?.cell_type) || 'code';
    const source = joined(cell?.source ?? cell?.input);
    const lines = [`[Cell ${i + 1} · ${kind}]`];
    if (kind === 'code') lines.push(`\`\`\`${language}\n${source}\n\`\`\``);
    else lines.push(source);
    const outputs = [];
    for (const output of Array.isArray(cell?.outputs) ? cell.outputs : []) {
      const type = string(output?.output_type);
      if (type === 'stream') outputs.push(joined(output.text));
      else if (type === 'error' || type === 'pyerr')
        outputs.push(
          [
            `${string(output.ename)}: ${string(output.evalue)}`,
            ...list(output.traceback).slice(-12).map(string),
          ].join('\n'),
        );
      else {
        const data = output?.data ?? output ?? {};
        if (data['text/markdown']) outputs.push(joined(data['text/markdown']));
        else if (data['text/plain'] ?? data.text)
          outputs.push(joined(data['text/plain'] ?? data.text));
        else if (data['text/html']) outputs.push(htmlToText(joined(data['text/html'])));
        for (const key of Object.keys(data))
          if (key.startsWith('image/') || key === 'png' || key === 'jpeg')
            outputs.push(`[picture: ${key}]`);
      }
    }
    const shown = shortened(
      outputs
        .map((o) => o.replace(/\s+$/, ''))
        .join('\n')
        .replace(ANSI, '')
        .trim(),
    );
    if (shown) lines.push(`Output:\n\`\`\`\n${shown}\n\`\`\``);
    return lines.join('\n');
  });
  const items = [];
  for (let i = 0; i < Math.max(1, rendered.length); i += 25)
    items.push({
      label: `Cells ${i + 1}–${Math.min(rendered.length, i + 25)}`,
      text: rendered.slice(i, i + 25).join('\n\n'),
    });
  return ready(items, [
    'Code is shown, not run. Outputs are as last saved and shortened past 4 000 characters; pictures are named, not shown.',
  ]);
}

// ── OpenDocument ─────────────────────────────────────────────────────────────────

const tagOf = (node) => {
  for (const key in node) if (key !== ':@') return key;
  return undefined;
};
const kids = (node) => {
  const tag = node && tagOf(node);
  return tag && Array.isArray(node[tag]) ? node[tag] : [];
};
const attrOf = (node, key) => string(node?.[':@']?.[`@_${key}`]);
const child = (nodes, tag) => nodes.find((n) => tagOf(n) === tag);
const ODF_SKIPPED = new Set([
  'tracked-changes',
  'sequence-decls',
  'variable-decls',
  'user-field-decls',
  'forms',
  'annotation',
  'notes',
  'table-columns',
  'table-column',
  'scripts',
  'font-face-decls',
  'automatic-styles',
  'calculation-settings',
  'named-expressions',
  'database-ranges',
  'content-validations',
  'event-listeners',
  'soft-page-break',
]);

function odfInline(nodes) {
  let out = '';
  for (const node of nodes) {
    const tag = tagOf(node);
    if (tag === '#text') out += string(node['#text']).replace(/\s+/g, ' ');
    else if (tag === 's') out += ' '.repeat(Math.min(64, Number(attrOf(node, 'c')) || 1));
    else if (tag === 'tab') out += '\t';
    else if (tag === 'line-break') out += '\n';
    else if (tag === 'note-citation' || tag === 'annotation') continue;
    else if (tag === 'note-body') out += ` [note: ${odfBlocks(kids(node), []).join(' ')}]`;
    else out += odfInline(kids(node));
  }
  return out;
}

function odfBlocks(nodes, out, prefix = '') {
  for (const node of nodes) {
    const tag = tagOf(node);
    if (!tag || tag === '#text' || ODF_SKIPPED.has(tag)) continue;
    if (tag === 'h') {
      const level = Math.min(6, Math.max(1, Number(attrOf(node, 'outline-level')) || 1));
      const text = odfInline(kids(node)).trim();
      if (text) out.push(`${'#'.repeat(level)} ${text}`);
    } else if (tag === 'p') {
      const text = odfInline(kids(node)).trim();
      if (text) out.push(prefix + text);
    } else if (tag === 'list') {
      for (const item of kids(node))
        if (tagOf(item) === 'list-item' || tagOf(item) === 'list-header')
          odfBlocks(kids(item), out, prefix ? `  ${prefix}` : '- ');
    } else if (tag === 'table') {
      const table = docTable(odfRows(node).map((r) => Array.from(r.cells, (c) => c ?? '')));
      if (table) out.push(table);
    } else odfBlocks(kids(node), out, prefix);
  }
  return out;
}

/** A table's rows, with ODF's repeated rows and columns expanded only as far as they're shown. */
function odfRows(table) {
  const rows = [];
  let n = 0;
  const walk = (nodes) => {
    for (const node of nodes) {
      if (rows.length > MAX_ROWS) return;
      const tag = tagOf(node);
      if (tag === 'table-row') {
        const repeat = Math.min(
          10_000_000,
          Math.max(1, Number(attrOf(node, 'number-rows-repeated')) || 1),
        );
        const cells = [];
        let col = 0;
        for (const cell of kids(node)) {
          const kind = tagOf(cell);
          if (kind !== 'table-cell' && kind !== 'covered-table-cell') continue;
          const times = Math.min(
            100_000,
            Math.max(1, Number(attrOf(cell, 'number-columns-repeated')) || 1),
          );
          let value = kind === 'table-cell' ? odfBlocks(kids(cell), []).join(' ') : '';
          const formula = attrOf(cell, 'formula');
          if (value && formula) value += ` (${formula.replace(/^of:/, '')})`;
          if (value) for (let k = 0; k < times && col <= MAX_COLUMNS; k++) cells[col++] = value;
          else col += times;
          if (col > MAX_COLUMNS) break;
        }
        if (!cells.length) n += repeat;
        else
          for (let k = 0; k < repeat && rows.length <= MAX_ROWS; k++) rows.push({ n: ++n, cells });
      } else if (tag === 'table-header-rows' || tag === 'table-row-group' || tag === 'table-rows')
        walk(kids(node));
    }
  };
  walk(kids(table));
  return rows;
}

function openOdf(zip) {
  const manifest = zip['META-INF/manifest.xml'] ? strFromU8(zip['META-INF/manifest.xml']) : '';
  if (/encryption-data/.test(manifest)) throw locked();
  const content = ordered.parse(checked(strFromU8(zip['content.xml'])));
  const body = kids(child(kids(child(content, 'document-content')), 'body'));
  const text = child(body, 'text');
  const sheet = child(body, 'spreadsheet');
  const slides = child(body, 'presentation') ?? child(body, 'drawing');
  if (text)
    return blocks(odfBlocks(kids(text), []), [
      'Page layout, pictures, headers and footers are not included. Labels refer to paragraph blocks.',
    ]);
  if (sheet) {
    const warnings = [];
    const items = kids(sheet)
      .filter((n) => tagOf(n) === 'table')
      .map((table) => {
        const name = attrOf(table, 'name') || 'Sheet';
        return { label: `Sheet: ${name}`, text: sheetTable(odfRows(table), name, warnings) };
      });
    warnings.push(
      'Values are as last saved; formulas are shown, not run. Charts are not included.',
    );
    return ready(items, warnings);
  }
  if (slides) {
    const items = kids(slides)
      .filter((n) => tagOf(n) === 'page')
      .map((page, i) => {
        const words = odfBlocks(kids(page), []);
        const notes = odfBlocks(kids(child(kids(page), 'notes')), []);
        if (notes.length) words.push('', `Speaker notes: ${notes.join(' ')}`);
        return { label: `Slide ${i + 1}`, text: words.join('\n') };
      });
    return ready(items, [
      'Slide text is extracted; pictures, diagrams and animations need looking at.',
    ]);
  }
  throw new Error('This OpenDocument file has no text, sheets or slides Conch can read.');
}

// ── EPUB ──────────────────────────────────────────────────────────────────────

/** Fonts are "obfuscated" in many EPUBs; that's not DRM, and the words are still readable. */
const FONT_OBFUSCATION = new Set([
  'http://www.idpf.org/2008/embedding',
  'http://ns.adobe.com/pdf/enc#RC',
]);

/** A path in the book, from an `href` relative to `base`; never out of it, never a URL. */
function bookPath(base, href) {
  let ref = string(href).split('#')[0];
  try {
    ref = decodeURIComponent(ref);
  } catch {
    // Kept as it is.
  }
  if (!ref || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('/')) return undefined;
  const parts = [];
  for (const part of `${base}${ref}`.split('/')) {
    if (part === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function openEpub(zip) {
  const read = (path) => {
    const data = path && zip[path];
    if (!data) throw new Error('The book is missing a part it lists.');
    return strFromU8(data);
  };
  const encryption = zip['META-INF/encryption.xml']
    ? strFromU8(zip['META-INF/encryption.xml'])
    : '';
  for (const m of encryption.matchAll(/EncryptionMethod[^>]*?Algorithm\s*=\s*["']([^"']*)["']/g))
    if (!FONT_OBFUSCATION.has(m[1]))
      throw new Error('This book is encrypted (DRM). Attach a copy without DRM.');
  const container = xml.parse(checked(read('META-INF/container.xml')));
  const opfPath = bookPath('', list(container.container?.rootfiles?.rootfile)[0]?.['@_full-path']);
  const opf = xml.parse(checked(read(opfPath))).package ?? {};
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map(list(opf.manifest?.item).map((item) => [string(item['@_id']), item]));
  const values = (x) =>
    list(x)
      .map((v) => (typeof v === 'object' ? string(v['#text']) : string(v)).trim())
      .filter(Boolean);
  const meta = opf.metadata ?? {};

  // The table of contents' names for chapters (EPUB 2's NCX; EPUB 3 books carry one too, mostly).
  const titles = new Map();
  const ncx = manifest.get(string(opf.spine?.['@_toc']));
  const ncxPath = ncx && bookPath(base, ncx['@_href']);
  if (ncxPath && zip[ncxPath]) {
    const ncxBase = ncxPath.includes('/') ? ncxPath.slice(0, ncxPath.lastIndexOf('/') + 1) : '';
    const walk = (points) => {
      for (const point of list(points)) {
        const path = bookPath(ncxBase, point?.content?.['@_src']);
        const label = values(point?.navLabel?.text)[0];
        if (path && label && !titles.has(path)) titles.set(path, label.slice(0, 120));
        walk(point?.navPoint);
      }
    };
    walk(xml.parse(checked(strFromU8(zip[ncxPath]))).ncx?.navMap?.navPoint);
  }

  const items = [];
  for (const ref of list(opf.spine?.itemref)) {
    const item = manifest.get(string(ref['@_idref']));
    if (!item || !/html|xml/.test(string(item['@_media-type']))) continue;
    const path = bookPath(base, item['@_href']);
    if (!path || !zip[path]) continue;
    const text = htmlToText(strFromU8(zip[path]));
    if (!text) continue;
    const title = titles.get(path) ?? /^#{1,6} (.+)$/m.exec(text)?.[1]?.slice(0, 120);
    items.push({ label: `Chapter ${items.length + 1}${title ? `: ${title}` : ''}`, text });
  }
  const about = [
    ...values(meta.title)
      .slice(0, 1)
      .map((t) => `Title: ${t}`),
    ...(values(meta.creator).length ? [`By: ${values(meta.creator).join(', ')}`] : []),
    ...values(meta.publisher)
      .slice(0, 1)
      .map((t) => `Publisher: ${t}`),
    ...values(meta.date)
      .slice(0, 1)
      .map((t) => `Date: ${t}`),
    ...values(meta.language)
      .slice(0, 1)
      .map((t) => `Language: ${t}`),
    `Chapters: ${items.length}`,
    '',
    ...items.slice(0, 500).map((item, i) => `${i + 2}. ${item.label}`),
  ];
  return ready(
    [{ label: 'About this book', text: about.join('\n') }, ...items],
    [
      'Pictures and layout are not included. Section 1 lists the chapters; each chapter is its own section after it.',
    ],
  );
}

// ── Compound files: Outlook messages and Office 97–2003 ──────────────────────────

const FREE = 0xfffffffa;

/** The parts of an OLE compound file, read with every chain checked: no loops, nothing out of range. */
function compound(buf) {
  if (buf.length < 1024) throw new Error('This file is damaged.');
  const shift = buf.readUInt16LE(0x1e);
  if (shift !== 9 && shift !== 12) throw new Error('This file is damaged.');
  const size = 1 << shift;
  if (buf.readUInt16LE(0x20) !== 6) throw new Error('This file is damaged.');
  const sectors = Math.ceil((buf.length - size) / size);
  const sector = (id) => {
    if (id >= sectors) throw new Error('This file is damaged.');
    return buf.subarray((id + 1) * size, (id + 2) * size);
  };
  const fatSectors = [];
  for (let i = 0; i < 109; i++) {
    const id = buf.readUInt32LE(0x4c + i * 4);
    if (id < FREE) fatSectors.push(id);
  }
  for (let id = buf.readUInt32LE(0x44), hops = 0; id < FREE; hops++) {
    if (hops > sectors) throw new Error('This file is damaged.');
    const s = sector(id);
    for (let i = 0; i < size / 4 - 1; i++) {
      const fat = s.readUInt32LE(i * 4);
      if (fat < FREE) fatSectors.push(fat);
    }
    id = s.readUInt32LE(size - 4);
  }
  if (fatSectors.length > sectors) throw new Error('This file is damaged.');
  const fat = new Uint32Array(fatSectors.length * (size / 4));
  fatSectors.forEach((id, n) => {
    const s = sector(id);
    for (let i = 0; i < size / 4; i++) fat[n * (size / 4) + i] = s.readUInt32LE(i * 4);
  });
  const chain = (start, table, limit) => {
    const ids = [];
    for (let id = start; id < FREE; id = table[id]) {
      if (ids.length >= limit || id >= table.length) throw new Error('This file is damaged.');
      ids.push(id);
    }
    return ids;
  };
  const read = (start, length) =>
    Buffer.concat(chain(start, fat, sectors).map(sector)).subarray(0, length);
  const directory = read(buf.readUInt32LE(0x30), Infinity);
  const entries = [];
  for (let at = 0; at + 128 <= directory.length && entries.length < 100_000; at += 128) {
    const nameLength = Math.min(64, directory.readUInt16LE(at + 64));
    entries.push({
      name: directory.subarray(at, at + Math.max(0, nameLength - 2)).toString('utf16le'),
      type: directory[at + 66],
      left: directory.readUInt32LE(at + 68),
      right: directory.readUInt32LE(at + 72),
      child: directory.readUInt32LE(at + 76),
      start: directory.readUInt32LE(at + 116),
      size: directory.readUInt32LE(at + 120),
    });
  }
  const root = entries[0];
  if (!root || root.type !== 5) throw new Error('This file is damaged.');
  const cutoff = buf.readUInt32LE(0x38) || 4096;
  let mini;
  const miniStream = () => {
    if (!mini) {
      const table = read(buf.readUInt32LE(0x3c), Infinity);
      const miniFat = new Uint32Array(Math.floor(table.length / 4));
      for (let i = 0; i < miniFat.length; i++) miniFat[i] = table.readUInt32LE(i * 4);
      mini = { data: read(root.start, root.size), fat: miniFat };
    }
    return mini;
  };
  const stream = (entry) => {
    if (!entry || entry.type !== 2) return Buffer.alloc(0);
    if (entry.size >= cutoff) return read(entry.start, entry.size);
    const { data, fat: miniFat } = miniStream();
    const ids = chain(entry.start, miniFat, Math.ceil(data.length / 64) + 1);
    return Buffer.concat(
      ids.map((id) => {
        if ((id + 1) * 64 > data.length) throw new Error('This file is damaged.');
        return data.subarray(id * 64, (id + 1) * 64);
      }),
    ).subarray(0, entry.size);
  };
  /** A storage's own entries: its red-black tree walked without recursion, each entry once. */
  const children = (entry) => {
    const out = [];
    const seen = new Set();
    const todo = [entry.child];
    while (todo.length) {
      const id = todo.pop();
      if (id >= entries.length || seen.has(id)) continue;
      seen.add(id);
      const e = entries[id];
      out.push(e);
      todo.push(e.left, e.right);
    }
    return out;
  };
  return { root, children, stream };
}

const FILETIME_EPOCH = 11_644_473_600_000;

/** An Outlook message (.msg): its MAPI properties, read from the compound file. */
function openMsg(doc, top) {
  const prop = (entries, id) => {
    for (const [type, decode] of [
      ['001F', (b) => b.toString('utf16le')],
      ['001E', (b) => decodeBytes(b)],
      ['0102', (b) => decodeBytes(b)],
    ]) {
      const entry = entries.find((e) => e.name.toUpperCase() === `__SUBSTG1.0_${id}${type}`);
      if (entry) return decode(doc.stream(entry)).replace(/\0+$/, '');
    }
    return '';
  };
  let date = '';
  const props = doc.stream(top.find((e) => e.name === '__properties_version1.0'));
  for (let at = 32; at + 16 <= props.length; at += 16) {
    const tag = props.readUInt32LE(at);
    if ((tag >>> 16 === 0x0039 || tag >>> 16 === 0x0e06) && (tag & 0xffff) === 0x0040) {
      const ms =
        (props.readUInt32LE(at + 12) * 2 ** 32 + props.readUInt32LE(at + 8)) / 10_000 -
        FILETIME_EPOCH;
      if (Number.isFinite(ms) && ms > 0 && ms < 8.64e15) date = new Date(ms).toUTCString();
      if (date) break;
    }
  }
  const html = prop(top, '1013');
  const body = prop(top, '1000') || (html ? htmlToText(html) : '');
  const attachments = top
    .filter((e) => e.type === 1 && e.name.startsWith('__attach_version1.0_'))
    .slice(0, 200)
    .map((storage) => {
      const parts = doc.children(storage);
      const data = parts.find((e) => e.name.toUpperCase() === '__SUBSTG1.0_37010102');
      const message = parts.find((e) => e.name.toUpperCase() === '__SUBSTG1.0_3701000D');
      return {
        name:
          prop(parts, '3707') ||
          prop(parts, '3704') ||
          prop(parts, '3001') ||
          (message ? 'Attached message' : '(no name)'),
        type: prop(parts, '370E') || (message ? 'message/rfc822' : 'application/octet-stream'),
        size: data?.size ?? 0,
      };
    });
  const sender = prop(top, '0C1A');
  const address = prop(top, '5D01') || prop(top, '0C1F') || prop(top, '0065');
  const subject = prop(top, '0037');
  return ready(
    [
      {
        label: subject ? `Message: ${subject.slice(0, 120)}` : 'Message',
        text: mailText(
          [
            [
              'From',
              sender && address && sender !== address
                ? `${sender} <${address}>`
                : sender || address,
            ],
            ['To', prop(top, '0E04')],
            ['Cc', prop(top, '0E03')],
            ['Date', date],
            ['Subject', subject],
          ],
          body,
          attachments,
        ),
      },
    ],
    [MAIL_NOTE],
  );
}

/** A Word 97–2003 document: its main text from the piece table, field codes left out. */
function openDoc(doc, top) {
  const find = (name) => top.find((e) => e.name === name);
  const word = doc.stream(find('WordDocument'));
  if (word.length < 0x200 || word.readUInt16LE(0) !== 0xa5ec)
    throw new Error('This Word file is damaged.');
  const flags = word.readUInt16LE(0x0a);
  if (flags & 0x0100) throw locked();
  if (word.readUInt16LE(2) < 193)
    throw new Error(
      'This Word file is from Word 95 or earlier, which Conch reads only with LibreOffice.',
    );
  let at = 32;
  at += 2 + word.readUInt16LE(at) * 2;
  const longs = at + 2;
  at += 2 + word.readUInt16LE(at) * 4;
  at += 2;
  if (at + 34 * 8 > word.length) throw new Error('This Word file is damaged.');
  const ccpText = word.readInt32LE(longs + 12);
  const fcClx = word.readUInt32LE(at + 33 * 8);
  const lcbClx = word.readUInt32LE(at + 33 * 8 + 4);
  const table = doc.stream(find(flags & 0x0200 ? '1Table' : '0Table'));
  if (fcClx + lcbClx > table.length || lcbClx < 5) throw new Error('This Word file is damaged.');
  let i = fcClx;
  while (i < fcClx + lcbClx && table[i] === 0x01) i += 3 + table.readUInt16LE(i + 1);
  if (table[i] !== 0x02 || i + 5 > table.length) throw new Error('This Word file is damaged.');
  const lcb = table.readUInt32LE(i + 1);
  i += 5;
  if (i + lcb > table.length) throw new Error('This Word file is damaged.');
  const pieces = Math.floor((lcb - 4) / 12);
  let text = '';
  for (let k = 0; k < pieces && text.length < 20_000_000; k++) {
    const from = table.readUInt32LE(i + k * 4);
    if (from >= ccpText) break;
    const length = Math.min(table.readUInt32LE(i + (k + 1) * 4), ccpText) - from;
    if (length <= 0) continue;
    const fc = table.readUInt32LE(i + (pieces + 1) * 4 + k * 8 + 2);
    if (fc & 0x40000000) {
      const start = (fc & 0x3fffffff) / 2;
      if (start + length > word.length) throw new Error('This Word file is damaged.');
      text += new TextDecoder('windows-1252').decode(word.subarray(start, start + length));
    } else {
      if (fc + length * 2 > word.length) throw new Error('This Word file is damaged.');
      text += word.subarray(fc, fc + length * 2).toString('utf16le');
    }
  }
  // Fields are {begin instruction | result end}: keep the result, drop the instruction.
  let out = '';
  const fields = [];
  // A row's end is a cell mark after its last cell's: one line per row.
  for (const c of text.replaceAll('\x07\x07', '\x07\r')) {
    const code = c.charCodeAt(0);
    if (code === 0x13) fields.push(true);
    else if (code === 0x14) {
      if (fields.length) fields[fields.length - 1] = false;
    } else if (code === 0x15) fields.pop();
    else if (fields.includes(true)) continue;
    else if (code === 0x0d || code === 0x0b || code === 0x0c) out += '\n';
    else if (code === 0x07) out += ' | ';
    else if (code === 0x1e) out += '‑';
    else if (code === 0x09 || code >= 0x20) out += c;
    if (fields.length > 100) fields.length = 100;
  }
  return blocks(out.split('\n'), [
    'Read from an older Word file: page layout, pictures, headers, footers and footnotes are not included. Labels refer to paragraph blocks.',
  ]);
}

/** An Excel 97–2003 workbook (BIFF8): each sheet's stored values. */
function openXls(doc, top) {
  const book = doc.stream(top.find((e) => e.name === 'Workbook' || e.name === 'Book'));
  const records = (from) => {
    const out = [];
    for (let at = from; at + 4 <= book.length;) {
      const type = book.readUInt16LE(at);
      const length = book.readUInt16LE(at + 2);
      out.push({ type, data: book.subarray(at + 4, Math.min(book.length, at + 4 + length)) });
      at += 4 + length;
      if (type === 0x000a) break;
    }
    return out;
  };
  const globals = records(0);
  if (globals[0]?.type !== 0x0809 || globals[0].data.readUInt16LE(0) !== 0x0600)
    throw new Error(
      'This Excel file is from Excel 95 or earlier, which Conch reads only with LibreOffice.',
    );
  if (globals.some((r) => r.type === 0x002f)) throw locked();

  // Strings may run on into CONTINUE records, which start again with their own flags.
  const strings = [];
  const sstAt = globals.findIndex((r) => r.type === 0x00fc);
  if (sstAt >= 0) {
    const segments = [globals[sstAt].data];
    for (let k = sstAt + 1; globals[k]?.type === 0x003c; k++) segments.push(globals[k].data);
    let seg = 0;
    let pos = 8;
    const need = () => {
      while (seg < segments.length && pos >= segments[seg].length) {
        seg++;
        pos = 0;
      }
      return seg < segments.length;
    };
    const u8 = () => (need() ? segments[seg][pos++] : 0);
    const u16 = () => u8() | (u8() << 8);
    const u32 = () => (u16() | (u16() << 16)) >>> 0;
    const skip = (n) => {
      for (let left = n; left > 0 && need();) {
        const take = Math.min(left, segments[seg].length - pos);
        pos += take;
        left -= take;
      }
    };
    const unique = Math.min(segments[0].length >= 8 ? segments[0].readUInt32LE(4) : 0, 2_000_000);
    for (let n = 0; n < unique && need(); n++) {
      const chars = u16();
      const flags = u8();
      const runs = flags & 0x08 ? u16() : 0;
      const ext = flags & 0x04 ? u32() : 0;
      let wide = flags & 0x01;
      let value = '';
      for (let left = chars; left > 0;) {
        if (pos >= segments[seg].length) {
          seg++;
          pos = 0;
          if (seg >= segments.length) break;
          wide = segments[seg][pos++] & 0x01;
        }
        const room = Math.floor((segments[seg].length - pos) / (wide ? 2 : 1));
        const take = Math.min(left, room);
        if (take <= 0) break;
        const slice = segments[seg].subarray(pos, pos + take * (wide ? 2 : 1));
        value += wide ? slice.toString('utf16le') : slice.toString('latin1');
        pos += take * (wide ? 2 : 1);
        left -= take;
      }
      skip(runs * 4 + ext);
      strings.push(value);
    }
  }
  const unicode = (data, at, chars) => {
    const wide = data[at] & 0x01;
    const slice = data.subarray(at + 1, at + 1 + chars * (wide ? 2 : 1));
    return wide ? slice.toString('utf16le') : slice.toString('latin1');
  };
  const rk = (value) => {
    const n =
      value & 0x02
        ? value >> 2
        : (() => {
            const b = Buffer.alloc(8);
            b.writeUInt32LE((value & 0xfffffffc) >>> 0, 4);
            return b.readDoubleLE(0);
          })();
    return value & 0x01 ? n / 100 : n;
  };
  const warnings = [];
  const items = [];
  for (const sheet of globals.filter((r) => r.type === 0x0085)) {
    if (sheet.data.length < 8 || sheet.data[5] !== 0) continue;
    const name = unicode(sheet.data, 7, sheet.data[6]) || 'Sheet';
    const grid = new Map();
    const put = (row, col, value) => {
      if (col > MAX_COLUMNS || grid.size > MAX_ROWS * 4) return;
      const cells = grid.get(row) ?? [];
      cells[col] = string(value);
      grid.set(row, cells);
    };
    let formulaAt;
    for (const { type, data } of records(sheet.data.readUInt32LE(0))) {
      if (data.length < 6) continue;
      const row = data.readUInt16LE(0);
      const col = data.readUInt16LE(2);
      if (type === 0x00fd && data.length >= 10) put(row, col, strings[data.readUInt32LE(6)] ?? '');
      else if (type === 0x0203 && data.length >= 14) put(row, col, data.readDoubleLE(6));
      else if (type === 0x027e && data.length >= 10) put(row, col, rk(data.readUInt32LE(6)));
      else if (type === 0x00bd)
        for (let c = col, at = 4; at + 6 <= data.length - 2; c++, at += 6)
          put(row, c, rk(data.readUInt32LE(at + 2)));
      else if (type === 0x0204 && data.length >= 9)
        put(row, col, unicode(data, 8, data.readUInt16LE(6)));
      else if (type === 0x0205 && data.length >= 8)
        put(row, col, data[7] ? '#ERROR' : data[6] ? 'TRUE' : 'FALSE');
      else if (type === 0x0006 && data.length >= 14) {
        if (data.readUInt16LE(12) !== 0xffff) put(row, col, data.readDoubleLE(6));
        else if (data[6] === 1) put(row, col, data[8] ? 'TRUE' : 'FALSE');
        else if (data[6] === 0) formulaAt = { row, col };
      } else if (type === 0x0207 && formulaAt && data.length >= 3) {
        put(formulaAt.row, formulaAt.col, unicode(data, 2, data.readUInt16LE(0)));
        formulaAt = undefined;
      }
    }
    const rows = [...grid.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, cells]) => ({ n: n + 1, cells }));
    items.push({ label: `Sheet: ${name}`, text: sheetTable(rows, name, warnings) });
  }
  warnings.push(
    'Read from an older Excel file: values as last saved; formulas are not run, and dates may show as serial numbers.',
  );
  return ready(items, warnings);
}

/** A PowerPoint 97–2003 deck: each slide's text, from its text atoms. */
function openPpt(doc, top) {
  const data = doc.stream(top.find((e) => e.name === 'PowerPoint Document'));
  if (top.some((e) => e.name === 'EncryptedSummary')) throw locked();
  const outline = [];
  const drawn = [];
  const ends = [];
  let inList = false;
  let slide;
  for (let at = 0; at + 8 <= data.length;) {
    while (ends.length && at >= ends[ends.length - 1].end) {
      const done = ends.pop();
      if (done.list) inList = false;
      if (done.slide) slide = undefined;
    }
    const head = data.readUInt16LE(at);
    const type = data.readUInt16LE(at + 2);
    const length = data.readUInt32LE(at + 4);
    const end = Math.min(data.length, at + 8 + length);
    if ((head & 0x0f) === 0x0f) {
      if (ends.length > 64) throw new Error('The document is nested too deeply to read.');
      const list = type === 0x0ff0 && head >> 4 === 0;
      const isSlide = type === 0x03ee;
      if (list) inList = true;
      if (isSlide) {
        slide = [];
        drawn.push(slide);
      }
      ends.push({ end, list, slide: isSlide });
      at += 8;
      continue;
    }
    const body = data.subarray(at + 8, end);
    if (inList && type === 0x03f3) outline.push([]);
    else if (type === 0x0fa0 || type === 0x0fa8) {
      const text = (type === 0x0fa0 ? body.toString('utf16le') : body.toString('latin1')).replace(
        /\r|\v/g,
        '\n',
      );
      if (inList) outline.at(-1)?.push(text);
      else slide?.push(text);
    }
    at = end;
  }
  const words = (slides) => slides.reduce((n, s) => n + s.join('').length, 0);
  const slides = words(outline) >= words(drawn) ? outline : drawn;
  return ready(
    slides.map((texts, i) => ({ label: `Slide ${i + 1}`, text: texts.join('\n') })),
    [
      'Read from an older PowerPoint file: slide text only; pictures, diagrams and notes are not included.',
    ],
  );
}

function openCompound(bytes) {
  const doc = compound(bytes);
  const top = doc.children(doc.root);
  const has = (name) => top.some((e) => e.name === name);
  if (top.some((e) => e.name.startsWith('__substg1.0_'))) return openMsg(doc, top);
  if (has('EncryptedPackage') || has('EncryptionInfo')) throw locked();
  if (has('WordDocument')) return openDoc(doc, top);
  if (has('Workbook') || has('Book')) return openXls(doc, top);
  if (has('PowerPoint Document')) return openPpt(doc, top);
  throw new Error(
    'This older file isn’t one Conch can read. Save it as PDF, DOCX, XLSX or PPTX first.',
  );
}

// ── Zips: OOXML, OpenDocument, EPUB ─────────────────────────────────────────────

const ZIPPED_PART = /\.(xml|rels|xhtml|html|htm|opf|ncx)$/i;

function openZip(bytes) {
  const cap = Math.min(MAX_EXPANDED, Math.max(MIN_EXPANDED, bytes.length * MAX_RATIO));
  let size = 0;
  let entries = 0;
  const zip = unzipSync(new Uint8Array(bytes), {
    filter: (entry) => {
      if (++entries > 10_000) throw new Error('The document contains too many archive entries.');
      if (entry.name.includes('..') || entry.name.startsWith('/') || entry.name.includes('\\'))
        throw new Error('The document contains an unsafe archive path.');
      if (!ZIPPED_PART.test(entry.name) && entry.name !== 'mimetype') return false;
      size += entry.originalSize;
      if (size > cap || entry.originalSize > 10 * 1024 * 1024)
        throw new Error('The expanded document is too large. Split it into smaller documents.');
      return true;
    },
  });
  let actual = 0;
  for (const value of Object.values(zip)) {
    actual += value.length;
    if (actual > cap) throw new Error('The expanded document is too large.');
  }
  const parse = (path) => {
    const data = zip[path];
    if (!data) throw new Error('The Office document is missing a required part.');
    return xml.parse(checked(strFromU8(data)));
  };
  const mimetype = zip.mimetype ? strFromU8(zip.mimetype).trim() : '';

  if (zip['word/document.xml']) {
    // A Word document has no stable page numbers until laid out. Paragraph blocks do.
    const content = ordered.parse(checked(strFromU8(zip['word/document.xml'])));
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
    const total = Math.max(1, Math.ceil(paras.length / BLOCK));
    return {
      total,
      get: (i) => ({
        label: `Paragraphs ${i * BLOCK + 1}–${Math.min(paras.length, (i + 1) * BLOCK)}`,
        text: paras.slice(i * BLOCK, (i + 1) * BLOCK).join('\n'),
      }),
      warnings: [
        'Word page layout, images, headers, footers and tracked-change intent are not reconstructed. Labels refer to paragraph blocks.',
      ],
    };
  }
  if (zip['xl/workbook.xml']) return openXlsx(zip, parse);
  if (zip['ppt/presentation.xml']) {
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
    return {
      total: slides.length,
      get: (i) => ({ label: `Slide ${i + 1}`, text: paragraphs(parse(slides[i])).join('\n') }),
      warnings: [
        'Slide text is extracted; diagrams, images and animations need visual inspection.',
      ],
    };
  }
  if (
    zip['content.xml'] &&
    (!mimetype || mimetype.startsWith('application/vnd.oasis.opendocument.'))
  )
    return openOdf(zip);
  if (zip['META-INF/container.xml'] && (!mimetype || mimetype === 'application/epub+zip'))
    return openEpub(zip);
  throw new Error(
    'Use a PDF, Word, Excel, PowerPoint, OpenDocument, EPUB, RTF or email file. This archive is none of them.',
  );
}

// Excel's built-in date formats; custom ones are told by their letters.
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
function isDateFormat(code) {
  const bare = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
  return /[dmyhs]/i.test(bare) && !/^general$/i.test(bare.trim());
}
function excelDate(serial, date1904) {
  const days = serial + (date1904 ? 1462 : 0);
  if (!Number.isFinite(days) || days < 0 || days > 2_958_465) return undefined;
  const ms = Math.round((days - 25569) * 86_400_000);
  const iso = new Date(ms).toISOString();
  if (days < 1) return iso.slice(11, 19);
  return Number.isInteger(days) ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function openXlsx(zip, parse) {
  const workbook = parse('xl/workbook.xml');
  const relationships = list(parse('xl/_rels/workbook.xml.rels').Relationships?.Relationship);
  const shared = zip['xl/sharedStrings.xml']
    ? list(parse('xl/sharedStrings.xml').sst?.si).map(texts)
    : [];
  const date1904 = /^(1|true)$/.test(string(workbook.workbook?.workbookPr?.['@_date1904']));
  // Which cell styles are dates, so a date shows as one and not as 45291.
  const dated = new Set();
  if (zip['xl/styles.xml']) {
    const styles = parse('xl/styles.xml').styleSheet ?? {};
    const custom = new Map(
      list(styles.numFmts?.numFmt).map((f) => [Number(f['@_numFmtId']), string(f['@_formatCode'])]),
    );
    list(styles.cellXfs?.xf).forEach((xf, i) => {
      const id = Number(xf['@_numFmtId']);
      if (DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)))) dated.add(i);
    });
  }
  const sheets = list(workbook.workbook?.sheets?.sheet);
  const warnings = [
    'Values are as last saved; formulas are shown beside them, not run. Charts and formatting are not included.',
  ];
  return {
    total: sheets.length,
    warnings,
    get(i) {
      const sheet = sheets[i];
      const rel = relationships.find((r) => r['@_Id'] === sheet['@_id']);
      if (!rel || rel['@_TargetMode'] === 'External')
        throw new Error('The spreadsheet points to an external or missing worksheet.');
      const target = string(rel['@_Target']);
      if (target.includes('..') || target.includes('\\') || /^[a-z]+:/i.test(target))
        throw new Error('The spreadsheet contains an unsafe worksheet reference.');
      const path = target.startsWith('/xl/') ? target.slice(1) : `xl/${target}`;
      const name = string(sheet['@_name']) || `Sheet ${i + 1}`;
      let last = 0;
      const rows = list(parse(path).worksheet?.sheetData?.row).map((row) => {
        const n = Number(row['@_r']) || last + 1;
        last = n;
        const cells = [];
        let col = -1;
        for (const cell of list(row.c)) {
          const ref = string(cell['@_r']);
          col = ref ? columnIndex(ref) : col + 1;
          if (col < 0 || col > MAX_COLUMNS) continue;
          const type = cell['@_t'];
          const raw = typeof cell.v === 'object' ? string(cell.v?.['#text']) : string(cell.v);
          let value =
            type === 's'
              ? (shared[Number(raw)] ?? '')
              : type === 'inlineStr'
                ? texts(cell.is)
                : type === 'b'
                  ? raw === '1'
                    ? 'TRUE'
                    : 'FALSE'
                  : raw;
          if ((!type || type === 'n') && raw && dated.has(Number(cell['@_s'])))
            value = excelDate(Number(raw), date1904) ?? value;
          const formula = typeof cell.f === 'object' ? string(cell.f?.['#text']) : string(cell.f);
          if (formula) value = `${value} (=${formula})`;
          cells[col] = value;
        }
        return { n, cells };
      });
      return { label: `Sheet: ${name}`, text: sheetTable(rows, name, warnings) };
    },
  };
}

// ── PDF ───────────────────────────────────────────────────────────────────────

async function openPdf(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await loading.promise.catch(async (error) => {
    await loading.destroy();
    throw error;
  });
  const warnings = [];
  return {
    total: doc.numPages,
    warnings,
    async get(i) {
      const page = await doc.getPage(i + 1);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .trim();
      if (!text)
        warnings.push(
          `Page ${i + 1} has no extractable text. It may be scanned; visual/OCR reading is needed.`,
        );
      page.cleanup();
      return { label: `Page ${i + 1}`, text };
    },
    close: () => loading.destroy(),
  };
}

// ── Which reader ──────────────────────────────────────────────────────────────

async function open(bytes, name) {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return openPdf(bytes);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)
    return openZip(bytes);
  if (bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])))
    return openCompound(bytes);
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const latin = bytes.subarray(bom).toString('latin1');
  const ext = string(name).toLowerCase().split('.').pop();
  if (latin.startsWith('{\\rtf'))
    return blocks(rtfText(latin).split('\n'), [
      'Formatting, pictures, headers and footers are not included. Labels refer to paragraph blocks.',
    ]);
  if (/^\s*\{/.test(latin.slice(0, 256)) && (ext === 'ipynb' || bytes.includes('"nbformat"')))
    return openNotebook(bytes.subarray(bom).toString('utf8'));
  if (/^From \S/.test(latin)) return openMbox(latin);
  if ((ext === 'eml' && /^[A-Za-z][A-Za-z0-9-]*:/.test(latin)) || looksLikeMail(latin))
    return openMail(latin);
  throw new Error(
    'Use a PDF, Word, Excel, PowerPoint, OpenDocument, EPUB, RTF, email or notebook file.',
  );
}

async function extract(bytes, name, offset, limit, textOffset = 0) {
  const doc = await open(bytes, name);
  const sections = [];
  let remaining = MAX_TEXT;
  try {
    for (let i = offset; i < Math.min(doc.total, offset + limit); i++) {
      const { label, text } = await doc.get(i);
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
    }
  } finally {
    await doc.close?.();
  }
  return {
    name,
    totalSections: doc.total,
    sections,
    nextOffset: offset + sections.length < doc.total ? offset + sections.length : null,
    warnings: [...new Set(doc.warnings)].slice(0, 20),
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
      error: /password|encrypted|DRM/i.test(message)
        ? 'This document is locked. Attach an unlocked copy.'
        : message.slice(0, 500),
    }),
  );
}
