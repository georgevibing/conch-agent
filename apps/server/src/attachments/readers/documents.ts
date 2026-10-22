import {
  READABLE_DOCUMENT_TYPES,
  type Attachment,
  type AttachmentView,
  type AttachmentViewPart,
} from '@conch/protocol';

import { extractDocument } from '../../files/documents';
import { canConvert, legacyKind } from '../../files/office';
import { extension } from '../sniff';
import type { Reader } from './types';

/** Documents that arrive as text, whose raw characters read worse than their words. */
const TEXT_DOCUMENTS = new Set(['eml', 'mbox', 'rtf', 'ipynb']);
const COMPOUND = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const MAIL = new Set(['message/rfc822', 'application/mbox', 'application/vnd.ms-outlook']);

function takes(attachment: Attachment, head: Buffer): boolean {
  if (attachment.kind === 'file')
    return (
      READABLE_DOCUMENT_TYPES.has(attachment.mimeType) ||
      // An Outlook message or older Office file under a name or type that doesn't say so.
      head.subarray(0, 8).equals(COMPOUND)
    );
  if (attachment.kind !== 'text' || attachment.pasted) return false;
  return (
    TEXT_DOCUMENTS.has(extension(attachment.name)) ||
    READABLE_DOCUMENT_TYPES.has(attachment.mimeType) ||
    head.subarray(0, 5).toString('latin1') === '{\\rtf'
  );
}

/** What kind of document it was, in the words of the note's first sentence. */
function described(attachment: Attachment, labels: string[], total: number): string {
  const ext = extension(attachment.name);
  if (labels[0]?.startsWith('Message') && total > 1)
    return `A mailbox of ${total} messages, read by Conch; each message is a section.`;
  if (labels[0]?.startsWith('Message') || MAIL.has(attachment.mimeType))
    return 'An email, read by Conch: who sent it, to whom and when, its words, and the names and sizes of what it carried.';
  if (labels.length && labels.every((l) => l.startsWith('Sheet: ')))
    return 'The sheets of this workbook as tables, read by Conch: column letters across the top, row numbers down the side.';
  if (labels[0]?.startsWith('Cells '))
    return 'A Jupyter notebook, read by Conch: its cells in order.';
  if (labels[0] === 'About this book' || ext === 'epub')
    return 'A book, read by Conch chapter by chapter. Pictures and layout are not included.';
  return 'The text of this document, taken out by Conch. Pictures and layout are not included.';
}

/** `| a | b \| c |` as its cells, a `\|` kept as a bar inside one. */
function cells(line: string): string[] {
  const out: string[] = [];
  let current = '';
  for (let i = line.indexOf('|') + 1; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && line[i + 1] === '|') {
      current += '|';
      i++;
    } else if (c === '|') {
      out.push(current.trim().replaceAll('<br>', '\n'));
      current = '';
    } else current += c;
  }
  return out;
}

/**
 * A sheet section as the preview's table: the worker's own Markdown table read
 * back, a row for every row number (blank ones too), so the preview's row
 * numbers are the file's.
 */
function sheetPart(title: string, text: string): AttachmentViewPart {
  const lines = text.split('\n').filter((l) => l.startsWith('|'));
  const columns = cells(lines[0] ?? '').slice(1, 501);
  const byNumber = new Map<number, string[]>();
  for (const line of lines.slice(2)) {
    const [n, ...values] = cells(line);
    if (Number(n) > 0)
      byNumber.set(
        Number(n),
        values.slice(0, 500).map((c) => c.slice(0, 4000)),
      );
  }
  const last = Math.max(0, ...byNumber.keys());
  const rows: string[][] = [];
  for (let n = 1; n <= last && rows.length < 2000; n++)
    rows.push(byNumber.get(n) ?? columns.map(() => ''));
  return { kind: 'table', title, columns, rows, total: last };
}

