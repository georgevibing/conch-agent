/**
 * Tables as spreadsheets: an Excel workbook (`.xlsx`: a frozen, filterable
 * header row, columns sized to their content, real numbers, dates and
 * formulas) and CSV (RFC 4180, safe to open in a spreadsheet).
 */
import { accentOf } from './html';
import { appProps, contentTypes, coreProps, pack, REL, rels, x, XML_HEAD } from './ooxml';

export type CellValue = string | number | boolean | null | { formula: string };
export type ColumnFormat = 'text' | 'integer' | 'decimal' | 'percent' | 'date' | 'datetime';

export interface Sheet {
  name: string;
  rows: CellValue[][];
  /** The first row is a header (bold, frozen, filterable). Default: yes. */
  header?: boolean;
  /** How each column's numbers show. */
  formats?: (ColumnFormat | null)[];
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/** Excel's day number for an ISO date (1900 system), or undefined. */
export function excelDate(text: string): { serial: number; time: boolean } | undefined {
  const m = ISO_DATE.exec(text);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  const ms = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h ?? 0),
    Number(mi ?? 0),
    Number(s ?? 0),
  );
  if (!Number.isFinite(ms)) return undefined;
  const check = new Date(ms);
  if (check.getUTCMonth() !== Number(mo) - 1 || check.getUTCDate() !== Number(d)) return undefined;
  return { serial: ms / 86_400_000 + 25_569, time: h !== undefined };
}

export function columnName(index: number): string {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Sheet names Excel accepts: at most 31 characters, none of `[]:*?/\`, unique. */
export function sheetNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((raw, i) => {
    let name =
      raw
        .replace(/[[\]:*?/\\]/g, ' ')
        .replace(/^'+|'+$/g, '')
        .trim()
        .slice(0, 31) || `Sheet ${i + 1}`;
    const base = name;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 27)} (${n})`;
    used.add(name.toLowerCase());
    return name;
  });
}

// Styles: 0 plain, 1 header, 2 date, 3 integer, 4 decimal, 5 percent, 6 datetime, 7 text, 8 wrapped text.
const FORMAT_STYLE: Record<ColumnFormat, number> = {
  text: 7,
  integer: 3,
  decimal: 4,
  percent: 5,
  date: 2,
  datetime: 6,
};

function styles(accent: string) {
  const a = `FF${accent.slice(1).toUpperCase()}`;
  return `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><color rgb="FF1D2329"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="${a}"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD9DEE3"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0"/></styleSheet>`;
}

function displayWidth(value: CellValue): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'object') return 10;
  const text = typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
  return Math.max(...text.split('\n').map((line) => line.length));
}

function worksheet(sheet: Sheet): string {
  const header = sheet.header !== false && sheet.rows.length > 1;
  const columns = Math.max(1, ...sheet.rows.map((r) => r.length));
  const last = `${columnName(columns - 1)}${Math.max(1, sheet.rows.length)}`;
  const widths = Array.from({ length: columns }, (_, c) => {
    let w = 0;
    for (const row of sheet.rows.slice(0, 2000)) w = Math.max(w, displayWidth(row[c] ?? null));
    return Math.min(60, Math.max(8, w * 1.1 + 2));
  });
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          const format = sheet.formats?.[c] ?? undefined;
          const head = header && r === 0;
          const style = head ? 1 : format ? FORMAT_STYLE[format] : 0;
          const s = style ? ` s="${style}"` : '';
          if (value === null || value === undefined || value === '')
            return head ? `<c r="${ref}"${s}/>` : '';
          if (typeof value === 'object')
            return `<c r="${ref}"${s}><f>${x(value.formula.replace(/^=/, ''))}</f></c>`;
          if (typeof value === 'number')
            return Number.isFinite(value) ? `<c r="${ref}"${s}><v>${value}</v></c>` : '';
          if (typeof value === 'boolean')
            return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
          const date = !head && format !== 'text' ? excelDate(value) : undefined;
          if (date) {
            const dateStyle =
              format === 'date' || format === 'datetime' ? style : date.time ? 6 : 2;
            return `<c r="${ref}" s="${dateStyle}"><v>${Math.round(date.serial * 1e6) / 1e6}</v></c>`;
          }
          const wrap = !head && !format && value.includes('\n') ? ' s="8"' : s;
          return `<c r="${ref}"${wrap} t="inlineStr"><is><t xml:space="preserve">${x(value)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const pane = header
    ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
    : '';
  return `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(1)}" customWidth="1"/>`)
    .join(
      '',
    )}</cols><sheetData>${rows}</sheetData>${header ? `<autoFilter ref="A1:${last}"/>` : ''}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

