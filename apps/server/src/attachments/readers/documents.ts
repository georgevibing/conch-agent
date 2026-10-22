import { READABLE_DOCUMENT_TYPES } from '@conch/protocol';

import { extractDocument } from '../../files/documents';
import type { Reader } from './types';

/** PDFs and Office files: their words, taken out in the sealed reader (`files/documents.ts`). */
export const documents: Reader = {
  id: 'documents',
  matches: (attachment) =>
    attachment.kind === 'file' && READABLE_DOCUMENT_TYPES.has(attachment.mimeType),
  async read({ attachment, bytes, room, can, signal }) {
    const read = await extractDocument(bytes, attachment.name, 0, 20, signal).catch(
      () => undefined,
    );
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
    if (!read || !text.trim())
      // A scan, a locked file or a broken one: said plainly, with what would work instead.
      return {
        note: '(A document with no text Conch could take out: it may be scanned, locked or damaged. If the message depends on it, say so, and ask for screenshots of its pages or a copy with text.)',
      };
    const warnings = read.warnings.slice(0, 3);
    const rest = more
      ? can.tools
        ? ` Only the start is here. For the rest, use read_document with file_path "${attachment.id}" and the next offset.`
        : " Only the start is here; the rest didn't fit. If the message depends on the rest, say so."
      : '';
    return {
      note: `(The text of this document, taken out by Conch. Pictures and layout are not included.${warnings.length ? ` ${warnings.join(' ')}` : ''}${rest})`,
      text: text.trim(),
      more,
    };
  },
};