/** A message section as the preview's email: headers, words, then what it carried. */
function mailPart(title: string, text: string): AttachmentViewPart | undefined {
  const gap = text.indexOf('\n\n');
  if (gap < 0) return undefined;
  const headers = text
    .slice(0, gap)
    .split('\n')
    .map((line) => /^([A-Za-z-]{1,40}): (.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .slice(0, 40)
    .map((m) => ({ name: m[1] ?? '', value: (m[2] ?? '').slice(0, 4000) }));
  let body = text.slice(gap + 2);
  const attachments: { name: string; type?: string }[] = [];
  const listed = /\n\nAttachments \(\d+\):\n((?:- .*(?:\n|$))+)$/.exec(body);
  if (listed) {
    body = body.slice(0, listed.index);
    for (const line of (listed[1] ?? '').split('\n')) {
      const m = /^- (.*) \(([^,()]*)(?:, [^()]*)?\)$/.exec(line);
      if (m)
        attachments.push({ name: (m[1] ?? '').slice(0, 500), type: (m[2] ?? '').slice(0, 255) });
    }
  }
  return {
    kind: 'email',
    title: title.slice(0, 300),
    headers,
    body: body.slice(0, 400_000),
    attachments: attachments.slice(0, 500),
  };
}

/** The preview, for the shapes this reader knows better than plain text: sheets and mail. */
function viewOf(sections: { label: string; text: string }[]): AttachmentView | undefined {
  if (!sections.length) return undefined;
  const make = sections.every((s) => s.label.startsWith('Sheet: '))
    ? (s: { label: string; text: string }) => sheetPart(s.label.slice(7), s.text)
    : sections.every((s) => s.label.startsWith('Message'))
      ? (s: { label: string; text: string }) => mailPart(s.label, s.text)
      : undefined;
  if (!make) return undefined;
  const parts = sections.slice(0, 200).map(make);
  return parts.every(Boolean) ? { parts: parts as AttachmentViewPart[] } : undefined;
}

/**
 * Documents, read in the sealed reader (`files/documents.ts`): PDF; Word,
 * Excel and PowerPoint, current and 97–2003; OpenDocument; EPUB; RTF; email
 * (.eml, .mbox, Outlook .msg); Jupyter notebooks. Engines that open files get
 * the file and `read_document` instead, and an email, RTF or notebook that
 * arrived as text goes to them as it is.
 */
export const documents: Reader = {
  id: 'documents',
  text: true,
  matches: takes,
  async read({ attachment, bytes, room, can, signal }) {
    const read = await extractDocument(bytes, attachment.name, 0, 20, signal).catch(
      () => undefined,
    );
    // Words that arrived as text and aren't any of these: the text itself goes in instead.
    if (!read && attachment.kind === 'text') return undefined;
    let text = '';
    let more = read?.nextOffset !== null;
    for (const section of read?.sections ?? []) {
      const part = `[${section.label}]\n${section.text}\n`;
      if (text.length + part.length > room) {
        text += part.slice(0, Math.max(0, room - text.length));
        more = true;
        break;
      }
      text += part;
      if (section.truncated) more = true;
    }
    const legacy = read ? undefined : legacyKind(bytes, attachment.name);
    // A compound file that's no document (an installer, say): the next reader names it.
    if (!read && !legacy && !READABLE_DOCUMENT_TYPES.has(attachment.mimeType)) return undefined;
    if (!read || !text.trim()) {
      if (!read && legacy && !(await canConvert(legacy)))
        // An Office file older than 97 (or one damaged): what would read it, and what to ask for.
        return {
          note: '(An older Office file that Conch can’t read on this computer. LibreOffice, installed here, would let Conch read it. If the message depends on it, say so, and ask for it saved as DOCX, XLSX, PPTX or PDF.)',
        };
      // A scan, a locked file or a broken one: said plainly, with what would work instead.
      return {
        note: '(A document with no text Conch could take out: it may be scanned, locked or damaged. If the message depends on it, say so, and ask for screenshots of its pages or a copy with text.)',
      };
    }
    const warnings = read.warnings.slice(0, 3);
    const rest = more
      ? can.tools
        ? ` Only the start is here. For the rest, use read_document with file_path "${attachment.id}" and the next offset.`
        : " Only the start is here; the rest didn't fit. If the message depends on the rest, say so."
      : '';
    const labels = read.sections.map((s) => s.label);
    const view = viewOf(read.sections);
    return {
      note: `(${described(attachment, labels, read.totalSections)}${warnings.length ? ` ${warnings.join(' ')}` : ''}${rest})`,
      text: text.trim(),
      more,
      ...(view && { view: { ...view, ...(more && { more: true }) } }),
    };
  },
};