export function makeXlsx(
  sheets: readonly Sheet[],
  options: { title?: string; accent?: string } = {},
): Buffer {
  const names = sheetNames(sheets.map((s) => s.name));
  const filters = sheets
    .map((sheet, i) => {
      if (sheet.header === false || sheet.rows.length <= 1) return '';
      const columns = Math.max(1, ...sheet.rows.map((r) => r.length));
      const quoted = `'${(names[i] ?? '').replaceAll("'", "''")}'`;
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${x(`${quoted}!$A$1:$${columnName(columns - 1)}$${sheet.rows.length}`)}</definedName>`;
    })
    .join('');
  const workbook = `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names
    .map((name, i) => `<sheet name="${x(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join(
      '',
    )}</sheets>${filters ? `<definedNames>${filters}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  return pack([
    {
      path: '[Content_Types].xml',
      data: contentTypes([
        {
          part: '/xl/workbook.xml',
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
        },
        {
          part: '/xl/styles.xml',
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
        },
        ...sheets.map((_, i) => ({
          part: `/xl/worksheets/sheet${i + 1}.xml`,
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
        })),
        {
          part: '/docProps/core.xml',
          type: 'application/vnd.openxmlformats-package.core-properties+xml',
        },
        {
          part: '/docProps/app.xml',
          type: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
        },
      ]),
    },
    {
      path: '_rels/.rels',
      data: rels([
        { id: 'rId1', type: REL.officeDocument, target: 'xl/workbook.xml' },
        { id: 'rId2', type: REL.core, target: 'docProps/core.xml' },
        { id: 'rId3', type: REL.app, target: 'docProps/app.xml' },
      ]),
    },
    { path: 'docProps/core.xml', data: coreProps(options.title) },
    { path: 'docProps/app.xml', data: appProps() },
    { path: 'xl/workbook.xml', data: workbook },
    {
      path: 'xl/_rels/workbook.xml.rels',
      data: rels([
        ...sheets.map((_, i) => ({
          id: `rId${i + 1}`,
          type: REL.worksheet,
          target: `worksheets/sheet${i + 1}.xml`,
        })),
        { id: `rId${sheets.length + 1}`, type: REL.styles, target: 'styles.xml' },
      ]),
    },
    { path: 'xl/styles.xml', data: styles(accentOf(options.accent)) },
    ...sheets.map((sheet, i) => ({
      path: `xl/worksheets/sheet${i + 1}.xml`,
      data: worksheet(sheet),
    })),
  ]);
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/**
 * A cell a spreadsheet would run as a formula (`=`, `+`, `-`, `@`, a tab or
 * a return first: OWASP's CSV injection) gets a `'` in front, unless it's
 * plainly a number.
 */
function csvCell(value: CellValue): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? `=${value.formula.replace(/^=/, '')}` : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text) && !/^[-+]?\d+(?:\.\d+)?$/.test(text))
    text = `'${text}`;
  return /[",\n\r]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CSV with a byte-order mark, so Excel reads UTF-8 right. */
export function makeCsv(rows: readonly CellValue[][]): Buffer {
  return Buffer.from(
    `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`,
    'utf8',
  );
}

/** RFC 4180, with the delimiter worked out (comma, semicolon or tab). */
export function parseCsv(text: string, maxCells = Infinity): string[][] {
  const body = text.replace(/^\ufeff/, '');
  const firstLine = body.slice(0, body.indexOf('\n') === -1 ? body.length : body.indexOf('\n'));
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0]?.[0] ?? ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let cells = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
      if (++cells > maxCells) throw new Error('That table has too many cells.');
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (++cells > maxCells) throw new Error('That table has too many cells.');
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** A CSV cell as a spreadsheet value: plain numbers become numbers ("007" stays text). */
export function typed(cell: string): CellValue {
  if (cell === '') return null;
  if (/^-?(?:0|[1-9]\d{0,14})(?:\.\d+)?$/.test(cell)) return Number(cell);
  if (/^(?:true|false)$/i.test(cell)) return cell.toLowerCase() === 'true';
  return cell;
}
